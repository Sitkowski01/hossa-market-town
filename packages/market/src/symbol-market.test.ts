import { describe, expect, it } from "vitest";
import { OrderIds, SymbolMarket, TICK, roundTick, type Command, type Trader } from "./symbol-market.js";

const trader = (id: string): Trader => ({ id, account: { position: 0, cash: 0 }, resting: new Set() });

describe("roundTick", () => {
  it("rounds to 5 grosze and never below one tick", () => {
    expect(roundTick(1002)).toBe(1000);
    expect(roundTick(1003)).toBe(1005);
    expect(roundTick(1)).toBe(TICK);
    expect(roundTick(-50)).toBe(TICK);
    expect(roundTick(5e12)).toBe(1_000_000_000);
  });
});

describe("SymbolMarket", () => {
  it("settles a trade between the two traders at the maker price", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const seller = trader("s");
    const buyer = trader("b");
    m.openDay(1);
    m.submit(seller, "SELL", "LIMIT", 3000, 10);
    expect(seller.resting.size).toBe(1);
    m.submit(buyer, "BUY", "LIMIT", 3100, 4);
    expect(buyer.account).toEqual({ position: 4, cash: -12_000 });
    expect(seller.account).toEqual({ position: -4, cash: 12_000 });
    expect(seller.resting.size).toBe(1); // reszta 6 akcji dalej czeka
    expect(m.last).toBe(3000);
    expect(m.candles[0]).toEqual({ day: 1, open: 3000, high: 3000, low: 3000, close: 3000, volume: 4 });
  });

  it("forgets a resting order once it is filled in full", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const maker = trader("m");
    m.submit(maker, "BUY", "LIMIT", 2990, 5);
    m.submit(trader("t"), "SELL", "MARKET", 0, 5);
    expect(maker.resting.size).toBe(0);
    expect(maker.account.position).toBe(5);
  });

  it("taker selling into a bid: buyer is the maker", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const maker = trader("m");
    const taker = trader("t");
    m.submit(maker, "BUY", "LIMIT", 2990, 3);
    m.submit(taker, "SELL", "LIMIT", 2900, 3);
    expect(maker.account).toEqual({ position: 3, cash: -8970 });
    expect(taker.account).toEqual({ position: -3, cash: 8970 });
  });

  it("tracks high and low within a day", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const a = trader("a");
    const b = trader("b");
    m.openDay(1);
    m.submit(a, "SELL", "LIMIT", 3050, 1);
    m.submit(b, "BUY", "MARKET", 0, 1);
    m.submit(a, "BUY", "LIMIT", 2950, 1);
    m.submit(b, "SELL", "MARKET", 0, 1);
    expect(m.candles[0]).toMatchObject({ open: 3000, high: 3050, low: 2950, close: 2950, volume: 2 });
  });

  it("ignores orders smaller than one share and cancels everything of a trader", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const t = trader("t");
    expect(m.submit(t, "BUY", "LIMIT", 2990, 0.4)).toEqual([]);
    m.submit(t, "BUY", "LIMIT", 2990, 1);
    m.submit(t, "BUY", "LIMIT", 2980, 1);
    m.cancelAll(t);
    expect(t.resting.size).toBe(0);
    expect(m.book.bestBid()).toBeUndefined();
  });

  it("uses the midpoint when both sides exist and the last price otherwise", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    expect(m.mid()).toBe(3000);
    m.submit(trader("a"), "BUY", "LIMIT", 2990, 1);
    expect(m.mid()).toBe(3000);
    m.submit(trader("b"), "SELL", "LIMIT", 3020, 1);
    expect(m.mid()).toBe(3005);
  });

  it("measures volatility and remembers prices step by step", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    m.endStep();
    expect(m.volatility).toBe(0);
    m.last = 3300;
    m.endStep();
    expect(m.volatility).toBeCloseTo(0.1 / 20);
    expect(m.priceAgo(1)).toBe(3300);
    expect(m.priceAgo(2)).toBe(3000);
    expect(m.priceAgo(99)).toBe(3000);
    for (let i = 0; i < 500; i++) m.endStep();
    expect(m.history.length).toBe(400);
  });
});

describe("SymbolMarket bars and tape", () => {
  it("closes one candle per step that opens at the previous close", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const a = trader("a");
    const b = trader("b");
    m.openDay(1);
    m.submit(a, "SELL", "LIMIT", 3050, 2);
    m.submit(b, "BUY", "MARKET", 0, 2);
    m.endStep();
    m.endStep(); // krok bez transakcji: plaska swieca po ostatniej cenie
    m.openDay(2);
    m.submit(a, "BUY", "LIMIT", 2950, 1);
    m.submit(b, "SELL", "MARKET", 0, 1);
    m.endStep();
    expect(m.bars).toEqual([
      { day: 1, open: 3000, high: 3050, low: 3000, close: 3050, volume: 2 },
      { day: 1, open: 3050, high: 3050, low: 3050, close: 3050, volume: 0 },
      { day: 2, open: 3050, high: 3050, low: 2950, close: 2950, volume: 1 },
    ]);
  });

  it("a trade before the first day still lands in the step candle", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    m.submit(trader("a"), "SELL", "LIMIT", 3020, 4);
    m.submit(trader("b"), "BUY", "MARKET", 0, 4);
    m.endStep();
    expect(m.candles).toEqual([]);
    expect(m.bars).toEqual([{ day: 0, open: 3000, high: 3020, low: 3000, close: 3020, volume: 4 }]);
  });

  it("keeps the last 400 bars", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    for (let i = 0; i < 401; i++) {
      m.last = 3000 + 5 * i;
      m.endStep();
    }
    expect(m.bars.length).toBe(400);
    // swieca otwiera sie po cenie z konca poprzedniego kroku, a recznie ustawiona cena nie jest transakcja
    expect(m.bars[0]?.open).toBe(3000);
  });

  it("prints every trade with the aggressor side and keeps the last 40", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const a = trader("a");
    const b = trader("b");
    m.submit(a, "SELL", "LIMIT", 3010, 3);
    m.submit(b, "BUY", "MARKET", 0, 3);
    m.submit(a, "BUY", "LIMIT", 2990, 2);
    m.submit(b, "SELL", "LIMIT", 2990, 2);
    expect(m.tape).toEqual([
      { seq: 1, price: 3010, quantity: 3, side: "BUY" },
      { seq: 2, price: 2990, quantity: 2, side: "SELL" },
    ]);
    for (let i = 0; i < 50; i++) {
      m.submit(a, "SELL", "LIMIT", 3000, 1);
      m.submit(b, "BUY", "MARKET", 0, 1);
    }
    expect(m.tape.length).toBe(40);
    expect(m.tape.at(-1)?.seq).toBe(52);
    expect(m.tape[0]?.seq).toBe(13);
  });
});

describe("SymbolMarket: cancelling", () => {
  it("does not cancel another trader's order", () => {
    const m = new SymbolMarket("RUD", 3000, new OrderIds());
    const owner = trader("o");
    const other = trader("x");
    m.submit(owner, "BUY", "LIMIT", 2990, 5);
    m.cancel(other, 1);
    expect(m.book.bestBid()).toBe(2990);
    expect(owner.resting.has(1)).toBe(true);
    m.cancel(owner, 1);
    expect(m.book.bestBid()).toBeUndefined();
    expect(owner.resting.size).toBe(0);
  });
});

describe("SymbolMarket: commands for the connected mode", () => {
  it("reports every order with the rounded price, the clipped quantity and the engine's result", () => {
    const seen: Command[] = [];
    const m = new SymbolMarket("STW", 4000, new OrderIds(), (c) => seen.push(c));
    m.submit(trader("s"), "SELL", "LIMIT", 4002, 10.7);
    m.submit(trader("b"), "BUY", "MARKET", 9999, 4);
    expect(seen).toEqual([
      { kind: "submit", ticker: "STW", orderId: 1, side: "SELL", type: "LIMIT", price: 4000, quantity: 10, events: [{ kind: "RESTED", orderId: 1, side: "SELL", price: 4000, quantity: 10 }] },
      { kind: "submit", ticker: "STW", orderId: 2, side: "BUY", type: "MARKET", price: 0, quantity: 4, events: [{ kind: "TRADE", makerOrderId: 1, takerOrderId: 2, takerSide: "BUY", price: 4000, quantity: 4 }] },
    ]);
  });

  it("reports a cancel only while the order still rests, and nothing for an empty order", () => {
    const seen: Command[] = [];
    const m = new SymbolMarket("STW", 4000, new OrderIds(), (c) => seen.push(c));
    const maker = trader("m");
    m.submit(maker, "BUY", "LIMIT", 3900, 0.5);
    m.submit(maker, "BUY", "LIMIT", 3900, 5);
    m.submit(trader("t"), "SELL", "MARKET", 0, 5);
    m.cancel(maker, 1);
    m.submit(maker, "BUY", "LIMIT", 3800, 2);
    m.cancelAll(maker);
    expect(seen.map((c) => `${c.kind} ${String(c.orderId)}`)).toEqual(["submit 1", "submit 2", "submit 3", "cancel 3"]);
  });
});
