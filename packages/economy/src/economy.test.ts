import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COMPANIES, TECH, TICKERS } from "./companies.js";
import { Economy, type DayReport } from "./economy.js";
import type { EconomicEvent } from "./events.js";

const run = (e: Economy, days: number): DayReport[] => Array.from({ length: days }, () => e.step());

/** Ten sam swiat dwa razy: bez zdarzenia i ze zdarzeniem wstrzyknietym po `at` dniach. */
function counterfactual(seed: number, at: number, event: EconomicEvent, days: number) {
  const base = new Economy(seed);
  const hit = new Economy(seed);
  run(base, at);
  run(hit, at);
  hit.inject(event);
  return { base, hit, baseDays: run(base, days), hitDays: run(hit, days) };
}

describe("Economy: determinism and bookkeeping", () => {
  it("starts at day 0 after the warm-up with a positive valuation for every company", () => {
    const e = new Economy(1);
    expect(e.day).toBe(0);
    for (const t of TICKERS) expect(e.fairValue(t)).toBeGreaterThan(0);
    expect(e.fairValue("STW")).toBe(e.initialFair.STW);
  });

  it("repeats exactly for the same seed and differs for another one", () => {
    const a = JSON.stringify(run(new Economy(11), 200));
    expect(JSON.stringify(run(new Economy(11), 200))).toBe(a);
    expect(JSON.stringify(run(new Economy(12), 200))).not.toBe(a);
  });

  it("survives seed 48, where rounding once produced -1 machines", () => {
    const e = new Economy(48);
    expect(() => run(e, 120)).not.toThrow();
  });

  it("never creates or loses a grosz and never drives a stock below zero", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const e = new Economy(seed);
        const total = e.ledger.total();
        for (let d = 0; d < 120; d++) {
          const r = e.step();
          expect(e.ledger.total()).toBe(total);
          for (const v of Object.values(e.stocks)) expect(v).toBeGreaterThanOrEqual(-1e-9);
          expect(r.produced.steel).toBeLessThanOrEqual(TECH.steelCapacity);
          expect(e.stocks.backlog).toBeLessThanOrEqual(TECH.machineDemand * 30);
          expect(e.stocks.mineOre).toBeLessThanOrEqual(TECH.mineYard);
        }
      }),
      { numRuns: 15 },
    );
  });

  it("sends ore, steel and machines by truck to arrive the next day", () => {
    const e = new Economy(3);
    const r = e.step();
    const goods = new Set(r.dispatched.map((s) => `${s.from}>${s.to}:${s.good}`));
    expect(goods).toEqual(new Set(["RUD>STW:ruda", "STW>MTK:stal", "STW>BPT:stal", "MTK>BPT:maszyny"].filter((g) => goods.has(g))));
    expect(goods.has("RUD>STW:ruda")).toBe(true);
    for (const s of r.dispatched) expect(s.arrives).toBe(r.day + 1);
    expect(e.shipmentsInTransit().length).toBe(r.dispatched.length);
  });

  it("loads a ship every few days and pays exporters", () => {
    const days = run(new Economy(4), 20).filter((d) => d.ship);
    expect(days.length).toBeGreaterThanOrEqual(3);
    for (const d of days) expect(d.ship?.machines).toBeGreaterThan(0);
  });
});

describe("Economy: calendar", () => {
  it("publishes quarterly results for all six companies and pays dividends", () => {
    const e = new Economy(5);
    const days = run(e, TECH.daysPerQuarter);
    const results = days.at(-1)?.news.filter((n) => n.kind === "WYNIKI") ?? [];
    expect(results.map((n) => Object.keys(n.impacts)[0])).toEqual([...TICKERS]);
    expect(results[0]?.headline).toMatch(/^Kopalnia Rudawa: zysk za 1\. kwartał -?\d+,\d mln zł \([+-]\d+% wobec oczekiwań\)$/);
    for (const t of TICKERS) expect(e.lastQuarterProfit[t]).not.toBe(0);
    expect(days.slice(0, -1).some((d) => d.news.some((n) => n.kind === "WYNIKI"))).toBe(false);
  });

  it("a quarter without dividends stops the dividend income instead of repeating the last one", () => {
    const e = new Economy(5);
    const inside = e as unknown as { dividendStream: number; pendingDividend: Record<string, number> };
    run(e, TECH.daysPerQuarter - 1);
    expect(inside.dividendStream).toBeGreaterThan(0);
    run(e, 1); // zamkniecie kwartalu: dywidendy policzone, wyplata nastepnego dnia
    for (const t of TICKERS) inside.pendingDividend[t] = 0; // kwartal samych strat
    run(e, 1);
    expect(inside.dividendStream).toBe(0);
    run(e, 5); // zwykle dni bez wyplaty nie ruszaja strumienia
    expect(inside.dividendStream).toBe(0);
  });

  it("holds a central bank meeting every 45 days", () => {
    const days = run(new Economy(6), 135);
    const meetings = days.filter((d) => d.news.some((n) => n.kind === "STOPY")).map((d) => d.day);
    expect(meetings).toEqual([45, 90, 135]);
  });

  it("starts the shopping season on day 300 and people spend more", () => {
    const e = new Economy(8);
    const days = run(e, 315);
    expect(days[299]?.news.some((n) => n.kind === "SWIETA")).toBe(true);
    const before = days[297]?.retail ?? 0;
    expect(days[305]?.retail ?? 0).toBeGreaterThan(before * 1.2);
  });
});

describe("Economy: events change the economy (counterfactual: same seed, with and without)", () => {
  it("a mine strike stops ore, then starves the steel mill", () => {
    const { baseDays, hitDays } = counterfactual(21, 10, { kind: "STRAJK", ticker: "RUD", days: 15 }, 15);
    expect(hitDays[0]?.news[0]?.headline).toMatch(/Strajk w kopalni Rudawa/);
    expect(hitDays.every((d) => d.produced.ore === 0)).toBe(true);
    const steel = (ds: DayReport[]) => ds.slice(-5).reduce((s, d) => s + d.produced.steel, 0);
    expect(steel(hitDays)).toBeLessThan(steel(baseDays) * 0.5);
  });

  it("a strike makes the mine and the mill worth less", () => {
    const { base, hit } = counterfactual(22, 10, { kind: "STRAJK", ticker: "RUD", days: 20 }, 20);
    expect(hit.fairValue("RUD")).toBeLessThan(base.fairValue("RUD"));
    expect(hit.fairValue("STW")).toBeLessThan(base.fairValue("STW"));
  });

  it("a storm keeps ships out until it passes, then the port is cleared", () => {
    const { hitDays } = counterfactual(23, 10, { kind: "SZTORM", ticker: "BPT", days: 6 }, 12);
    expect(hitDays.slice(0, 6).every((d) => d.ship === null)).toBe(true);
    expect(hitDays.slice(6).some((d) => d.ship !== null)).toBe(true);
  });

  it("a storm delays the exporters' cash but not their sales; the port pays for idle ships", () => {
    const { base, hit, baseDays, hitDays } = counterfactual(34, 10, { kind: "SZTORM", ticker: "BPT", days: 8 }, 8);
    const sum = (ds: DayReport[], t: "MTK" | "BPT") => ds.reduce((s, d) => s + d.profit[t], 0);
    expect(Math.abs(sum(hitDays, "MTK") - sum(baseDays, "MTK"))).toBeLessThan(Math.abs(sum(baseDays, "MTK")) * 0.05);
    expect(base.ledger.balance("MTK") - hit.ledger.balance("MTK")).toBeGreaterThan(0);
    expect(sum(baseDays, "BPT") - sum(hitDays, "BPT")).toBeCloseTo(8 * TECH.stormCost, -2);
  });

  it("a decision without a size keeps rates where they were", () => {
    const { base, hit } = counterfactual(33, 10, { kind: "STOPY", days: 1 }, 1);
    expect(hit.rateBp).toBe(base.rateBp);
  });

  it("a rate hike lowers every valuation at once and raises interest costs", () => {
    const { base, hit } = counterfactual(24, 10, { kind: "STOPY", days: 1, size: 100 }, 1);
    expect(hit.rateBp).toBe(base.rateBp + 100);
    for (const t of TICKERS) expect(hit.fairValue(t)).toBeLessThan(base.fairValue(t));
  });

  it("dearer coal cuts the mill's profit", () => {
    const { baseDays, hitDays } = counterfactual(25, 10, { kind: "ENERGIA", ticker: "STW", days: 10 }, 10);
    const profit = (ds: DayReport[]) => ds.reduce((s, d) => s + d.profit.STW, 0);
    expect(profit(hitDays)).toBeLessThan(profit(baseDays));
  });

  it("a big order fills the factory's order book and pays a premium", () => {
    const { base, hit, baseDays, hitDays } = counterfactual(26, 10, { kind: "ZAMOWIENIE", ticker: "MTK", days: 10 }, 10);
    expect(hit.stocks.backlog).toBeGreaterThan(base.stocks.backlog);
    const sum = (ds: DayReport[]) => ds.reduce((s, d) => s + d.profit.MTK, 0);
    expect(sum(hitDays)).toBeGreaterThan(sum(baseDays) * 1.1);
    expect(hit.fairValue("MTK")).toBeGreaterThan(base.fairValue("MTK"));
  });

  it("bad loans cut the bank's value by the loss, not its future earnings", () => {
    const { base, hit } = counterfactual(27, 10, { kind: "ZLE_DLUGI", ticker: "GRS", days: 1 }, 1);
    const loans = TICKERS.reduce((s, t) => s + COMPANIES[t].debt, 0);
    const perShare = (loans * TECH.badLoans) / COMPANIES.GRS.shares;
    expect(base.fairValue("GRS") - hit.fairValue("GRS")).toBeCloseTo(perShare, -1);
    expect(hit.earningsRunRate("GRS")).toBeCloseTo(base.earningsRunRate("GRS"), -2);
  });

  it("gloomy households spend less in the shops", () => {
    const { baseDays, hitDays } = counterfactual(28, 10, { kind: "NASTROJE", ticker: "KSZ", days: 10 }, 5);
    expect(hitDays[2]?.retail ?? 0).toBeLessThan((baseDays[2]?.retail ?? 0) * 0.9);
  });

  it("shop demand drops with gloomy households and rises in the shopping season", () => {
    expect(counterfactual(28, 10, { kind: "NASTROJE", ticker: "KSZ", days: 10 }, 5).hit.demand()).toBeLessThan(1);
    expect(counterfactual(28, 10, { kind: "SWIETA", ticker: "KSZ", days: 10 }, 5).hit.demand()).toBeGreaterThan(1);
    expect(new Economy(28).demand()).toBe(1); // po rozruchu, ktory jest bez zdarzen
  });

  it("a breakdown halves the factory and a new deposit raises the mine for good", () => {
    const a = counterfactual(29, 10, { kind: "AWARIA", ticker: "MTK", days: 5 }, 3);
    expect(a.hit.capacity("MTK")).toBe(0.5);
    const z = counterfactual(30, 10, { kind: "ZLOZE", ticker: "RUD", days: 1 }, 100);
    expect(z.hit.capacity("RUD")).toBeCloseTo(z.base.capacity("RUD") * 1.2);
  });

  it("effects expire after their days", () => {
    const { hit } = counterfactual(31, 10, { kind: "WYPADEK", ticker: "RUD", days: 4 }, 6);
    expect(hit.activeEffects().some((e) => e.kind === "WYPADEK" && e.until <= hit.day)).toBe(false);
  });

  it("never falls below 15% of the starting valuation", () => {
    const { hit } = counterfactual(32, 5, { kind: "STRAJK", ticker: "MTK", days: 60 }, 60);
    expect(hit.fairValue("MTK")).toBeGreaterThanOrEqual(Math.round(hit.initialFair.MTK * 0.15));
  });
});
