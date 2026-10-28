import { OrderBook, orderRequest, type BookEvent } from "@hossa/engine";
import { TICKERS, type Ticker } from "@hossa/economy";
import type { Command } from "@hossa/market";
import { describe, expect, it } from "vitest";
import { ParkietMirror, type Http } from "./parkiet.js";

const BASE = "http://parkiet";

/** Parkiet w pamieci: ten sam silnik co w przegladarce za REST-em o ksztalcie prawdziwego API. */
function fakeParkiet(options: { readonly symbols?: readonly string[] } = {}): { http: Http; books: Map<string, OrderBook>; requests: string[] } {
  const books = new Map<string, OrderBook>((options.symbols ?? TICKERS).map((t) => [t, new OrderBook()]));
  const requests: string[] = [];
  let nextId = 1;
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const http: Http = (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(BASE, "");
    requests.push(`${method} ${path}`);
    if (path === "/api/instruments") return reply([...books.keys()]);
    const [, symbol = "", rest = ""] = /^\/api\/instruments\/(\w+)\/(.*)$/.exec(path) ?? [];
    const book = books.get(symbol) as OrderBook;
    if (rest === "book") return reply({ bids: book.depth("BUY", 10), asks: book.depth("SELL", 10) });
    const body = JSON.parse(init?.body as string) as { side: "BUY" | "SELL"; type: "LIMIT" | "MARKET"; price?: string; quantity: number };
    const id = nextId++;
    const price = body.price === undefined ? 0 : Math.round(Number(body.price) * 100);
    book.submit(orderRequest(id, body.side, body.type, price, body.quantity));
    return reply({ orderId: id, runId: 3, events: [] }, 201);
  };
  return { http, books, requests };
}

const submit = (ticker: Ticker, orderId: number, side: "BUY" | "SELL", price: number, quantity: number, events: BookEvent[]): Command => ({ kind: "submit", ticker, orderId, side, type: "LIMIT", price, quantity, events });
const rested = (orderId: number, side: "BUY" | "SELL", price: number, quantity: number): BookEvent[] => [{ kind: "RESTED", orderId, side, price, quantity }];

describe("ParkietMirror", () => {
  it("sends prices in zloty, no price for a market order, and a client order id with the session tag", async () => {
    const parkiet = fakeParkiet();
    const bodies: unknown[] = [];
    const mirror = new ParkietMirror(BASE, "h7-abc", (url, init) => {
      if (init?.method === "POST") bodies.push(JSON.parse(init.body as string));
      return parkiet.http(url, init);
    });
    mirror.push(submit("RUD", 5, "SELL", 3440, 10, rested(5, "SELL", 3440, 10)));
    mirror.push({ kind: "submit", ticker: "RUD", orderId: 6, side: "BUY", type: "MARKET", price: 0, quantity: 4, events: [{ kind: "TRADE", makerOrderId: 5, takerOrderId: 6, takerSide: "BUY", price: 3440, quantity: 4 }] });
    await mirror.idle();
    expect(bodies).toEqual([
      { side: "SELL", type: "LIMIT", price: "34.40", quantity: 10, clientOrderId: "h7-abc-5" },
      { side: "BUY", type: "MARKET", quantity: 4, clientOrderId: "h7-abc-6" },
    ]);
    expect(mirror.stats()).toEqual({ state: "ready", sent: 2, pending: 0, failed: 0 });
    expect(parkiet.books.get("RUD")?.depth("SELL", 1)).toEqual([{ price: 3440, quantity: 6, orders: 1 }]);
  });

  it("refuses to mirror into a Parkiet without the town's companies or with orders left from another session", async () => {
    const strange = new ParkietMirror(BASE, "h", fakeParkiet({ symbols: ["RUD", "CDR"] }).http);
    await strange.idle();
    expect(strange.stats()).toMatchObject({ state: "error", lastError: "Parkiet nie zna spolek STW, MTK, BPT, KSZ, GRS" });

    const used = fakeParkiet();
    used.books.get("GRS")?.submit(orderRequest(1, "BUY", "LIMIT", 100, 1));
    const mirror = new ParkietMirror(BASE, "h", used.http);
    mirror.push(submit("RUD", 1, "BUY", 3000, 1, rested(1, "BUY", 3000, 1)));
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ state: "error", sent: 0, pending: 0, lastError: "arkusze Parkietu nie sa puste — zrestartuj kontener" });
    expect(used.requests.filter((r) => r.startsWith("POST"))).toEqual([]);
  });
});
