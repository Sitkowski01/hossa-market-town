import { COMPANIES, TECH, TICKERS, type EconomicEvent, type News } from "@hossa/economy";
import { Session } from "@hossa/market";
import { beforeAll, describe, expect, it } from "vitest";
import type { ShipPhase } from "../world/traffic.js";
import { SimClock } from "./clock.js";
import { BARS_SHOWN, type Snapshot } from "./protocol.js";
import { NEWS_SCANNED, Observer, detail, loadingDay, yards } from "./view.js";

/** Sesja jak w workerze: zegar idzie krokami, po kazdym kroku powstaje migawka. */
function run(seed: number, days: number, events: Record<number, EconomicEvent> = {}): Snapshot[] {
  return play(seed, days, events).shots;
}

function play(seed: number, days: number, events: Record<number, EconomicEvent> = {}): { session: Session; shots: Snapshot[] } {
  const session = new Session({ seed, stepsPerDay: 4 });
  const clock = new SimClock(session.stepsPerDay);
  const observer = new Observer(seed);
  const shots: Snapshot[] = [];
  for (let step = 0; step < days * session.stepsPerDay; step++) {
    const event = step % session.stepsPerDay === 0 ? events[session.day] : undefined;
    if (event) session.inject(event);
    clock.time = step + 0.5;
    session.tick();
    shots.push(observer.snapshot(session, clock));
  }
  return { session, shots };
}

const lastOfDay = (shots: Snapshot[], day: number): Snapshot => shots.filter((s) => s.day === day).at(-1) as Snapshot;
const firstOfDay = (shots: Snapshot[], day: number): Snapshot => shots.find((s) => s.day === day) as Snapshot;

describe("Observer — migawka przed pierwszym krokiem", () => {
  it("pokazuje spolki po cenach startowych i pusty dziennik", () => {
    const session = new Session({ seed: 1, stepsPerDay: 4 });
    const shot = new Observer(1).snapshot(session, new SimClock(4));
    expect(shot.seed).toBe(1);
    expect(shot.day).toBe(0);
    expect(Object.keys(shot.companies)).toEqual([...TICKERS]);
    for (const t of TICKERS) {
      expect(shot.companies[t].price).toBeGreaterThan(0);
      expect(shot.companies[t].open).toBe(shot.companies[t].price);
    }
    expect(shot.index).toBeCloseTo(1000);
    expect(shot.indexOpen).toBe(1000);
    expect(shot.news).toEqual([]);
    expect(shot.ship).toBe("przy_nabrzezu");
    expect(shot.speed).toBe(1);
    expect(shot.stepsPerDay).toBe(4);
  });
});

describe("Observer — sesja w toku", () => {
  // sesja liczona w beforeAll, nie przy zbieraniu describe: blad w Observer ma oblac testy
  let shots: Snapshot[];
  let last: Snapshot;
  beforeAll(() => {
    shots = run(42, 12, { 2: { kind: "ZAMOWIENIE", ticker: "MTK", days: 20 } });
    last = shots.at(-1) as Snapshot;
  });

  it("cena otwarcia to otwarcie dzisiejszej swiecy", () => {
    const { session, shots: own } = play(42, 5);
    for (const t of TICKERS) expect((own.at(-1) as Snapshot).companies[t].open).toBe(session.markets[t].candles.at(-1)?.open);
  });

  it("czas, dzien i tempo pochodza z zegara i sesji", () => {
    expect(last.day).toBe(12);
    expect(last.time).toBe(12 * 4 - 0.5);
    expect(last.ticksPerMs).toBeCloseTo((4 * 1) / 40_000);
  });

  it("dziennik trzyma najwyzej 8 ostatnich wiadomosci z rosnacymi numerami", () => {
    const withNews = shots.find((s) => s.news.length > 0);
    expect(withNews).toBeDefined();
    for (const s of shots) {
      expect(s.news.length).toBeLessThanOrEqual(8);
      for (let i = 1; i < s.news.length; i++) expect(s.news[i]?.id).toBe((s.news[i - 1]?.id ?? 0) + 1);
    }
  });

  it("wysylki dnia jada tylko znanymi trasami i maja ladunek", () => {
    const routes = new Set(shots.flatMap((s) => s.dispatches.map((d) => d.route)));
    expect([...routes].sort()).toEqual(["MTK-BPT", "RUD-STW", "STW-BPT", "STW-MTK"]);
    for (const d of shots.flatMap((s) => s.dispatches)) expect(d.quantity).toBeGreaterThan(0);
  });

  it("produkcja i place sa w przedziale 0..1, a indeks otwarcia to wczorajsze zamkniecie", () => {
    for (const s of shots) {
      for (const t of TICKERS) expect(s.companies[t].output).toBeGreaterThanOrEqual(0);
      for (const t of TICKERS) expect(s.companies[t].output).toBeLessThanOrEqual(1);
      for (const v of Object.values(s.yards)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(s.yards)) expect(v).toBeLessThanOrEqual(1);
    }
    // ostatnia migawka dnia powstaje juz po zamknieciu, wiec porownujemy z pierwsza migawka nastepnego
    expect(firstOfDay(shots, 7).indexOpen).toBe(lastOfDay(shots, 6).index);
  });

  it("statek w zwyklym tygodniu odplywa i nastepnego dnia wraca", () => {
    const phases = Array.from({ length: 12 }, (_, d) => lastOfDay(shots, d + 1).ship);
    const out = phases.indexOf("wyplywa");
    expect(out).toBeGreaterThanOrEqual(0);
    expect(phases[out + 1]).toBe("wraca");
    // w dniu zaladunku na placach jest ladunek statku, choc gospodarka juz oproznila port
    const loadDay = lastOfDay(shots, out + 1);
    expect(loadDay.yards.portSteel + loadDay.yards.portMachines).toBeGreaterThan(0.5);
  });
});

describe("Observer — zdarzenia na makiecie", () => {
  it("strajk w kopalni zatrzymuje produkcje i trafia na liste zdarzen", () => {
    const shots = run(7, 4, { 1: { kind: "STRAJK", ticker: "RUD", days: 10 } });
    const day3 = lastOfDay(shots, 3);
    expect(day3.companies.RUD.output).toBe(0);
    expect(day3.companies.STW.output).toBeGreaterThan(0);
    const strikeNow = day3.incidents.find((i) => i.kind === "STRAJK");
    expect(strikeNow).toMatchObject({ ticker: "RUD" });
    const strikeBefore = lastOfDay(shots, 2).incidents.find((i) => i.kind === "STRAJK");
    // dzien pozniej strajk ma o dzien mniej do konca
    expect(strikeNow?.daysLeft).toBe((strikeBefore?.daysLeft ?? Number.NaN) - 1);
    const strike = day3.news.find((n) => n.text.includes("Strajk"));
    expect(strike?.tone).toBeLessThan(0);
  });

  it("w sztorm statek czeka na redzie, a po sztormie wraca do portu", () => {
    const shots = run(3, 9, { 1: { kind: "SZTORM", ticker: "BPT", days: 4 } });
    const phases: ShipPhase[] = Array.from({ length: 9 }, (_, d) => lastOfDay(shots, d + 1).ship);
    expect(phases.slice(1, 4)).toEqual(["chroni_sie", "na_redzie", "na_redzie"]);
    expect(phases.some((p) => p === "wraca" || p === "zawija")).toBe(true);
    // port stoi, dopoki statki nie moga wplynac
    expect(lastOfDay(shots, 3).companies.BPT.output).toBe(0);
    expect(lastOfDay(shots, 9).companies.BPT.output).toBe(1);
  });

  it("produkcja to dzisiejszy wynik podzielony przez moc zakladu", () => {
    const { session, shots } = play(11, 12, { 1: { kind: "WYPADEK", ticker: "RUD", days: 20 }, 2: { kind: "AWARIA", ticker: "MTK", days: 20 } });
    const produced = session.economy.last?.produced;
    const last = shots.at(-1) as Snapshot;
    expect(last.companies.RUD.output).toBeCloseTo((produced?.ore ?? 0) / TECH.oreCapacity);
    expect(last.companies.RUD.output).toBeLessThan(0.5);
    expect(last.companies.MTK.output).toBeCloseTo((produced?.machines ?? 0) / TECH.machineCapacity);
    expect(last.companies.MTK.output).toBeLessThan(0.75);
    // po 10 dniach slabego wydobycia hucie konczy sie ruda
    expect(last.companies.STW.output).toBeCloseTo((produced?.steel ?? 0) / TECH.steelCapacity);
    expect(last.companies.STW.output).toBeLessThan(1);
  });

  it("wydzwiek wiadomosci to srednia wplywu na wszystkie spolki, ktorych dotyczy", () => {
    const shots = run(7, 2, { 1: { kind: "STRAJK", ticker: "RUD", days: 5 } });
    // kopalnia -0,8, huta -0,3, fabryka -0,1
    const strike = (shots.at(-1) as Snapshot).news.find((n) => n.text.includes("Strajk"));
    expect(strike?.tone).toBeCloseTo(-0.4);
    // gospodarka wpisuje kopalnie na koniec, a pasek ma otworzyc ja, nie fabryke
    expect(strike?.tickers).toEqual(["RUD", "STW", "MTK"]);
  });

  it("nowe zloze dziala na stale i nie wisi na liscie zdarzen z liczba dni", () => {
    const shots = run(2, 3, { 1: { kind: "ZLOZE", ticker: "RUD", days: 1 } });
    expect((shots.at(-1) as Snapshot).incidents.map((i) => i.kind)).not.toContain("ZLOZE");
  });

  it("z dlugiego dziennika zostaje 8 najnowszych wiadomosci z numerami od poczatku sesji", () => {
    const hold: EconomicEvent = { kind: "STOPY", days: 1, size: 0 };
    const events = Object.fromEntries(Array.from({ length: 10 }, (_, d) => [d + 1, hold]));
    const { session, shots } = play(4, 11, events);
    const news = (shots.at(-1) as Snapshot).news;
    expect(news).toHaveLength(8);
    expect(news.at(-1)?.id).toBe(session.news.length - 1);
    expect(news[0]?.id).toBe(session.news.length - 8);
    expect(news[0]?.text).toBe(session.news.at(-8)?.headline);
  });
});

describe("Observer — zdarzenia bez spolki", () => {
  it("decyzja o stopach bez zmiany ma neutralny wydzwiek, a zdarzenie bez spolki nie ma tickera", () => {
    const shots = run(5, 3, { 1: { kind: "STOPY", days: 1, size: 0 }, 2: { kind: "NASTROJE", days: 5 } });
    const last = shots.at(-1) as Snapshot;
    expect(last.news.find((n) => n.text.includes("utrzymuje"))?.tone).toBe(0);
    expect(last.incidents).toContainEqual({ kind: "NASTROJE", daysLeft: 5 });
    // gorsze nastroje to mniej klientow w Koszyku (i mniej przechodniow na rynku)
    expect(last.companies.KSZ.output).toBeLessThan(lastOfDay(run(5, 2), 1).companies.KSZ.output);
  });
});

describe("loadingDay", () => {
  const empty = { mine: 0.4, millOre: 0.3, factory: 1, portSteel: 0, portMachines: 0 };

  it("bez zaladunku zostawia place bez zmian", () => {
    expect(loadingDay(empty, null)).toBe(empty);
  });

  it("w dniu zaladunku pokazuje w porcie to, co zabiera statek", () => {
    expect(loadingDay(empty, { steel: 1750, machines: 250 })).toEqual({ ...empty, portSteel: 0.5, portMachines: 0.25 });
    expect(loadingDay(empty, { steel: 9000, machines: 2000 })).toEqual({ ...empty, portSteel: 1, portMachines: 1 });
  });
});

describe("yards", () => {
  it("dzieli zapasy przez pojemnosc placow i przycina do 0..1", () => {
    expect(yards({ mineOre: 0, millOre: TECH.millOreYard / 4, millSteel: 0, factorySteel: 0, backlog: 0, portSteel: 0, portMachines: 0 }, 0).millOre).toBe(0.25);
    const y = yards({ mineOre: TECH.mineYard / 2, millOre: TECH.millOreYard * 2, millSteel: 0, factorySteel: 0, backlog: 0, portSteel: 700, portMachines: 100 }, -0.5);
    expect(y).toEqual({ mine: 0.5, millOre: 1, factory: 0, portSteel: 700 / 3500, portMachines: 100 / 1000 });
  });
});

describe("detail — panel spolki", () => {
  it("bez otwartego panelu migawka nie niesie szczegolow, z panelem niesie szczegoly tej spolki", () => {
    const { session } = play(42, 2);
    const observer = new Observer(42);
    expect(observer.snapshot(session, new SimClock(4)).detail).toBeUndefined();
    expect(observer.snapshot(session, new SimClock(4), "STW").detail?.ticker).toBe("STW");
  });

  it("swiece to ostatnie kroki rynku, a arkusz jest posortowany od najlepszej ceny", () => {
    const { session } = play(42, 20);
    const d = detail(session, "RUD");
    const market = session.markets.RUD;
    expect(d.bars).toHaveLength(BARS_SHOWN);
    expect(d.bars).toEqual(market.bars.slice(-BARS_SHOWN));
    expect(d.bars.at(-1)?.day).toBe(20);
    expect(d.bids.length).toBeGreaterThan(0);
    expect(d.asks.length).toBeGreaterThan(0);
    expect(d.bids.length).toBeLessThanOrEqual(8);
    expect(d.asks.length).toBeLessThanOrEqual(8);
    expect(d.bids[0]?.price).toBe(market.book.bestBid());
    expect(d.asks[0]?.price).toBe(market.book.bestAsk());
    for (let i = 1; i < d.bids.length; i++) expect(d.bids[i]?.price).toBeLessThan(d.bids[i - 1]?.price ?? 0);
    for (let i = 1; i < d.asks.length; i++) expect(d.asks[i]?.price).toBeGreaterThan(d.asks[i - 1]?.price ?? 0);
    expect(d.bids[0]).toEqual({ price: d.bids[0]?.price, quantity: market.book.depth("BUY", 1)[0]?.quantity });
  });

  it("tasma to 12 ostatnich transakcji", () => {
    const { session } = play(42, 5);
    const d = detail(session, "MTK");
    expect(d.tape).toEqual(session.markets.MTK.tape.slice(-12));
    expect(d.tape).toHaveLength(12);
  });

  it("fundamenty pochodza z ksiag gospodarki, a C/Z to kapitalizacja przez roczny zysk", () => {
    const { session } = play(42, 3);
    const f = detail(session, "KSZ").fundamentals;
    const economy = session.economy;
    expect(f.cash).toBe(economy.ledger.balance("KSZ"));
    expect(f.debt).toBe(COMPANIES.KSZ.debt);
    expect(f.shares).toBe(COMPANIES.KSZ.shares);
    expect(f.earningsYear).toBe(economy.earningsRunRate("KSZ"));
    expect(f.lastQuarter).toBe(economy.lastQuarterProfit.KSZ);
    expect(f.marketCap).toBe(session.markets.KSZ.last * COMPANIES.KSZ.shares);
    expect(f.pe).toBeCloseTo(f.marketCap / f.earningsYear);
    expect(f.earningsYear).toBeGreaterThan(0);
  });

  it("spolka bez zysku nie ma C/Z", () => {
    const { session } = play(42, 1);
    const economy = session.economy as unknown as { earningsEma: Record<string, number> };
    economy.earningsEma.STW = 0;
    expect(detail(session, "STW").fundamentals.pe).toBeNull();
    economy.earningsEma.STW = -100;
    expect(detail(session, "STW").fundamentals.pe).toBeNull();
  });

  it("wiadomosci spolki to najwyzej 5 najnowszych, ktore jej dotycza, z numerami z dziennika", () => {
    const strike: EconomicEvent = { kind: "STRAJK", ticker: "RUD", days: 1 };
    const events = Object.fromEntries(Array.from({ length: 7 }, (_, d) => [d * 2 + 1, strike]));
    const { session } = play(9, 15, { ...events, 2: { kind: "SZTORM", ticker: "BPT", days: 1 } });
    const d = detail(session, "RUD");
    expect(d.news).toHaveLength(5);
    for (const n of d.news) expect(n.tickers).toContain("RUD");
    expect(d.news.map((n) => n.id)).toEqual([...d.news.map((n) => n.id)].sort((a, b) => a - b));
    const own = session.news.map((n, i) => ({ n, i })).filter(({ n }) => "RUD" in n.impacts);
    expect(d.news.at(-1)?.id).toBe(own.at(-1)?.i);
    expect(d.news[0]?.text).toBe(own.at(-5)?.n.headline);
    // sztorm dotyczy portu, nie kopalni
    expect(d.news.some((n) => n.text.includes("Sztorm"))).toBe(false);
    expect(detail(session, "BPT").news.some((n) => n.tickers.includes("BPT"))).toBe(true);
  });

  it("szuka tylko w ostatnich NEWS_SCANNED wiadomosciach sesji", () => {
    const { session } = play(7, 2, { 1: { kind: "STRAJK", ticker: "RUD", days: 5 } });
    const filler: News = { day: 2, kind: "WYNIKI", headline: "Port bez zmian", impacts: { BPT: 0.1 }, weight: 0.1 };
    const lastOwn = session.news.findLastIndex((n) => "RUD" in n.impacts);
    // najnowsza wiadomosc o kopalni dokladnie na granicy okna: jeszcze widoczna
    while (session.news.length - lastOwn < NEWS_SCANNED) session.news.push(filler);
    expect(detail(session, "RUD").news.at(-1)?.id).toBe(lastOwn);
    session.news.push(filler);
    expect(detail(session, "RUD").news).toEqual([]);
  });

  it("wiadomosc w panelu ma wydzwiek dla tej spolki, a nie sredni", () => {
    const { session } = play(7, 2, { 1: { kind: "STRAJK", ticker: "RUD", days: 5 } });
    const strike = (t: "RUD" | "MTK") => detail(session, t).news.find((n) => n.text.includes("Strajk"));
    // srednia dla kopalni, huty i fabryki to -0,4
    expect(strike("RUD")?.tone).toBeCloseTo(-0.8);
    expect(strike("MTK")?.tone).toBeCloseTo(-0.1);
  });

  it("nazwa spolki w migawce pochodzi z gospodarki", () => {
    const shot = new Observer(1).snapshot(new Session({ seed: 1, stepsPerDay: 4 }), new SimClock(4));
    for (const t of TICKERS) expect(shot.companies[t].name).toBe(COMPANIES[t].name);
  });
});
