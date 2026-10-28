import { TICKERS, type Ticker } from "@hossa/economy";
import type { Command } from "@hossa/market";

/**
 * Tryb polaczony: kazde zlecenie botow idzie tez do prawdziwego Parkietu (gielda w Javie).
 *
 * Kolejnosc liczy sie tylko w obrebie spolki (kazdy arkusz jest osobny), wiec kazda spolka ma
 * wlasna kolejke zadan, a szesc kolejek idzie rownolegle.
 */

export type LinkState = "connecting" | "ready" | "error";

export interface LinkStats {
  readonly state: LinkState;
  /** Polecenia wyslane do Parkietu (zlecenia i anulowania). */
  readonly sent: number;
  /** Polecenia czekajace w kolejkach — rosnie, gdy Parkiet nie nadaza za tempem. */
  readonly pending: number;
  /** Bledy sieci albo HTTP. */
  readonly failed: number;
  readonly lastError?: string;
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
  private pending = 0;
  private failed = 0;
  private lastError: string | undefined;
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
    const { state, sent, pending, failed, lastError } = this;
    return { state, sent, pending, failed, ...(lastError === undefined ? {} : { lastError }) };
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
  }

  private async submit(command: Extract<Command, { kind: "submit" }>): Promise<void> {
    const body = {
      side: command.side,
      type: command.type,
      ...(command.type === "LIMIT" ? { price: zloty(command.price) } : {}),
      quantity: command.quantity,
      clientOrderId: `${this.tag}-${String(command.orderId)}`,
    };
    await this.json(`${this.base}/api/instruments/${command.ticker}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const reply = await this.http(url, init);
    if (!reply.ok) throw new Error(`HTTP ${String(reply.status)} z ${url.replace(this.base, "")}`);
    return reply.json();
  }
}
