import { COMPANIES, Economy, Rng, TICKERS, type DayReport, type EconomicEvent, type News, type Ticker } from "@hossa/economy";
import { crowdFor, type Bot } from "./bots.js";
import { OrderIds, SymbolMarket, type CommandListener } from "./symbol-market.js";

export interface SessionOptions {
  readonly seed: number;
  /** Krokow gieldy na jeden dzien gospodarki. */
  readonly stepsPerDay?: number;
  /** Dostaje kazde zlecenie i anulowanie wszystkich rynkow, w kolejnosci wykonania (tryb polaczony). */
  readonly onCommand?: CommandListener;
}

/**
 * Sesja: gospodarka miasteczka plus gielda szesciu spolek. Na poczatku kazdego dnia gospodarka
 * robi krok, wiadomosci trafiaja do graczy, a potem gielda handluje `stepsPerDay` krokow.
 * Wszystko z jednego ziarna — ta sama sesja odtwarza sie co do transakcji.
 */
export class Session {
  readonly economy: Economy;
  readonly markets: Readonly<Record<Ticker, SymbolMarket>>;
  readonly bots: Readonly<Record<Ticker, readonly Bot[]>>;
  readonly stepsPerDay: number;
  /** Wszystkie wiadomosci od poczatku sesji. */
  readonly news: News[] = [];
  /** Wartosc indeksu miasteczka na koniec kazdego dnia (start = 1000). */
  readonly indexHistory: number[] = [];
  step = 0;
  lastDay: DayReport | undefined;

  private readonly rng: Rng;
  private readonly fairHistory = {} as Record<Ticker, number[]>;
  private readonly indexDivisor: number;

  constructor(options: SessionOptions) {
    this.stepsPerDay = options.stepsPerDay ?? 20;
    const root = new Rng(options.seed);
    this.economy = new Economy(root.nextSeed());
    this.rng = root.fork();
    const ids = new OrderIds();
    const markets = {} as Record<Ticker, SymbolMarket>;
    const bots = {} as Record<Ticker, Bot[]>;
    for (const t of TICKERS) {
      markets[t] = new SymbolMarket(t, this.economy.initialFair[t], ids, options.onCommand);
      bots[t] = crowdFor(t, this.rng);
      this.fairHistory[t] = [this.economy.fairValue(t)];
    }
    this.markets = markets;
    this.bots = bots;
    this.indexDivisor = this.capitalisation() / 1000;
  }

  get day(): number {
    return this.economy.day;
  }

  /** Zdarzenie wywolane recznie — zadziala od nastepnego dnia. */
  inject(event: EconomicEvent): void {
    this.economy.inject(event);
  }

  /** Indeks miasteczka: kapitalizacja szesciu spolek, na starcie 1000 pkt. */
  index(): number {
    return this.capitalisation() / this.indexDivisor;
  }

  fairValue(t: Ticker): number {
    return this.economy.fairValue(t);
  }

  tick(): void {
    if (this.step % this.stepsPerDay === 0) this.openDay();
    for (const t of TICKERS) {
      const market = this.markets[t];
      const history = this.fairHistory[t];
      const ctx = {
        market,
        step: this.step,
        stepsPerDay: this.stepsPerDay,
        fair: (lag: number) => history[Math.max(0, history.length - 1 - lag)] as number,
      };
      // kolejnosc graczy losowana co krok, zeby nikt nie mial stalego pierwszenstwa
      for (const bot of this.rng.shuffle([...this.bots[t]])) bot.act(ctx);
      market.endStep();
    }
    this.step += 1;
    if (this.step % this.stepsPerDay === 0) this.indexHistory.push(this.index());
  }

  runDays(days: number): void {
    for (let i = 0; i < days * this.stepsPerDay; i++) this.tick();
  }

  private openDay(): void {
    this.lastDay = this.economy.step();
    for (const t of TICKERS) {
      this.fairHistory[t].push(this.economy.fairValue(t));
      this.markets[t].openDay(this.economy.day);
    }
    for (const n of this.lastDay.news) {
      this.news.push(n);
      for (const [t, impact] of Object.entries(n.impacts) as [Ticker, number][]) {
        for (const bot of this.bots[t]) bot.onNews?.(impact, n);
      }
    }
  }

  private capitalisation(): number {
    return TICKERS.reduce((sum, t) => sum + this.markets[t].last * COMPANIES[t].shares, 0);
  }
}
