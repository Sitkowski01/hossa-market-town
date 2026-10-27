import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_WALKERS, PLAZA_LOOPS, crowdSize, walked, walkers } from "./crowd.js";

describe("crowdSize", () => {
  it("w nocy kilku spacerowiczow, w dzien przy pelnym popycie caly tlum", () => {
    expect(crowdSize(0, 1, false)).toBe(3);
    expect(crowdSize(1, 1, false)).toBe(MAX_WALKERS);
  });

  it("w dzien liczba rosnie z popytem w Koszyku", () => {
    expect(crowdSize(1, 0, false)).toBe(Math.round(3 + 21 * 0.5));
    expect(crowdSize(1, 0.5, false)).toBe(Math.round(3 + 21 * 0.75));
    expect(crowdSize(0.5, 1, false)).toBe(Math.round(3 + 21 * 0.5));
  });

  it("w sztorm wychodzi co czwarty", () => {
    expect(crowdSize(1, 1, true)).toBe(6);
    expect(crowdSize(0, 1, true)).toBe(1);
  });

  it("wartosci spoza 0..1 sa przycinane", () => {
    expect(crowdSize(2, 3, false)).toBe(MAX_WALKERS);
    expect(crowdSize(-1, -1, false)).toBe(3);
    expect(crowdSize(1, -1, false)).toBe(crowdSize(1, 0, false));
  });

  it("wlasnosc: zawsze 0..MAX_WALKERS i nie maleje z pora dnia", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), (a, b, demand, storm) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(crowdSize(lo, demand, storm)).toBeLessThanOrEqual(crowdSize(hi, demand, storm));
        expect(crowdSize(hi, demand, storm)).toBeGreaterThanOrEqual(0);
        expect(crowdSize(hi, demand, storm)).toBeLessThanOrEqual(MAX_WALKERS);
      }),
    );
  });
});

describe("PLAZA_LOOPS", () => {
  it("kazda petla jest zamknieta i miesci sie na placu 40 x 36 m", () => {
    expect(PLAZA_LOOPS).toHaveLength(3);
    for (const loop of PLAZA_LOOPS) {
      expect(loop.length).toBeGreaterThanOrEqual(20);
      expect(loop.at(-1)).toEqual(loop[0]);
      for (const [x, z] of loop) {
        expect(Math.abs(x)).toBeLessThanOrEqual(20);
        expect(Math.abs(z)).toBeLessThanOrEqual(18);
      }
    }
  });

  it("spacer wokol fontanny trzyma sie 8 m od srodka", () => {
    for (const [x, z] of PLAZA_LOOPS[0] ?? []) expect(Math.hypot(x, z)).toBeCloseTo(8);
  });

  /** Pole objete petla (wzor shoelace) i jej zasieg — psuja sie od kazdego przestawionego rogu. */
  const shape = (loop: readonly (readonly [number, number])[]) => {
    let area = 0;
    for (let i = 0; i < loop.length - 1; i++) {
      const [x0, z0] = loop[i] as readonly [number, number];
      const [x1, z1] = loop[i + 1] as readonly [number, number];
      area += x0 * z1 - x1 * z0;
    }
    const xs = loop.map((p) => p[0]);
    const zs = loop.map((p) => p[1]);
    return { area: Math.abs(area / 2), x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
  };

  it("alejka to prostokat 22 x 30 m z zaokraglonymi rogami", () => {
    const { area, x, z } = shape(PLAZA_LOOPS[1] ?? []);
    expect(area).toBeGreaterThan(640);
    expect(area).toBeLessThan(660);
    expect(x).toEqual([-11, 11]);
    expect(z).toEqual([-15, 15]);
  });

  it("obchod siega drzwi Koszyka i banku (17 m w bok) i schodow gieldy (15 m na polnoc)", () => {
    const { area, x, z } = shape(PLAZA_LOOPS[2] ?? []);
    expect(area).toBeCloseTo(729.58, 1);
    expect(x[0]).toBeCloseTo(-17.14, 1);
    expect(x[1]).toBeCloseTo(17.14, 1);
    expect(z[0]).toBeCloseTo(-15.39, 1);
    expect(z[1]).toBeCloseTo(14, 1);
  });
});

describe("walkers", () => {
  it("rozdziela przechodniow po petlach i wzorcach na zmiane", () => {
    const list = walkers(7, 3, 2);
    expect(list.map((w) => w.loop)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(list.map((w) => w.look)).toEqual([0, 1, 0, 1, 0, 1, 0]);
  });

  it("zestaw jest staly — zrzuty z tym samym adresem pokazuja tych samych ludzi w tych samych miejscach", () => {
    const [a, b, c] = walkers(3, 3, 2);
    expect(a?.start).toBeCloseTo(0.740085, 5);
    expect(a?.speed).toBeCloseTo(-1.036952, 5);
    expect(b?.start).toBeCloseTo(0.564395, 5);
    expect(b?.speed).toBeCloseTo(-1.182116, 5);
    expect(c?.start).toBeCloseTo(0.454749, 5);
    expect(c?.speed).toBeCloseTo(1.167601, 5);
  });

  it("jest powtarzalny i rozny dla kazdego przechodnia", () => {
    expect(walkers(5, 3, 3)).toEqual(walkers(5, 3, 3));
    const starts = new Set(walkers(MAX_WALKERS, 3, 3).map((w) => w.start));
    expect(starts.size).toBe(MAX_WALKERS);
  });

  it("idzie w obie strony, z predkoscia 1..1,5 m/s, i startuje w 0..1", () => {
    const list = walkers(MAX_WALKERS, 3, 3);
    expect(list.some((w) => w.speed > 0)).toBe(true);
    expect(list.some((w) => w.speed < 0)).toBe(true);
    for (const w of list) {
      expect(Math.abs(w.speed)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(w.speed)).toBeLessThanOrEqual(1.5);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.start).toBeLessThan(1);
    }
  });
});

describe("walked", () => {
  const w = { loop: 0, start: 0.25, speed: 1.2, look: 0 };

  it("startuje w swoim miejscu i idzie ze swoja predkoscia", () => {
    expect(walked(w, 100, 0)).toBeCloseTo(25);
    expect(walked(w, 100, 10)).toBeCloseTo(37);
  });

  it("zawija sie na koncu petli, takze idac wstecz", () => {
    expect(walked(w, 100, 70)).toBeCloseTo(9);
    expect(walked({ ...w, speed: -1 }, 100, 30)).toBeCloseTo(95);
  });

  it("wlasnosc: zawsze na petli", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e5, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true }), (t, speed) => {
        const s = walked({ ...w, speed }, 50, t);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(50);
      }),
    );
  });
});
