import { TICKERS, type Ticker } from "@hossa/economy";
import type { Command } from "@hossa/market";

/**
 * Tryb polaczony: kazde zlecenie botow idzie tez do prawdziwego Parkietu (gielda w Javie), a jego
 * odpowiedz jest porownywana z wynikiem silnika w przegladarce. Silnik Hossy to port Parkietu,
 * wiec te same polecenia w tej samej kolejnosci musza dac te same zdarzenia — licznik zgodnosci
 * pokazuje to na zywo.
 *
 * Kolejnosc liczy sie tylko w obrebie spolki (kazdy arkusz jest osobny), wiec kazda spolka ma
 * wlasna kolejke zadan, a szesc kolejek idzie rownolegle. Numery zlecen Parkietu sa inne niz
 * lokalne, wiec mirror pamieta, ktore zlecenie Parkietu odpowiada ktoremu czekajacemu lokalnie.
 */

export type LinkState = "connecting" | "ready" | "error";

/**
 * Tyle polecen moze czekac w kolejkach, zanim symulacja stanie i poczeka na Parkiet. Przy tempie
 * 16x boty skladaja ok. 700 polecen na sekunde, a przez proxy przechodzi mniej — bez hamulca
 * scena uciekalaby gieldzie o minuty, a notowania z Parkietu bylyby coraz starsze.
 */
export const MAX_BACKLOG = 600;

export interface LinkStats {
  readonly state: LinkState;
  /** Polecenia wyslane do Parkietu (zlecenia i anulowania). */
  readonly sent: number;
  /** Odpowiedzi takie same jak wynik silnika w przegladarce. */
  readonly matched: number;
  readonly mismatched: number;
  /** Polecenia czekajace w kolejkach — rosnie, gdy Parkiet nie nadaza za tempem. */
  readonly pending: number;
  /** Bledy sieci albo HTTP — polecenie nie doszlo do porownania. */
  readonly failed: number;
  readonly lastError?: string;
}

type Side = "BUY" | "SELL";

/** Zdarzenie z odpowiedzi Parkietu: ceny w zlotowkach jako tekst. */
type RemoteEvent =
  | { readonly type: "RESTED"; readonly orderId: number; readonly side: Side; readonly price: string; readonly quantity: number }
  | { readonly type: "TRADE"; readonly makerOrderId: number; readonly takerOrderId: number; readonly takerSide: Side; readonly price: string; readonly quantity: number }
  | { readonly type: "CANCELLED"; readonly orderId: number; readonly quantity: number; readonly reason: string };

interface OrderReply {
  readonly orderId: number;
  readonly runId: number;
  readonly events: readonly RemoteEvent[];
}

interface BookReply {
  readonly bids: readonly unknown[];
  readonly asks: readonly unknown[];
}

export type Http = (url: string, init?: RequestInit) => Promise<Response>;

/** Grosze na zlotowki tak, jak Parkiet je przyjmuje i oddaje ("34.40"). */
export const zloty = (grosze: number): string => (grosze / 100).toFixed(2);

export class ParkietMirror {
  private state: LinkState = "connecting";
  private sent = 0;
  private matched = 0;
  private mismatched = 0;
  private pending = 0;
  private failed = 0;
  private lastError: string | undefined;
  private runId = 0;
  /** Lokalne zlecenia czekajace w arkuszu: numer w Parkiecie i ile jeszcze zostalo. */
  private readonly resting = new Map<number, { remote: number; remaining: number }>();
  private readonly queues = new Map<Ticker, Promise<void>>();
  private readonly ready: Promise<boolean>;

  /**
   * @param base adres Parkietu (w przegladarce przez proxy Vite, bo Parkiet nie wystawia CORS)
   * @param tag poczatek clientOrderId — po nim zlecenia tej sesji da sie znalezc w dzienniku Parkietu
   */
  constructor(
    private readonly base: string,
    private readonly tag: string,
    private readonly http: Http = (url, init) => fetch(url, init),
  ) {
    this.ready = this.connect();
  }

  stats(): LinkStats {
    const { state, sent, matched, mismatched, pending, failed, lastError } = this;
    return { state, sent, matched, mismatched, pending, failed, ...(lastError === undefined ? {} : { lastError }) };
  }

  push(command: Command): void {
    this.pending += 1;
    const previous = this.queues.get(command.ticker) ?? Promise.resolve();
    const next = previous
      .then(() => this.ready)
      .then((ok) => (ok ? this.run(command) : undefined))
      .catch((error: unknown) => {
        this.failed += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.pending -= 1;
      });
    this.queues.set(command.ticker, next);
  }

  /** Czy kolejki sa tak dlugie, ze symulacja powinna poczekac. */
  busy(): boolean {
    return this.pending > MAX_BACKLOG;
  }

  /** Czeka, az wszystkie kolejki sie oproznia (testy i zamykanie). */
  async idle(): Promise<void> {
    await this.ready;
    await Promise.all(this.queues.values());
  }

  /**
   * Parkiet musi znac szesc spolek miasteczka i miec puste arkusze — zlecenia z poprzedniej sesji
   * kojarzylyby sie z nowymi i kazde porownanie wyszloby rozne.
   */
  private async connect(): Promise<boolean> {
    try {
      const symbols = (await this.json(`${this.base}/api/instruments`)) as string[];
      const missing = TICKERS.filter((t) => !symbols.includes(t));
      if (missing.length > 0) throw new Error(`Parkiet nie zna spolek ${missing.join(", ")}`);
      for (const t of TICKERS) {
        const book = (await this.json(`${this.base}/api/instruments/${t}/book`)) as BookReply;
        if (book.bids.length + book.asks.length > 0) throw new Error("arkusze Parkietu nie sa puste — zrestartuj kontener");
      }
      this.state = "ready";
      return true;
    } catch (error) {
      this.state = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  private async run(command: Command): Promise<void> {
    this.sent += 1;
    if (command.kind === "submit") await this.submit(command);
    else await this.cancel(command.ticker, command.orderId);
  }

  private async submit(command: Extract<Command, { kind: "submit" }>): Promise<void> {
    const body = {
      side: command.side,
      type: command.type,
      ...(command.type === "LIMIT" ? { price: zloty(command.price) } : {}),
      quantity: command.quantity,
      clientOrderId: `${this.tag}-${String(command.orderId)}`,
    };
    const reply = (await this.json(`${this.base}/api/instruments/${command.ticker}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })) as OrderReply;
    this.runId = reply.runId;
    const expected = command.events.map((e): RemoteEvent => {
      switch (e.kind) {
        case "RESTED":
          return { type: "RESTED", orderId: reply.orderId, side: e.side, price: zloty(e.price), quantity: e.quantity };
        case "TRADE":
          return { type: "TRADE", makerOrderId: this.resting.get(e.makerOrderId)?.remote ?? -1, takerOrderId: reply.orderId, takerSide: e.takerSide, price: zloty(e.price), quantity: e.quantity };
        case "CANCELLED":
          return { type: "CANCELLED", orderId: reply.orderId, quantity: e.quantity, reason: e.reason };
      }
    });
    this.compare(command, expected, reply.events);
    for (const e of command.events) {
      if (e.kind === "RESTED") this.resting.set(command.orderId, { remote: reply.orderId, remaining: e.quantity });
      else if (e.kind === "TRADE") this.filled(e.makerOrderId, e.quantity);
    }
  }

  private async cancel(ticker: Ticker, orderId: number): Promise<void> {
    const order = this.resting.get(orderId);
    this.resting.delete(orderId);
    if (!order) throw new Error(`zlecenie ${String(orderId)} nie doszlo wczesniej do Parkietu`);
    const reply = await this.http(`${this.base}/api/instruments/${ticker}/orders/${String(order.remote)}?runId=${String(this.runId)}`, { method: "DELETE" });
    if (reply.ok) this.matched += 1;
    else if (reply.status === 404) this.differs(`${ticker}: Parkiet nie mial juz zlecenia ${String(orderId)} do anulowania`);
    else throw new Error(`HTTP ${String(reply.status)} przy anulowaniu w ${ticker}`);
  }

  private compare(command: Command, expected: readonly RemoteEvent[], actual: readonly RemoteEvent[]): void {
    // porownanie po kluczach w stalej kolejnosci: JSON z Javy moze miec pola w innym porzadku
    const canonical = (events: readonly RemoteEvent[]) => JSON.stringify(events.map((e) => Object.fromEntries(Object.entries(e).sort(([a], [b]) => a.localeCompare(b)))));
    if (canonical(expected) === canonical(actual)) this.matched += 1;
    else this.differs(`${command.ticker}: zlecenie ${String(command.orderId)} dalo w Parkiecie ${canonical(actual)} zamiast ${canonical(expected)}`);
  }

  private differs(message: string): void {
    this.mismatched += 1;
    this.lastError = message;
  }

  private filled(orderId: number, quantity: number): void {
    const order = this.resting.get(orderId);
    if (!order) return;
    order.remaining -= quantity;
    if (order.remaining <= 0) this.resting.delete(orderId);
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const reply = await this.http(url, init);
    if (!reply.ok) throw new Error(`HTTP ${String(reply.status)} z ${url.replace(this.base, "")}`);
    return reply.json();
  }
}
