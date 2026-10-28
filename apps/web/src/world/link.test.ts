import { describe, expect, it } from "vitest";
import type { Link } from "../sim/protocol.js";
import { linkLabel } from "./link.js";

const link = (over: Partial<Link> = {}): Link => ({ state: "ready", sent: 12_502, matched: 12_500, mismatched: 0, pending: 2, failed: 0, streaming: true, ...over });

describe("linkLabel", () => {
  it("everything agrees: the number of commands Parkiet answered the same way", () => {
    expect(linkLabel(link())).toEqual({ text: "Parkiet ✓ 12 500 zgodnych", tone: "ok", title: expect.stringContaining("giełda w Javie") as string });
    expect(linkLabel(link()).title).not.toContain("Błędy");
  });

  it("says when the simulation waits for the exchange to catch up", () => {
    const label = linkLabel(link({ pending: 900 }));
    expect(label).toMatchObject({ text: "Parkiet ✓ 12 500 zgodnych · czeka na giełdę", tone: "czeka" });
    expect(label.title).toContain("obsłuży 900 zleceń");
    expect(linkLabel(link({ pending: 600 })).tone).toBe("ok");
  });

  it("shows connecting, a failed connection and differences with the reason in the tooltip", () => {
    expect(linkLabel(link({ state: "connecting" }))).toMatchObject({ text: "Parkiet · łączenie…", tone: "czeka" });
    expect(linkLabel(link({ state: "error", lastError: "Failed to fetch" }))).toEqual({ text: "Parkiet · brak połączenia", tone: "blad", title: "Failed to fetch" });
    expect(linkLabel(link({ state: "error" })).title).toBe("");
    expect(linkLabel(link({ mismatched: 1203, lastError: "RUD: zlecenie 7 dalo..." }))).toEqual({ text: "Parkiet · różnice: 1 203", tone: "blad", title: "RUD: zlecenie 7 dalo..." });
  });

  it("warns when the quote stream is closed, and mentions connection errors without hiding the agreement", () => {
    expect(linkLabel(link({ streaming: false }))).toMatchObject({ text: "Parkiet · strumień zamknięty", tone: "blad", title: expect.stringContaining("kursy na scenie są z przeglądarki") as string });
    const label = linkLabel(link({ failed: 3, lastError: "HTTP 503 z /api/instruments/RUD/orders" }));
    expect(label).toMatchObject({ text: "Parkiet ✓ 12 500 zgodnych", tone: "ok" });
    expect(label.title).toMatch(/Błędy połączenia: 3, ostatni: HTTP 503/);
  });
});
