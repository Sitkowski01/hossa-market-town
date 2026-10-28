import { COMPANIES, TECH, TICKERS, type DayReport, type News, type Stocks, type Ticker } from "@hossa/economy";
import type { Session } from "@hossa/market";
import { nextShipPhase, type ShipPhase } from "../world/traffic.js";
import type { SimClock } from "./clock.js";
import { BARS_SHOWN, type CompanyView, type Detail, type Dispatch, type Headline, type Incident, type Route, type Snapshot, type Yards } from "./protocol.js";

const NEWS_KEPT = 8;
export const DEPTH_LEVELS = 8;
export const TAPE_SHOWN = 12;
const COMPANY_NEWS = 5;
/** Ile ostatnich wiadomosci sesji przeszukuje panel spolki (kilka tygodni gry). */
export const NEWS_SCANNED = 200;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Port mierzy place ladunkiem jednego statku (wysylki z kilku dni). */
const PORT_STEEL = TECH.truckSteel * TECH.shipEvery;
const PORT_MACHINES = TECH.machineCapacity * TECH.shipEvery;

/** Zapelnienie placow wzgledem ich pojemnosci; port mierzy ladunkiem jednego statku. */
export function yards(stocks: Stocks, factoryOutput: number): Yards {
  return {
    mine: clamp01(stocks.mineOre / TECH.mineYard),
    millOre: clamp01(stocks.millOre / TECH.millOreYard),
    factory: clamp01(factoryOutput),
    portSteel: clamp01(stocks.portSteel / PORT_STEEL),
    portMachines: clamp01(stocks.portMachines / PORT_MACHINES),
  };
}

/**
 * W dniu zaladunku gospodarka oproznia port juz w kroku dnia, zanim powstanie pierwsza migawka.
 * Makieta pokazuje wtedy na placach to, co statek zabiera — dzwigi przenosza to rano.
 */
export function loadingDay(y: Yards, loaded: { readonly steel: number; readonly machines: number } | null): Yards {
  if (!loaded) return y;
  return { ...y, portSteel: clamp01(loaded.steel / PORT_STEEL), portMachines: clamp01(loaded.machines / PORT_MACHINES) };
}

const tone = (impacts: Partial<Record<Ticker, number>>): number => {
  const values = Object.values(impacts);
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
};

/** Spolki z wiadomosci od najmocniej dotknietej — pasek wiadomosci otwiera pierwsza. */
const affected = (impacts: Partial<Record<Ticker, number>>): Ticker[] =>
  (Object.entries(impacts) as [Ticker, number][]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).map(([t]) => t);

const headline = (n: News, id: number): Headline => ({ id, day: n.day, text: n.headline, tone: tone(n.impacts), tickers: affected(n.impacts) });

/** Panel jednej spolki: swiece z krokow, arkusz, tasma, fundamenty z ksiag i jej wiadomosci. */
export function detail(session: Session, t: Ticker): Detail {
  const market = session.markets[t];
  const economy = session.economy;
  const info = COMPANIES[t];
  const earningsYear = economy.earningsRunRate(t);
  const marketCap = market.last * info.shares;
  const news: Headline[] = [];
  // od konca i tylko ostatnie NEWS_SCANNED: spolka rzadko w wiadomosciach nie moze kazac przegladac
  // calej, wciaz rosnacej historii sesji 10 razy na sekunde
  const oldest = Math.max(0, session.news.length - NEWS_SCANNED);
  for (let i = session.news.length - 1; i >= oldest && news.length < COMPANY_NEWS; i--) {
    const n = session.news[i] as News;
    // wydzwiek dla tej spolki, nie sredni: strajk w kopalni to dla niej katastrofa, dla fabryki drobiazg
    const impact = n.impacts[t];
    if (impact !== undefined) news.unshift({ ...headline(n, i), tone: impact });
  }
  return {
    ticker: t,
    bars: market.bars.slice(-BARS_SHOWN),
    bids: market.book.depth("BUY", DEPTH_LEVELS).map(({ price, quantity }) => ({ price, quantity })),
    asks: market.book.depth("SELL", DEPTH_LEVELS).map(({ price, quantity }) => ({ price, quantity })),
    tape: market.tape.slice(-TAPE_SHOWN),
    fundamentals: {
      cash: economy.ledger.balance(t),
      debt: info.debt,
      earningsYear,
      lastQuarter: economy.lastQuarterProfit[t],
      marketCap,
      pe: earningsYear > 0 ? marketCap / earningsYear : null,
      shares: info.shares,
    },
    news,
  };
}

/**
 * Patrzy na sesje i sklada migawke dla sceny. Pamieta tylko to, czego sesja nie trzyma:
 * faze statku z poprzedniego dnia (zeby statek nie przeskakiwal).
 */
export class Observer {
  private ship: ShipPhase = "przy_nabrzezu";
  private seenDay = Number.NaN;

  constructor(private readonly seed: number) {}

  snapshot(session: Session, clock: SimClock, focus: Ticker | null = null): Snapshot {
    const economy = session.economy;
    // gospodarka po rozruchu zawsze ma raport (ostatni dzien rozruchu albo dzisiejszy)
    const report = economy.last as DayReport;
    const day = session.day;
    // rozruch gospodarki (dni <= 0) to przeszlosc — statek startuje przy nabrzezu
    if (report.day > 0 && report.day !== this.seenDay) {
      this.seenDay = report.day;
      const storm = economy.activeEffects().some((e) => e.kind === "SZTORM");
      this.ship = nextShipPhase(this.ship, storm, report.ship !== null);
    }
    const produced = report.produced;
    const output: Record<Ticker, number> = {
      RUD: produced.ore / TECH.oreCapacity,
      STW: produced.steel / TECH.steelCapacity,
      MTK: produced.machines / TECH.machineCapacity,
      BPT: economy.capacity("BPT"),
      KSZ: economy.capacity("KSZ"),
      GRS: economy.capacity("GRS"),
    };
    const companies = {} as Record<Ticker, CompanyView>;
    for (const t of TICKERS) {
      const market = session.markets[t];
      companies[t] = { name: COMPANIES[t].name, price: market.last, open: market.candles.at(-1)?.open ?? market.last, fair: session.fairValue(t), output: clamp01(output[t]) };
    }
    // raport jest z dzisiaj, wiec jego wysylki to dzisiejsze wyjazdy
    const dispatches: Dispatch[] = report.dispatched.map((s) => ({ route: `${s.from}-${s.to}` as Route, good: s.good, quantity: s.quantity }));
    const incidents: Incident[] = economy
      .activeEffects()
      .filter((e) => Number.isFinite(e.until))
      .map((e) => ({ kind: e.kind, ...(e.ticker ? { ticker: e.ticker } : {}), daysLeft: e.until - day }));
    const first = Math.max(0, session.news.length - NEWS_KEPT);
    const news: Headline[] = session.news.slice(first).map((n, i) => headline(n, first + i));
    return {
      seed: this.seed,
      day,
      time: clock.time,
      stepsPerDay: session.stepsPerDay,
      ticksPerMs: clock.ticksPerMs,
      speed: clock.speed,
      rateBp: economy.rateBp,
      index: session.index(),
      indexOpen: session.indexHistory.at(-1) ?? 1000,
      companies,
      dispatches,
      yards: loadingDay(yards(economy.stocks, companies.MTK.output), report.ship),
      ship: this.ship,
      incidents,
      news,
      ...(focus ? { detail: detail(session, focus) } : {}),
    };
  }
}
