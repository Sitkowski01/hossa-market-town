import { COMPANIES, TICKERS, type EconomicEvent, type Ticker } from "@hossa/economy";
import { describe, expect, it } from "vitest";
import { Session } from "./session.js";
import type { Command } from "./symbol-market.js";

const SEEDS = [1, 2, 3, 4, 5];

/** Kurs zamkniecia spolki `days` dni po zdarzeniu: [bez zdarzenia, ze zdarzeniem]. */
function counterfactual(seed: number, event: EconomicEvent, ticker: Ticker, days: number): [number, number] {
  const base = new Session({ seed });
  const hit = new Session({ seed });
  base.runDays(15);
  hit.runDays(15);
  hit.inject(event);
  base.runDays(days);
  hit.runDays(days);
  return [base.markets[ticker].last, hit.markets[ticker].last];
}

const majority = (results: boolean[]) => results.filter(Boolean).length >= results.length - 1;

describe("Session", () => {
  it("replays the same seed trade for trade", () => {
    const run = (seed: number) => {
      const s = new Session({ seed });
      s.runDays(30);
      return JSON.stringify(TICKERS.map((t) => s.markets[t].candles));
    };
    expect(run(7)).toBe(run(7));
    expect(run(8)).not.toBe(run(7));
  });

  it("passes every command of every market to the listener, in the order they ran", () => {
    const commands: Command[] = [];
    const session = new Session({ seed: 7, onCommand: (c) => commands.push(c) });
    for (let i = 0; i < 40; i++) session.tick();
    const submits = commands.filter((c) => c.kind === "submit");
    expect(new Set(commands.map((c) => c.ticker)).size).toBe(6);
    expect(submits.map((c) => c.orderId)).toEqual([...submits.map((c) => c.orderId)].sort((a, b) => a - b));
    expect(commands.some((c) => c.kind === "cancel")).toBe(true);
    // ten sam przebieg co bez sluchacza: tryb polaczony nie zmienia sesji
    const plain = new Session({ seed: 7 });
    for (let i = 0; i < 40; i++) plain.tick();
    expect(plain.index()).toBe(session.index());
  });

  it("keeps the books balanced: every share bought was sold and every grosz paid was received", () => {
    const s = new Session({ seed: 11 });
    s.runDays(60);
    for (const t of TICKERS) {
      expect(s.bots[t].reduce((sum, b) => sum + b.account.position, 0)).toBe(0);
      expect(s.bots[t].reduce((sum, b) => sum + b.account.cash, 0)).toBe(0);
    }
  });

  it("builds a candle per day with consistent prices and real trading", () => {
    const s = new Session({ seed: 12, stepsPerDay: 10 });
    s.runDays(20);
    expect(s.step).toBe(200);
    expect(s.day).toBe(20);
    expect(s.indexHistory).toHaveLength(20);
    for (const t of TICKERS) {
      const candles = s.markets[t].candles;
      expect(candles.map((c) => c.day)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      for (const c of candles) {
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      }
      expect(candles.reduce((v, c) => v + c.volume, 0)).toBeGreaterThan(500); // jest handel, nie tylko kwotowania
    }
  });

  it("moves the index with market capitalisation", () => {
    const s = new Session({ seed: 14 });
    const cap = () => TICKERS.reduce((sum, t) => sum + s.markets[t].last * COMPANIES[t].shares, 0);
    const start = cap();
    s.runDays(30);
    expect(s.index()).toBeCloseTo((1000 * cap()) / start, 6);
    expect(s.indexHistory.at(-1)).toBeCloseTo(s.index(), 6);
  });

  it("starts the town index at 1000 and passes news to the traders", () => {
    const s = new Session({ seed: 13 });
    expect(s.index()).toBeCloseTo(1000);
    s.runDays(45);
    expect(s.news.some((n) => n.kind === "STOPY")).toBe(true);
    expect(s.lastDay?.day).toBe(45);
  });

  it("prices follow the companies' fair value over time", () => {
    for (const seed of [21, 22]) {
      const s = new Session({ seed });
      const gaps: number[] = [];
      for (let d = 0; d < 150; d++) {
        s.runDays(1);
        if (d >= 30) for (const t of TICKERS) gaps.push(Math.abs(s.markets[t].last / s.fairValue(t) - 1));
      }
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(mean).toBeLessThan(0.2);
    }
  });
});

describe("Session: the market reacts to events in the town (same seed, with and without)", () => {
  it("a strike at the mine pushes its share price down", () => {
    const r = SEEDS.map((seed) => counterfactual(seed, { kind: "STRAJK", ticker: "RUD", days: 20 }, "RUD", 10));
    expect(majority(r.map(([base, hit]) => hit < base))).toBe(true);
  });

  it("the mill suffers too once ore stops coming", () => {
    const r = SEEDS.map((seed) => counterfactual(seed, { kind: "STRAJK", ticker: "RUD", days: 25 }, "STW", 20));
    expect(majority(r.map(([base, hit]) => hit < base))).toBe(true);
  });

  it("a big export order lifts the factory", () => {
    const r = SEEDS.map((seed) => counterfactual(seed, { kind: "ZAMOWIENIE", ticker: "MTK", days: 25 }, "MTK", 10));
    expect(majority(r.map(([base, hit]) => hit > base))).toBe(true);
  });

  it("a rate hike pulls the whole town index down", () => {
    const r = SEEDS.map((seed) => {
      const base = new Session({ seed });
      const hit = new Session({ seed });
      base.runDays(15);
      hit.runDays(15);
      hit.inject({ kind: "STOPY", days: 1, size: 100 });
      base.runDays(5);
      hit.runDays(5);
      return hit.index() < base.index();
    });
    expect(majority(r)).toBe(true);
  });

  it("news moves the price on the same day, before profits change", () => {
    const dayAverage = (s: Session) => s.markets.RUD.history.slice(-s.stepsPerDay).reduce((x, y) => x + y, 0) / s.stepsPerDay;
    const r = SEEDS.map((seed) => {
      const base = new Session({ seed });
      const hit = new Session({ seed });
      base.runDays(15);
      hit.runDays(15);
      hit.inject({ kind: "ZLOZE", ticker: "RUD", days: 1 });
      base.runDays(1);
      hit.runDays(1);
      // wycena z gospodarki jeszcze ta sama (zysk nie zdazyl wzrosnac), a kurs juz wyzej
      expect(hit.fairValue("RUD")).toBeLessThanOrEqual(base.fairValue("RUD") * 1.01);
      return dayAverage(hit) > dayAverage(base);
    });
    expect(majority(r)).toBe(true);
  });
});
