import { COMPANIES, TECH, TICKERS, zl, type Ticker } from "./companies.js";
import { newsOf, type EconomicEvent, type Effect, type News } from "./events.js";
import { Incidents } from "./incidents.js";
import { Ledger } from "./ledger.js";
import { Logistics, type Produced, type Shipment, type Stocks } from "./logistics.js";
import { Rng } from "./rng.js";
import { applyRate, dividend, quarterNews } from "./rules.js";

/** Co sie dzialo danego dnia — dla makiety i wiadomosci. */
export interface DayReport {
  readonly day: number;
  readonly produced: Produced;
  readonly dispatched: readonly Shipment[];
  readonly ship: { readonly steel: number; readonly machines: number } | null;
  readonly retail: number; // wydatki mieszkancow w sklepach (grosze)
  readonly news: readonly News[];
  /** Zysk dnia memorialowo (sprzedaz eksportowa liczona przy wysylce do portu), grosze. */
  readonly profit: Readonly<Record<Ticker, number>>;
}

const EMA_DAYS = 30; // okno sredniej zysku, na ktorej opiera sie wycena
const WARMUP_DAYS = 150;
const perTicker = (value: number) => Object.fromEntries(TICKERS.map((t) => [t, value])) as Record<Ticker, number>;

/**
 * Gospodarka miasteczka krok po kroku (1 krok = 1 dzien): logistyka, zdarzenia, pieniadze, kwartaly
 * i wycena. Deterministyczna — losuje tylko z wlasnego generatora i zawsze tyle samo razy dziennie.
 */
export class Economy {
  day = -WARMUP_DAYS;
  rateBp = 500;
  readonly ledger = new Ledger({ HH: zl(100_000_000), SWIAT: zl(100_000_000_000), ...perTicker(zl(50_000_000)) });
  /** Zysk w ostatnim kwartale (grosze), do porownania z kolejnym raportem. */
  readonly lastQuarterProfit = perTicker(0);
  readonly initialFair = perTicker(0);
  last: DayReport | undefined;

  private readonly logistics = new Logistics(this.day + TECH.shipEvery);
  private readonly incidents = new Incidents();
  private readonly rng: Rng;
  private live = false;
  private incomeEma = zl(900_000);
  /** Dywidendy rozlozone na dni kwartalu — tyle dziennie mieszkancy licza jako dochod z akcji. */
  private dividendStream = 0;
  /** Kwartal zamkniety wczoraj: dzisiejsza wyplata (nawet zerowa) wyznacza nowy strumien dywidend. */
  private payoutDue = false;
  private readonly earningsEma = perTicker(0);
  private readonly quarterProfit = perTicker(0);
  private readonly expectedQuarter = perTicker(0);
  /** Jednorazowe straty: dnia (pomijane w sredniej), kwartalu (pomijane w niespodziance) i suma (obniza wycene). */
  private readonly oneOff = perTicker(0);
  private readonly quarterOneOff = perTicker(0);
  private readonly writedowns = perTicker(0);
  private readonly pendingDividend = perTicker(0);

  constructor(seed: number) {
    this.rng = new Rng(seed);
    // Rozruch bez zdarzen od dnia -150 do 0: zapasy, kolejki i srednie zyskow dochodza do stanu ustalonego.
    while (this.day < 0) {
      // W polowie rozruchu mieszkancy zaczynaja liczyc na dywidendy z biezacych zyskow — bez skoku po starcie.
      if (this.day === -WARMUP_DAYS / 2) {
        const yearly = TICKERS.reduce((sum, t) => sum + dividend(this.earningsEma[t] * TECH.daysPerQuarter), 0);
        this.dividendStream = (yearly * TECH.localOwnership) / TECH.daysPerQuarter;
      }
      this.step();
    }
    for (const t of TICKERS) {
      this.quarterProfit[t] = 0;
      this.expectedQuarter[t] = this.earningsEma[t] * TECH.daysPerQuarter;
      this.lastQuarterProfit[t] = this.expectedQuarter[t];
      this.initialFair[t] = this.fairValue(t);
    }
    this.live = true;
  }

  get stocks(): Stocks {
    return this.logistics.stocks;
  }

  /** Zdarzenie wywolane recznie (testy kontrfaktyczne, pokaz) — zadziala od nastepnego dnia. */
  inject(event: EconomicEvent): void {
    this.incidents.inject(event);
  }

  capacity(t: Ticker): number {
    return this.incidents.capacity(t);
  }

  /** Sklonnosc mieszkancow do zakupow wzgledem zwyklej (1): mniej przy zlych nastrojach, wiecej w swieta. */
  demand(): number {
    return this.incidents.factor("confidence");
  }

  activeEffects(): readonly Effect[] {
    return this.incidents.active();
  }

  shipmentsInTransit(): readonly Shipment[] {
    return this.logistics.transit;
  }

  pipeline(): Record<Ticker, number> {
    return this.logistics.pipeline();
  }

  /** Roczny zysk w obecnym tempie (srednia z ostatnich ~30 dni razy 360), grosze. */
  earningsRunRate(t: Ticker): number {
    return this.earningsEma[t] * TECH.daysPerYear;
  }

  /**
   * Wartosc godziwa akcji w groszach: roczny zysk razy mnoznik 1 / (stopa + premia za ryzyko),
   * podzielone na akcje. Wyzsze stopy = nizszy mnoznik i wyzsze odsetki = nizsza wycena.
   * Straty jednorazowe obnizaja wycene o swoja kwote. Ponizej 15% poczatkowej nie spada.
   */
  fairValue(t: Ticker): number {
    const info = COMPANIES[t];
    const multiple = 1 / (this.rateBp / 10_000 + info.premium);
    const value = Math.round((this.earningsRunRate(t) * multiple - this.writedowns[t]) / info.shares);
    return Math.max(value, Math.round(this.initialFair[t] * 0.15));
  }

  step(): DayReport {
    const L = this.ledger;
    L.startDay();
    const day = (this.day += 1);
    const dividendsToday = this.payDividends();
    const cashStart = perTicker(0);
    for (const t of TICKERS) cashStart[t] = L.balance(t);
    const pipelineStart = this.logistics.pipeline();

    const news: News[] = [];
    for (const event of this.incidents.startDay(day, this.rng, this.rateBp, this.live)) this.fire(event, news);

    const inc = this.incidents;
    this.logistics.deliver(day, L);
    const noise = this.rng.range(0.85, 1.15); // losowane zawsze, zeby strumien losowan sie nie przesuwal
    const produced = this.logistics.produce({ capacity: (t) => inc.capacity(t), coal: inc.factor("coal"), demand: inc.factor("demand"), noise }, L);
    L.transfer("SWIAT", "MTK", produced.machines * TECH.machinePrice * inc.premium()); // doplata z kontraktu
    const dispatched = this.logistics.dispatch(day, produced.machines);
    const ship = this.logistics.ship(day, inc.storm(), L);

    this.payCosts();
    const retail = this.shopping(dividendsToday);

    // Zysk dnia memorialowo: zmiana gotowki plus zmiana naleznosci za towar sprzedany na eksport,
    // ktory jeszcze czeka na statek. Sztorm opoznia pieniadze, ale nie kasuje sprzedazy.
    const pipelineEnd = this.logistics.pipeline();
    const profit = perTicker(0);
    for (const t of TICKERS) {
      profit[t] = L.balance(t) - cashStart[t] + pipelineEnd[t] - pipelineStart[t];
      this.earningsEma[t] += (profit[t] + this.oneOff[t] - this.earningsEma[t]) / EMA_DAYS;
      this.quarterOneOff[t] += this.oneOff[t];
      this.oneOff[t] = 0;
      this.quarterProfit[t] += profit[t];
    }
    if (this.live && day % TECH.daysPerQuarter === 0) this.closeQuarter(news);

    this.last = { day, produced, dispatched, ship, retail, news, profit };
    return this.last;
  }

  private fire(event: EconomicEvent, news: News[]): void {
    if (event.kind === "STOPY") {
      this.rateBp = applyRate(this.rateBp, event.size ?? 0);
    } else if (event.kind === "ZLE_DLUGI") {
      const loss = Math.round(TICKERS.reduce((sum, t) => sum + COMPANIES[t].debt, 0) * TECH.badLoans);
      this.ledger.transfer("GRS", "SWIAT", loss);
      // Strata jednorazowa: obniza majatek banku, ale nie przyszle zyski — nie wchodzi do sredniej.
      this.oneOff.GRS += loss;
      this.writedowns.GRS += loss;
    }
    this.incidents.start(event, this.day);
    news.push(newsOf(event, this.day, this.rateBp));
  }

  /** Dywidendy za zamkniety wczoraj kwartal: czesc dla mieszkancow, reszta dla inwestorow z zewnatrz. */
  private payDividends(): number {
    let local = 0;
    for (const t of TICKERS) {
      const toTown = Math.round(this.pendingDividend[t] * TECH.localOwnership);
      this.ledger.transfer(t, "HH", toTown);
      this.ledger.transfer(t, "SWIAT", this.pendingDividend[t] - toTown);
      local += toTown;
      this.pendingDividend[t] = 0;
    }
    // Mieszkancy wydaja je rozsadnie: do dochodu po 1/90 dziennie przez caly kwartal. Kwartal bez
    // dywidend (same straty) zeruje strumien — inaczej liczyliby dochod, ktorego nie dostali.
    if (this.payoutDue) {
      this.dividendStream = local / TECH.daysPerQuarter;
      this.payoutDue = false;
    }
    return local;
  }

  /** Koszty stale (czesc to pensje), odsetki od kredytow i odsetki od lokat mieszkancow. */
  private payCosts(): void {
    const daily = (bp: number) => bp / 10_000 / TECH.daysPerYear;
    let loans = 0;
    for (const t of TICKERS) {
      const info = COMPANIES[t];
      this.ledger.transfer(t, "HH", info.fixedCost * info.wageShare);
      this.ledger.transfer(t, "SWIAT", info.fixedCost * (1 - info.wageShare));
      this.ledger.transfer(t, "GRS", info.debt * daily(this.rateBp + TECH.bankSpreadBp));
      loans += info.debt;
    }
    this.ledger.transfer("GRS", "HH", loans * TECH.depositShare * daily(this.rateBp));
  }

  /** Zakupy mieszkancow ze sredniego dochodu; towar w sklepach pochodzi z importu przez port. */
  private shopping(dividendsToday: number): number {
    const income = this.ledger.inflow("HH") - dividendsToday + this.dividendStream;
    this.incomeEma += (income - this.incomeEma) / 20;
    const retail = Math.round(TECH.propensity * this.incomeEma * this.incidents.factor("confidence"));
    const imports = retail * (1 - TECH.retailMargin);
    this.ledger.transfer("HH", "KSZ", retail);
    this.ledger.transfer("KSZ", "SWIAT", imports);
    this.ledger.transfer("KSZ", "BPT", imports * TECH.importPortFee);
    return retail;
  }

  private closeQuarter(news: News[]): void {
    for (const t of TICKERS) {
      const profit = this.quarterProfit[t];
      news.push(quarterNews(t, this.day, profit, this.expectedQuarter[t], this.quarterOneOff[t]));
      this.pendingDividend[t] = dividend(profit);
      this.payoutDue = true;
      this.lastQuarterProfit[t] = profit;
      this.quarterProfit[t] = 0;
      this.quarterOneOff[t] = 0;
      this.expectedQuarter[t] = this.earningsEma[t] * TECH.daysPerQuarter;
    }
  }
}
