import { describe, expect, it } from "vitest";
import { ParkietFeed, grosze } from "./parkiet-feed.js";

const book = (symbol: string, sequence: number, bids: [string, number][], asks: [string, number][]) =>
  JSON.stringify({ type: "book", symbol, sequence, bids: bids.map(([price, quantity]) => ({ price, quantity, orders: 1 })), asks: asks.map(([price, quantity]) => ({ price, quantity, orders: 1 })) });
const trade = (symbol: string, sequence: number, price: string, quantity: number, takerSide: "BUY" | "SELL") =>
  JSON.stringify({ type: "trade", symbol, sequence, timestamp: "2026-10-28T12:00:00Z", price, quantity, takerSide, makerOrderId: 1, takerOrderId: 2 });

describe("ParkietFeed", () => {
  it("builds the stream address for the six companies from the http address", () => {
    expect(ParkietFeed.url("http://localhost:5173/parkiet")).toBe("ws://localhost:5173/parkiet/ws/market?symbols=RUD,STW,MTK,BPT,KSZ,GRS");
    expect(ParkietFeed.url("https://hossa.example/parkiet")).toBe("wss://hossa.example/parkiet/ws/market?symbols=RUD,STW,MTK,BPT,KSZ,GRS");
  });

  it("converts zloty to grosze without losing a grosz in floating point", () => {
    expect(grosze("34.40")).toBe(3440);
    expect(grosze("0.29")).toBe(29);
    expect(grosze("100000.05")).toBe(10_000_005);
  });

  it("starts empty, then shows the book and the trades of each company", () => {
    const feed = new ParkietFeed();
    expect(feed.quote("RUD")).toEqual({ bids: [], asks: [], tape: [] });
    feed.handle(book("RUD", 5, [["34.40", 10], ["34.35", 3]], [["34.50", 7]]));
    feed.handle(trade("RUD", 6, "34.50", 4, "BUY"));
    feed.handle(trade("RUD", 7, "34.40", 2, "SELL"));
    expect(feed.quote("RUD")).toEqual({
      last: 3440,
      bids: [
        { price: 3440, quantity: 10 },
        { price: 3435, quantity: 3 },
      ],
      asks: [{ price: 3450, quantity: 7 }],
      tape: [
        { seq: 1, price: 3450, quantity: 4, side: "BUY" },
        { seq: 2, price: 3440, quantity: 2, side: "SELL" },
      ],
    });
    expect(feed.quote("STW")).toEqual({ bids: [], asks: [], tape: [] });
  });

  it("drops what the last book already contains: an older book and trades from before it", () => {
    const feed = new ParkietFeed();
    feed.handle(book("MTK", 10, [["78.00", 5]], []));
    feed.handle(trade("MTK", 9, "77.00", 1, "SELL"));
    feed.handle(trade("MTK", 10, "77.50", 1, "SELL"));
    feed.handle(book("MTK", 8, [["70.00", 1]], []));
    expect(feed.quote("MTK")).toEqual({ bids: [{ price: 7800, quantity: 5 }], asks: [], tape: [] });
    feed.handle(trade("MTK", 11, "78.00", 2, "SELL"));
    expect(feed.quote("MTK").last).toBe(7800);
  });

  it("keeps the last forty trades and ignores companies and message types it does not know", () => {
    const feed = new ParkietFeed();
    for (let i = 1; i <= 45; i++) feed.handle(trade("GRS", i, "73.00", i, "BUY"));
    feed.handle(trade("CDR", 99, "1.00", 1, "BUY"));
    feed.handle(JSON.stringify({ type: "status", symbol: "GRS", sequence: 100 }));
    const tape = feed.quote("GRS").tape;
    expect(tape).toHaveLength(40);
    expect(tape[0]).toMatchObject({ seq: 6, quantity: 6 });
    expect(tape.at(-1)).toMatchObject({ seq: 45, quantity: 45 });
  });
});
