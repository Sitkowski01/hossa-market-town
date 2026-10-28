import type { EventKind, Good, Ticker } from "@hossa/economy";
import type { ShipPhase } from "../world/traffic.js";
import type { LinkStats } from "./parkiet.js";

/**
 * Wiadomosci miedzy Web Workerem (gielda i gospodarka) a scena. Scena nie zna silnika:
 * dostaje co ~100 ms migawke ze wszystkim, co ma pokazac. Ceny w groszach.
 */

export const SPEEDS = [0, 1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** Swiece na wykresie panelu: trzy dni przy 20 krokach na dzien. Tyle wysyla worker i tyle miesci wykres. */
export const BARS_SHOWN = 60;

export type Route = "RUD-STW" | "STW-MTK" | "STW-BPT" | "MTK-BPT";

export interface CompanyView {
  readonly name: string;
  readonly price: number;
  /** Cena otwarcia dzisiejszej sesji. */
  readonly open: number;
  /** Wartosc godziwa z wyceny gospodarki. */
  readonly fair: number;
  /** Dzisiejsza produkcja wzgledem mocy (0..1); 0 = zaklad stoi (strajk). */
  readonly output: number;
}

/** Zapelnienie placow skladowych 0..1 — na makiecie wysokosc zwalow i stosow. */
export interface Yards {
  readonly mine: number;
  readonly millOre: number;
  readonly factory: number;
  readonly portSteel: number;
  readonly portMachines: number;
}

/** Dzisiejsza wysylka na jednej trasie — scena robi z niej kolumne ciezarowek. */
export interface Dispatch {
  readonly route: Route;
  readonly good: Good;
  readonly quantity: number;
}

export interface Incident {
  readonly kind: EventKind;
  readonly ticker?: Ticker;
  readonly daysLeft: number;
}

export interface Headline {
  readonly id: number;
  readonly day: number;
  readonly text: string;
  /** Wydzwiek od -1 do 1 (srednia wplywu na spolki, ktorych dotyczy). */
  readonly tone: number;
  /** Spolki, ktorych dotyczy, od najmocniej dotknietej. */
  readonly tickers: readonly Ticker[];
}

export interface Snapshot {
  readonly seed: number;
  readonly day: number;
  /** Czas symulacji w krokach gieldy; ulamek to postep biezacego kroku. */
  readonly time: number;
  readonly stepsPerDay: number;
  /** Ile krokow na milisekunde przy obecnym tempie — scena ekstrapoluje czas miedzy migawkami. */
  readonly ticksPerMs: number;
  readonly speed: Speed;
  readonly rateBp: number;
  readonly index: number;
  /** Indeks na zamknieciu poprzedniego dnia. */
  readonly indexOpen: number;
  readonly companies: Readonly<Record<Ticker, CompanyView>>;
  readonly dispatches: readonly Dispatch[];
  readonly yards: Yards;
  readonly ship: ShipPhase;
  readonly incidents: readonly Incident[];
  readonly news: readonly Headline[];
  /** Szczegoly otwartej spolki; brak, gdy panel jest zamkniety. */
  readonly detail?: Detail;
  /** Tryb polaczony: stan lacza z Parkietem; brak, gdy scena liczy sama. */
  readonly link?: Link;
}

export interface Link extends LinkStats {
  /** Czy strumien notowan /ws/market jest otwarty. */
  readonly streaming: boolean;
}

export type ToWorker =
  | { readonly type: "start"; readonly seed: number; readonly speed: Speed; readonly parkiet?: string }
  | { readonly type: "speed"; readonly speed: Speed }
  | { readonly type: "focus"; readonly ticker: Ticker | null };

export interface FromWorker {
  readonly type: "snapshot";
  readonly snapshot: Snapshot;
}

/** Swieca jednego kroku gieldy; `day` pozwala zaznaczyc na wykresie poczatek dnia. */
export interface Bar {
  readonly day: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface BookLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface Print {
  readonly seq: number;
  readonly price: number;
  readonly quantity: number;
  /** Strona agresora: BUY = ktos kupil z oferty sprzedazy (transakcja w gore). */
  readonly side: "BUY" | "SELL";
}

/** Fundamenty z ksiag gospodarki. Kwoty w groszach. */
export interface Fundamentals {
  readonly cash: number;
  readonly debt: number;
  /** Roczny zysk w obecnym tempie (srednia z ~30 dni razy 360). */
  readonly earningsYear: number;
  readonly lastQuarter: number;
  readonly marketCap: number;
  /** Cena do zysku; null, gdy spolka nie zarabia. */
  readonly pe: number | null;
  readonly shares: number;
}

/** Wszystko do panelu jednej spolki — liczone tylko dla tej, ktora uzytkownik otworzyl. */
export interface Detail {
  readonly ticker: Ticker;
  readonly bars: readonly Bar[];
  /** Najlepsze poziomy arkusza, od najlepszej ceny. */
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  /** Ostatnie transakcje, najnowsza na koncu. */
  readonly tape: readonly Print[];
  readonly fundamentals: Fundamentals;
  /** Wiadomosci, ktore dotycza tej spolki, najnowsza na koncu. */
  readonly news: readonly Headline[];
}
