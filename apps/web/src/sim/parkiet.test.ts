import { OrderBook, orderRequest, type BookEvent } from "@hossa/engine";
import { TICKERS, type Ticker } from "@hossa/economy";
import { Session, type Command } from "@hossa/market";
import { describe, expect, it } from "vitest";
import { MAX_BACKLOG, ParkietMirror, zloty, type Http } from "./parkiet.js";

const BASE = "http://parkiet";

interface FakeOptions {
  /** Pierwszy numer zlecenia — inny niz lokalny, zeby sprawdzic tlumaczenie numerow. */
  readonly firstId?: number;
  readonly symbols?: readonly string[];
  /** Psuje wynik silnika, zeby sprawdzic, ze rozbieznosc zostanie zauwazona. */
  readonly tamper?: (events: BookEvent[]) => BookEvent[];
}

/** Parkiet w pamieci: ten sam silnik co w przegladarce za REST-em o ksztalcie prawdziwego API. */
function fakeParkiet(options: FakeOptions = {}): { http: Http; books: Map<string, OrderBook>; requests: string[] } {
  const books = new Map<string, OrderBook>((options.symbols ?? TICKERS).map((t) => [t, new OrderBook()]));
  const requests: string[] = [];
  let nextId = options.firstId ?? 1;
  const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  const remote = (e: BookEvent) => {
    switch (e.kind) {
      case "RESTED":
        return { type: "RESTED", orderId: e.orderId, side: e.side, price: zloty(e.price), quantity: e.quantity };
      case "TRADE":
        return { type: "TRADE", makerOrderId: e.makerOrderId, takerOrderId: e.takerOrderId, takerSide: e.takerSide, price: zloty(e.price), quantity: e.quantity };
      case "CANCELLED":
        return { type: "CANCELLED", orderId: e.orderId, quantity: e.quantity, reason: e.reason };
    }
  };
  const http: Http = (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(BASE, "");
    requests.push(`${method} ${path}`);
    if (path === "/api/instruments") return reply([...books.keys()]);
    const [, symbol = "", rest = ""] = /^\/api\/instruments\/(\w+)\/(.*)$/.exec(path) ?? [];
    const book = books.get(symbol) as OrderBook;
    if (rest === "book") return reply({ bids: book.depth("BUY", 10), asks: book.depth("SELL", 10) });
    if (method === "POST") {
      const body = JSON.parse(init?.body as string) as { side: "BUY" | "SELL"; type: "LIMIT" | "MARKET"; price?: string; quantity: number };
      const id = nextId++;
      const price = body.price === undefined ? 0 : Math.round(Number(body.price) * 100);
      const events = (options.tamper ?? ((e) => e))(book.submit(orderRequest(id, body.side, body.type, price, body.quantity)));
      return reply({ orderId: id, runId: 3, events: events.map(remote) }, 201);
    }
    const [, id = "0"] = /orders\/(\d+)\?runId=3$/.exec(rest) ?? [];
    return book.cancel(Number(id)) ? reply({}) : reply({}, 404);
  };
  return { http, books, requests };
}

const submit = (ticker: Ticker, orderId: number, side: "BUY" | "SELL", price: number, quantity: number, events: BookEvent[]): Command => ({ kind: "submit", ticker, orderId, side, type: "LIMIT", price, quantity, events });
const rested = (orderId: number, side: "BUY" | "SELL", price: number, quantity: number): BookEvent[] => [{ kind: "RESTED", orderId, side, price, quantity }];

describe("ParkietMirror", () => {
  it("replays a whole session on Parkiet and every reply matches the engine in the browser", async () => {
    const parkiet = fakeParkiet({ firstId: 1001 });
    const mirror = new ParkietMirror(BASE, "h42", parkiet.http);
    const session = new Session({
      seed: 42,
      onCommand: (c) => {
        mirror.push(c);
      },
    });
    for (let i = 0; i < 60; i++) session.tick();
    await mirror.idle();
    const stats = mirror.stats();
    expect(stats.state).toBe("ready");
    expect(stats.sent).toBeGreaterThan(1000);
    expect(stats).toMatchObject({ matched: stats.sent, mismatched: 0, failed: 0, pending: 0 });
    for (const t of TICKERS) {
      expect(parkiet.books.get(t)?.depth("BUY", 5)).toEqual(session.markets[t].book.depth("BUY", 5));
      expect(parkiet.books.get(t)?.depth("SELL", 5)).toEqual(session.markets[t].book.depth("SELL", 5));
    }
  });

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
    expect(mirror.stats()).toMatchObject({ matched: 2, mismatched: 0 });
  });

  it("cancels on Parkiet under Parkiet's order number and run, and forgets orders filled in full", async () => {
    const parkiet = fakeParkiet({ firstId: 50 });
    const mirror = new ParkietMirror(BASE, "h", parkiet.http);
    mirror.push(submit("STW", 1, "BUY", 4000, 5, rested(1, "BUY", 4000, 5)));
    mirror.push(submit("STW", 2, "BUY", 3900, 5, rested(2, "BUY", 3900, 5)));
    mirror.push({ kind: "submit", ticker: "STW", orderId: 3, side: "SELL", type: "MARKET", price: 0, quantity: 5, events: [{ kind: "TRADE", makerOrderId: 1, takerOrderId: 3, takerSide: "SELL", price: 4000, quantity: 5 }] });
    mirror.push({ kind: "cancel", ticker: "STW", orderId: 2 });
    mirror.push({ kind: "cancel", ticker: "STW", orderId: 1 }); // juz zrealizowane: nie ma czego wysylac
    await mirror.idle();
    expect(parkiet.requests).toContain("DELETE /api/instruments/STW/orders/51?runId=3");
    expect(mirror.stats()).toMatchObject({ sent: 5, matched: 4, mismatched: 0, failed: 1 });
    expect(mirror.stats().lastError).toContain("zlecenie 1 nie doszło");
  });

  it("notices when Parkiet answers differently than the engine in the browser", async () => {
    const parkiet = fakeParkiet({ tamper: (events) => events.map((e) => (e.kind === "TRADE" ? { ...e, price: e.price + 5 } : e)) });
    const mirror = new ParkietMirror(BASE, "h", parkiet.http);
    mirror.push(submit("BPT", 1, "SELL", 5000, 3, rested(1, "SELL", 5000, 3)));
    mirror.push(submit("BPT", 2, "BUY", 5000, 3, [{ kind: "TRADE", makerOrderId: 1, takerOrderId: 2, takerSide: "BUY", price: 5000, quantity: 3 }]));
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ matched: 1, mismatched: 1 });
    expect(mirror.stats().lastError).toMatch(/^BPT: zlecenie 2 dało w Parkiecie .*"price":"50.05".* zamiast .*"price":"50.00"/);
  });

  it("counts a cancel that Parkiet no longer had as a difference", async () => {
    const parkiet = fakeParkiet();
    const mirror = new ParkietMirror(BASE, "h", parkiet.http);
    mirror.push(submit("KSZ", 1, "BUY", 9000, 2, rested(1, "BUY", 9000, 2)));
    await mirror.idle();
    parkiet.books.get("KSZ")?.cancel(1);
    mirror.push({ kind: "cancel", ticker: "KSZ", orderId: 1 });
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ matched: 1, mismatched: 1, lastError: "KSZ: Parkiet nie miał już zlecenia 1 do anulowania" });
  });

  it("refuses to mirror into a Parkiet without the town's companies or with orders left from another session", async () => {
    const strange = new ParkietMirror(BASE, "h", fakeParkiet({ symbols: ["RUD", "CDR"] }).http);
    await strange.idle();
    expect(strange.stats()).toMatchObject({ state: "error", lastError: "Parkiet nie zna spółek STW, MTK, BPT, KSZ, GRS" });

    const used = fakeParkiet();
    used.books.get("GRS")?.submit(orderRequest(1, "BUY", "LIMIT", 100, 1));
    const mirror = new ParkietMirror(BASE, "h", used.http);
    mirror.push(submit("RUD", 1, "BUY", 3000, 1, rested(1, "BUY", 3000, 1)));
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ state: "error", sent: 0, pending: 0, lastError: "arkusze Parkietu nie są puste — zrestartuj kontener" });
    expect(used.requests.filter((r) => r.startsWith("POST"))).toEqual([]);
  });

  it("keeps going after an HTTP error and reports it", async () => {
    let calls = 0;
    const parkiet = fakeParkiet();
    const mirror = new ParkietMirror(BASE, "h", (url, init) => (init?.method === "POST" && ++calls === 1 ? Promise.resolve(new Response("{}", { status: 503 })) : parkiet.http(url, init)));
    mirror.push(submit("MTK", 1, "BUY", 7000, 1, []));
    mirror.push(submit("MTK", 2, "BUY", 7000, 1, rested(2, "BUY", 7000, 1)));
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ sent: 2, matched: 1, failed: 1, lastError: "HTTP 503 z /api/instruments/MTK/orders" });
  });

  it("asks the simulation to wait while more than MAX_BACKLOG commands are queued", async () => {
    let release: (value?: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const parkiet = fakeParkiet();
    const mirror = new ParkietMirror(BASE, "h", (url, init) => (init?.method === "POST" ? gate.then(() => parkiet.http(url, init)) : parkiet.http(url, init)));
    for (let id = 1; id <= MAX_BACKLOG; id++) mirror.push(submit("RUD", id, "BUY", 3000, 1, rested(id, "BUY", 3000, 1)));
    expect(mirror.busy()).toBe(false);
    mirror.push(submit("RUD", MAX_BACKLOG + 1, "BUY", 3000, 1, rested(MAX_BACKLOG + 1, "BUY", 3000, 1)));
    expect(mirror.busy()).toBe(true);
    release();
    await mirror.idle();
    expect(mirror.busy()).toBe(false);
    expect(mirror.stats()).toMatchObject({ sent: MAX_BACKLOG + 1, matched: MAX_BACKLOG + 1, pending: 0 });
  });

  it("says so when the address serves a web page instead of Parkiet's API", async () => {
    const page = new ParkietMirror(BASE, "h", () => Promise.resolve(new Response("<!doctype html>", { headers: { "content-type": "text/html" } })));
    await page.idle();
    expect(page.stats()).toMatchObject({ state: "error", lastError: "pod http://parkiet nie ma Parkietu" });
  });

  it("fails cleanly when Parkiet is down, and reports a broken cancel as an error", async () => {
    const down = new ParkietMirror(BASE, "h", () => Promise.reject(new Error("Failed to fetch")));
    await down.idle();
    expect(down.stats()).toMatchObject({ state: "error", lastError: "Failed to fetch" });

    const parkiet = fakeParkiet();
    const mirror = new ParkietMirror(BASE, "h", (url, init) => (init?.method === "DELETE" ? Promise.resolve(new Response("", { status: 500 })) : parkiet.http(url, init)));
    mirror.push(submit("GRS", 1, "SELL", 7300, 1, rested(1, "SELL", 7300, 1)));
    mirror.push({ kind: "cancel", ticker: "GRS", orderId: 1 });
    await mirror.idle();
    expect(mirror.stats()).toMatchObject({ matched: 1, failed: 1, lastError: "HTTP 500 przy anulowaniu w GRS" });
  });
});
