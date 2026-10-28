import { TICKERS, type Ticker } from "@hossa/economy";
import type { BookLevel, CompanyView, Link, Print, Snapshot } from "./protocol.js";

/**
 * Notowania z prawdziwego Parkietu: strumien `/ws/market` (obraz arkusza co ~100 ms i kazda
 * transakcja od razu). W trybie polaczonym panel spolki pokazuje arkusz i tasme stad, a nie
 * z silnika w przegladarce — to, co widac, przeszlo przez gielde w Javie.
 *
 * Parkiet najpierw zapisuje klienta na zdarzenia, a dopiero potem wysyla obraz arkusza, wiec moze
 * przyjsc transakcja sprzed obrazu albo starszy obraz po nowszym. Numer `sequence` je rozroznia:
 * wszystko, co nie jest nowsze niz ostatni obraz, jest juz w nim uwzglednione.
 */

interface WireLevel {
  readonly price: string;
  readonly quantity: number;
}

type Message =
  | { readonly type: "book"; readonly symbol: string; readonly sequence: number; readonly bids: readonly WireLevel[]; readonly asks: readonly WireLevel[] }
  | { readonly type: "trade"; readonly symbol: string; readonly sequence: number; readonly price: string; readonly quantity: number; readonly takerSide: "BUY" | "SELL" }
  // typ, ktorego jeszcze nie znamy — protokol moze sie rozrosnac
  | { readonly type: "other"; readonly symbol: string; readonly sequence: number };

export interface Quote {
  /** Cena ostatniej transakcji na Parkiecie; brak, dopoki zadnej nie bylo. */
  readonly last?: number;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  /** Ostatnie transakcje, najnowsza na koncu. */
  readonly tape: readonly Print[];
}

const TAPE = 40;

/** "34.40" na grosze; Math.round, bo 34.4 * 100 w double to 3439.9999... */
export const grosze = (zloty: string): number => Math.round(Number(zloty) * 100);

const levels = (wire: readonly WireLevel[]): BookLevel[] => wire.map((l) => ({ price: grosze(l.price), quantity: l.quantity }));

export class ParkietFeed {
  private readonly quotes = new Map<Ticker, { last?: number; bids: BookLevel[]; asks: BookLevel[]; tape: Print[]; sequence: number; printed: number }>();

  constructor() {
    for (const t of TICKERS) this.quotes.set(t, { bids: [], asks: [], tape: [], sequence: 0, printed: 0 });
  }

  /** Adres strumienia dla szesciu spolek miasteczka. */
  static url(base: string): string {
    return `${base.replace(/^http/, "ws")}/ws/market?symbols=${TICKERS.join(",")}`;
  }

  quote(ticker: Ticker): Quote {
    const { last, bids, asks, tape } = this.quotes.get(ticker) as Quote;
    return { ...(last === undefined ? {} : { last }), bids, asks, tape };
  }

  /** Jedna wiadomosc ze strumienia. Nieznane typy i spolki pomija — protokol moze sie rozrosnac. */
  handle(raw: string): void {
    const message = JSON.parse(raw) as Message;
    const quote = this.quotes.get(message.symbol as Ticker);
    if (!quote || message.sequence <= quote.sequence) return;
    if (message.type === "book") {
      quote.sequence = message.sequence;
      quote.bids = levels(message.bids);
      quote.asks = levels(message.asks);
    } else if (message.type === "trade") {
      quote.last = grosze(message.price);
      quote.printed += 1;
      quote.tape.push({ seq: quote.printed, price: quote.last, quantity: message.quantity, side: message.takerSide });
      if (quote.tape.length > TAPE) quote.tape.shift();
    }
  }
}

/**
 * Migawka sceny z notowaniami z Parkietu: kursy spolek, arkusz i tasma w panelu. Reszta (gospodarka,
 * wykres, fundamenty) zostaje z przegladarki. Dopoki lacze nie jest gotowe, Parkiet moze miec cudze
 * zlecenia, wiec jego ceny nie trafiaja na scene.
 */
export function withParkiet(snapshot: Snapshot, feed: ParkietFeed, link: Link): Snapshot {
  if (link.state !== "ready") return { ...snapshot, link };
  const companies = {} as Record<Ticker, CompanyView>;
  for (const t of TICKERS) companies[t] = { ...snapshot.companies[t], price: feed.quote(t).last ?? snapshot.companies[t].price };
  const quote = snapshot.detail && feed.quote(snapshot.detail.ticker);
  const detail = snapshot.detail && quote && { ...snapshot.detail, bids: quote.bids, asks: quote.asks, tape: quote.tape };
  return { ...snapshot, companies, ...(detail ? { detail } : {}), link };
}
