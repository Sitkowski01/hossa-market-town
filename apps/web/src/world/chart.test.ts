import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Bar } from "../sim/protocol.js";
import { TAG_CLEARANCE, gridStep, labelledGrid, layoutChart } from "./chart.js";

const bar = (day: number, open: number, high: number, low: number, close: number): Bar => ({ day, open, high, low, close, volume: 1 });
const box = { width: 600, height: 200 };

describe("gridStep", () => {
  it("wybiera najmniejszy okragly krok, przy ktorym mieszcza sie 4 linie", () => {
    expect(gridStep(20)).toBe(5);
    expect(gridStep(21)).toBe(10);
    expect(gridStep(100)).toBe(25);
    expect(gridStep(101)).toBe(50);
    expect(gridStep(3000, 3)).toBe(1000);
    expect(gridStep(1e9)).toBe(100_000);
  });
});

describe("layoutChart", () => {
  it("najnowsza swieca stoi przy prawej krawedzi, a starsze w rownych odstepach w lewo", () => {
    const bars = [bar(1, 100, 110, 90, 105), bar(1, 105, 108, 100, 101)];
    const l = layoutChart(bars, null, box, 60);
    expect(l.candles.map((c) => c.x)).toEqual([585, 595]);
    expect(l.candleWidth).toBe(7);
  });

  it("os y rosnie w dol: maksimum z marginesem 8% na gorze, minimum na dole", () => {
    const l = layoutChart([bar(1, 100, 200, 100, 150)], null, box, 10);
    // zakres 100..200 z marginesem 8 -> 92..208
    expect(l.y(208)).toBeCloseTo(0);
    expect(l.y(92)).toBeCloseTo(200);
    expect(l.y(150)).toBeCloseTo(100);
    const [c] = l.candles;
    expect(c?.wickTop).toBeCloseTo(l.y(200));
    expect(c?.wickBottom).toBeCloseTo(l.y(100));
    expect(c?.bodyTop).toBeCloseTo(l.y(150));
    expect(c?.bodyHeight).toBeCloseTo(l.y(100) - l.y(150));
    expect(c?.up).toBe(true);
  });

  it("spadkowa swieca ma korpus od otwarcia, a plaska ma korpus 1 px i liczy sie jako wzrost", () => {
    const l = layoutChart([bar(1, 150, 160, 100, 120), bar(1, 130, 130, 130, 130)], null, box, 10);
    const [down, flat] = l.candles;
    expect(down?.up).toBe(false);
    expect(down?.bodyTop).toBeCloseTo(l.y(150));
    expect(down?.bodyHeight).toBeCloseTo(l.y(120) - l.y(150));
    expect(flat?.bodyHeight).toBe(1);
    expect(flat?.up).toBe(true);
  });

  it("wartosc godziwa poza swiecami rozszerza skale", () => {
    const l = layoutChart([bar(1, 100, 110, 90, 100)], 300, box, 10);
    expect(l.y(300)).toBeGreaterThan(0);
    expect(l.y(300)).toBeLessThan(box.height * 0.1);
  });

  it("rowne ceny rozszerza o 1%, a pusty wykres nie dzieli przez zero", () => {
    const l = layoutChart([bar(1, 1000, 1000, 1000, 1000)], null, box, 10);
    expect(l.y(1000)).toBeCloseTo(100);
    expect(l.y(1005)).toBeGreaterThan(0);
    const empty = layoutChart([], null, box, 10);
    expect(empty.candles).toEqual([]);
    expect(Number.isFinite(empty.y(0))).toBe(true);
  });

  it("siatka ma okragle ceny w zakresie wykresu", () => {
    const l = layoutChart([bar(1, 3000, 3100, 2900, 3050)], null, box, 10);
    expect(l.grid.map((g) => g.price)).toEqual([2900, 3000, 3100]);
    for (const g of l.grid) expect(g.y).toBeCloseTo(l.y(g.price));
  });

  it("granica dnia lezy miedzy ostatnia swieca dnia a pierwsza nastepnego", () => {
    const bars = [bar(1, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100), bar(3, 100, 100, 100, 100)];
    const l = layoutChart(bars, null, box, 6);
    expect(l.dayLines).toEqual([
      { day: 2, x: 400 },
      { day: 3, x: 500 },
    ]);
  });

  it("kazda swieca miesci sie w pudelku, a knot obejmuje korpus", () => {
    const arb = fc.array(
      fc.tuple(fc.integer({ min: 5, max: 100_000 }), fc.integer({ min: 5, max: 100_000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 })),
      { minLength: 1, maxLength: 60 },
    );
    fc.assert(
      fc.property(arb, fc.option(fc.integer({ min: 5, max: 200_000 })), (raw, fair) => {
        const bars = raw.map(([o, c, up, down]) => bar(1, o, Math.max(o, c) + up, Math.max(1, Math.min(o, c) - down), c));
        const l = layoutChart(bars, fair, box, 60);
        for (const c of l.candles) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(box.width);
          expect(c.wickTop).toBeGreaterThanOrEqual(0);
          expect(c.wickBottom).toBeLessThanOrEqual(box.height);
          expect(c.wickTop).toBeLessThanOrEqual(c.bodyTop + 1e-9);
          expect(c.bodyTop + c.bodyHeight).toBeLessThanOrEqual(Math.max(c.wickBottom, c.bodyTop + 1) + 1e-9);
        }
      }),
    );
  });
});

describe("labelledGrid", () => {
  const grid = [{ y: 3 }, { y: 40 }, { y: 80 }, { y: 120 }, { y: 196 }];

  it("pomija podpisy przy samej krawedzi wykresu", () => {
    expect(labelledGrid(grid, 200, [])).toEqual([{ y: 40 }, { y: 80 }, { y: 120 }]);
    expect(labelledGrid([{ y: 7 }, { y: 193 }], 200, [])).toEqual([{ y: 7 }, { y: 193 }]);
  });

  it("pomija podpisy pod plakietkami ceny i wartosci godziwej", () => {
    expect(labelledGrid(grid, 200, [44, 125])).toEqual([{ y: 80 }]);
  });

  it("podpis dokladnie TAG_CLEARANCE od plakietki zostaje", () => {
    expect(labelledGrid([{ y: 50 }], 200, [50 + TAG_CLEARANCE])).toEqual([{ y: 50 }]);
    expect(labelledGrid([{ y: 50 }], 200, [50 - TAG_CLEARANCE + 0.5])).toEqual([]);
  });
});
