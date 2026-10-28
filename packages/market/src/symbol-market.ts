import { MAX_PRICE, MAX_QUANTITY, OrderBook, orderRequest, type BookEvent, type OrderType, type Side } from "@hossa/engine";
import type { Ticker } from "@hossa/economy";

/** Najmniejszy krok ceny: 5 groszy. */
export const TICK = 5;
export const roundTick = (price: number): number => Math.min(MAX_PRICE, Math.max(TICK, Math.round(price / TICK) * TICK));

/** Konto gracza w jednej spolce: akcje i gotowka (grosze). Startuje od zera; krotka sprzedaz dozwolona. */
export interface Account {
  position: number;
  cash: number;
}

/** Gracz w arkuszu: wlasciciel zlecen i konta. */
export interface Trader {
  readonly id: string;
  readonly account: Account;
  /** Id zlecen gracza, ktore czekaja w arkuszu. */
  readonly resting: Set<number>;
}

export interface Candle {
  readonly day: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Wspolny licznik id zlecen dla calej sesji — kazdy arkusz widzi tylko rosnace numery. */
export class OrderIds {
  private last = 0;
  next(): number {
    this.last += 1;
    return this.last;
  }
}

/** Transakcja z tasmy: po jakiej cenie, ile i kto byl agresorem (strona zlecenia, ktore ja wywolalo). */
export interface Print {
  /** Kolejny numer transakcji w tym rynku — UI po nim poznaje, ktore sa nowe. */
  readonly seq: number;
  readonly price: number;
  readonly quantity: number;
  readonly side: Side;
}

/**
 * Polecenie, ktore rynek wykonal na swoim arkuszu, razem z wynikiem silnika. Tryb polaczony
 * powtarza je na prawdziwym Parkiecie i porownuje wyniki. Anulowanie zgloszone tylko wtedy,
 * gdy zlecenie jeszcze czekalo — inaczej nie bylo czego powtarzac.
 */
export type Command =
  | { readonly kind: "submit"; readonly ticker: Ticker; readonly orderId: number; readonly side: Side; readonly type: OrderType; readonly price: number; readonly quantity: number; readonly events: readonly BookEvent[] }
  | { readonly kind: "cancel"; readonly ticker: Ticker; readonly orderId: number };

export type CommandListener = (command: Command) => void;

const HISTORY = 400;
const TAPE = 40;

/**
 * Rynek jednej spolki: arkusz z silnika plus ksiegowosc graczy. Kazda transakcja przenosi akcje
 * i gotowke miedzy dwoma graczami, wiec suma pozycji i suma gotowki wszystkich graczy to zawsze zero.
 */
export class SymbolMarket {
  readonly book = new OrderBook();
  last: number;
  /** Ostatnia cena po kazdym kroku (do momentum i zmiennosci). */
  readonly history: number[] = [];
  readonly candles: Candle[] = [];
  /** Swieca kazdego kroku (ostatnie 400) — do wykresu w ciagu dnia, bo dzienna rosnie zbyt wolno. */
  readonly bars: Candle[] = [];
  /** Ostatnie transakcje, najnowsza na koncu. */
  readonly tape: Print[] = [];
  /** Srednia wykladnicza |zmiany ceny| na krok — miara nerwowosci rynku. */
  volatility = 0;
  /** Czekajace zlecenia graczy: kto zlozyl i ile jeszcze zostalo do realizacji. */
  private readonly owners = new Map<number, { trader: Trader; remaining: number }>();
  private bar: Candle;
  private printed = 0;

  constructor(
    readonly ticker: Ticker,
    start: number,
    private readonly ids: OrderIds,
    private readonly listener?: CommandListener,
  ) {
    this.last = roundTick(start);
    this.bar = this.freshCandle(0);
  }

  /** Zlecenie gracza. Cena i ilosc sa przycinane do limitow silnika; zwraca zdarzenia arkusza. */
  submit(trader: Trader, side: Side, type: OrderType, price: number, quantity: number): BookEvent[] {
    const qty = Math.min(MAX_QUANTITY, Math.floor(quantity));
    if (qty <= 0) return [];
    const id = this.ids.next();
    const limit = type === "LIMIT" ? roundTick(price) : 0;
    const events = this.book.submit(orderRequest(id, side, type, limit, qty));
    this.listener?.({ kind: "submit", ticker: this.ticker, orderId: id, side, type, price: limit, quantity: qty, events });
    for (const e of events) {
      if (e.kind === "RESTED") {
        this.owners.set(id, { trader, remaining: e.quantity });
        trader.resting.add(id);
      } else if (e.kind === "TRADE") {
        this.settle(e.makerOrderId, trader, e.takerSide, e.price, e.quantity);
      }
    }
    return events;
  }

  cancel(trader: Trader, orderId: number): void {
    if (this.book.cancel(orderId)) {
      this.owners.delete(orderId);
      this.listener?.({ kind: "cancel", ticker: this.ticker, orderId });
    }
    trader.resting.delete(orderId);
  }

  cancelAll(trader: Trader): void {
    for (const id of [...trader.resting]) this.cancel(trader, id);
  }

  mid(): number {
    const bid = this.book.bestBid();
    const ask = this.book.bestAsk();
    return bid !== undefined && ask !== undefined ? (bid + ask) / 2 : this.last;
  }

  /** Koniec kroku: zapis ceny i zmiennosci. */
  endStep(): void {
    const prev = this.history.at(-1) ?? this.last;
    this.history.push(this.last);
    if (this.history.length > HISTORY) this.history.shift();
    this.volatility += (Math.abs(this.last / prev - 1) - this.volatility) / 20;
    this.bars.push(this.bar);
    if (this.bars.length > HISTORY) this.bars.shift();
    this.bar = this.freshCandle(this.bar.day);
  }

  openDay(day: number): void {
    this.candles.push(this.freshCandle(day));
    this.bar = { ...this.bar, day };
  }

  /** Cena sprzed `steps` krokow (albo najstarsza znana). */
  priceAgo(steps: number): number {
    return this.history[Math.max(0, this.history.length - steps)] ?? this.last;
  }

  private settle(makerId: number, taker: Trader, takerSide: Side, price: number, quantity: number): void {
    const owned = this.owners.get(makerId) as { trader: Trader; remaining: number };
    const maker = owned.trader;
    owned.remaining -= quantity;
    if (owned.remaining === 0) {
      this.owners.delete(makerId);
      maker.resting.delete(makerId);
    }
    const [buyer, seller] = takerSide === "BUY" ? [taker, maker] : [maker, taker];
    buyer.account.position += quantity;
    buyer.account.cash -= price * quantity;
    seller.account.position -= quantity;
    seller.account.cash += price * quantity;
    this.last = price;
    this.printed += 1;
    this.tape.push({ seq: this.printed, price, quantity, side: takerSide });
    if (this.tape.length > TAPE) this.tape.shift();
    const day = this.candles.at(-1);
    for (const c of day ? [day, this.bar] : [this.bar]) {
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
      c.volume += quantity;
    }
  }

  private freshCandle(day: number): Candle {
    return { day, open: this.last, high: this.last, low: this.last, close: this.last, volume: 0 };
  }
}
