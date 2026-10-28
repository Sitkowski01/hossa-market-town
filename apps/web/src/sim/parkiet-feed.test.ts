import { Session } from "@hossa/market";
import { describe, expect, it } from "vitest";
import { SimClock } from "./clock.js";
import { ParkietFeed, grosze, withParkiet } from "./parkiet-feed.js";
import type { Link } from "./protocol.js";
import { DEPTH_LEVELS, Observer, TAPE_SHOWN } from "./view.js";

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
    expect(feed.quote("STW")).toStrictEqual({ bids: [], asks: [], tape: [] }); // bez pola last, nie last: undefined
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

describe("withParkiet", () => {
  const session = new Session({ seed: 3, stepsPerDay: 4 });
  for (let i = 0; i < 6; i++) session.tick();
  const shot = (focus: "RUD" | null) => new Observer(3).snapshot(session, new SimClock(4), focus);
  const link = (state: Link["state"]): Link => ({ state, sent: 10, matched: 10, mismatched: 0, pending: 0, failed: 0, streaming: true });
  const feed = new ParkietFeed();
  feed.handle(book("RUD", 4, [["30.00", 9]], [["30.10", 2]]));
  feed.handle(trade("RUD", 5, "30.10", 2, "BUY"));

  it("takes prices, the book and the tape from Parkiet, and the rest from the browser", () => {
    const local = shot("RUD");
    const mixed = withParkiet(local, feed, link("ready"));
    expect(mixed.companies.RUD).toEqual({ ...local.companies.RUD, price: 3010 });
    expect(mixed.companies.STW).toEqual(local.companies.STW); // bez transakcji na Parkiecie zostaje lokalna cena
    expect(mixed.detail).toEqual({ ...local.detail, bids: [{ price: 3000, quantity: 9 }], asks: [{ price: 3010, quantity: 2 }], tape: [{ seq: 1, price: 3010, quantity: 2, side: "BUY" }] });
    expect(mixed.link).toEqual(link("ready"));
    expect(mixed.index).toBe(local.index);
  });

  it("shows as many levels and trades as the panel shows for the browser engine", () => {
    const deep = new ParkietFeed();
    const many = Array.from({ length: 10 }, (_, i): [string, number] => [(30 - i / 10).toFixed(2), 1]);
    deep.handle(book("RUD", 1, many, many));
    for (let i = 2; i < 30; i++) deep.handle(trade("RUD", i, "30.00", i, "BUY"));
    const mixed = withParkiet(shot("RUD"), deep, link("ready"));
    expect(mixed.detail?.bids).toHaveLength(DEPTH_LEVELS);
    expect(mixed.detail?.asks).toHaveLength(DEPTH_LEVELS);
    expect(mixed.detail?.tape).toHaveLength(TAPE_SHOWN);
    expect(mixed.detail?.tape.at(-1)?.quantity).toBe(29);
  });

  it("without an open panel only the prices change", () => {
    const mixed = withParkiet(shot(null), feed, link("ready"));
    expect(mixed.detail).toBeUndefined();
    expect(mixed.companies.RUD.price).toBe(3010);
  });

  it("until the link is ready Parkiet's prices stay off the scene, only the link state is shown", () => {
    const local = shot("RUD");
    for (const state of ["connecting", "error"] as const) expect(withParkiet(local, feed, link(state))).toEqual({ ...local, link: link(state) });
  });
});
