import { describe, expect, it } from "vitest";
import { covered, fade, lifts } from "./overlap.js";

const panel = { left: 0, top: 0, right: 100, bottom: 50 };

describe("covered", () => {
  it("tabliczka na panelu albo przy nim jest zaslonieta", () => {
    expect(covered({ left: 50, top: 20, right: 150, bottom: 60 }, [panel])).toBe(true);
    expect(covered({ left: 104, top: 20, right: 200, bottom: 60 }, [panel])).toBe(true);
    expect(covered({ left: 20, top: 54, right: 80, bottom: 90 }, [panel])).toBe(true);
  });

  it("tabliczka dalej niz margines jest widoczna", () => {
    expect(covered({ left: 107, top: 20, right: 200, bottom: 60 }, [panel])).toBe(false);
    expect(covered({ left: 20, top: 57, right: 80, bottom: 90 }, [panel])).toBe(false);
    expect(covered({ left: -200, top: 0, right: -107, bottom: 50 }, [panel])).toBe(false);
    expect(covered({ left: 0, top: -100, right: 100, bottom: -7 }, [panel])).toBe(false);
  });

  it("margines dziala z kazdej strony, a tabliczka dokladnie na jego granicy jest jeszcze widoczna", () => {
    expect(covered({ left: -50, top: 10, right: -3, bottom: 20 }, [panel])).toBe(true);
    expect(covered({ left: 20, top: -50, right: 30, bottom: -3 }, [panel])).toBe(true);
    expect(covered({ left: 106, top: 10, right: 150, bottom: 20 }, [panel])).toBe(false);
    expect(covered({ left: -50, top: 10, right: -6, bottom: 20 }, [panel])).toBe(false);
    expect(covered({ left: 20, top: 56, right: 30, bottom: 80 }, [panel])).toBe(false);
    expect(covered({ left: 20, top: -50, right: 30, bottom: -6 }, [panel])).toBe(false);
  });

  it("wystarczy jeden zaslaniajacy panel; bez paneli nic nie zaslania", () => {
    const far = { left: 500, top: 500, right: 600, bottom: 600 };
    expect(covered({ left: 510, top: 510, right: 520, bottom: 520 }, [panel, far])).toBe(true);
    expect(covered({ left: 10, top: 10, right: 20, bottom: 20 }, [])).toBe(false);
    expect(covered({ left: 104, top: 20, right: 200, bottom: 60 }, [panel], 0)).toBe(false);
  });
});

describe("fade", () => {
  it("idzie do celu ze stala predkoscia i nie przeskakuje", () => {
    expect(fade(1, 0, 0.05)).toBeCloseTo(0.7);
    expect(fade(0, 1, 0.05)).toBeCloseTo(0.3);
    expect(fade(0.1, 0, 0.05)).toBe(0);
    expect(fade(0.9, 1, 0.05)).toBe(1);
    expect(fade(0.5, 1, 0.1, 2)).toBeCloseTo(0.7);
    expect(fade(0.5, 0.5, 0.1)).toBe(0.5);
  });
});

describe("lifts", () => {
  const r = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 36 });

  it("tabliczki obok siebie nie ruszaja sie", () => {
    expect(lifts([r(0, 100), r(120, 100)])).toEqual([0, 0]);
  });

  it("z dwoch nachodzacych nizsza zostaje, a wyzsza wchodzi nad nia z odstepem", () => {
    // GRS (wyzej) i KSZ (nizej, przesunieta w prawo) jak na rynku
    expect(lifts([r(0, 100), r(60, 118)])).toEqual([22, 0]);
  });

  it("trzy w kolumnie ukladaja sie w stos, a kolejnosc wejscia nie ma znaczenia", () => {
    const stack = lifts([r(0, 100), r(10, 110), r(20, 120)]);
    expect(stack).toEqual([60, 30, 0]);
    expect(lifts([r(20, 120), r(0, 100), r(10, 110)])).toEqual([0, 60, 30]);
  });
});
