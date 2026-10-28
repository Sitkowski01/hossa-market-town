import { describe, expect, it } from "vitest";
import { covered, fade, lifts, nudge, spread } from "./overlap.js";

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

  it("stykajace sie bokami nie nachodza, w obu kolejnosciach", () => {
    expect(lifts([r(0, 100), r(100, 100)])).toEqual([0, 0]);
    expect(lifts([r(100, 100), r(0, 100)])).toEqual([0, 0]);
  });

  it("odstep w pionie: tabliczka blizej niz gap nad druga podnosi sie o reszte, dalsza stoi", () => {
    // nizsza zaczyna sie na 100, odstep 4: dol wyzszej moze siegac najwyzej 96
    expect(lifts([r(0, 100), r(50, 98 - 36)])).toEqual([0, 2]);
    expect(lifts([r(0, 100), r(50, 96 - 36)])).toEqual([0, 0]);
  });

  it("tabliczka pod juz podniesiona: dalej niz gap stoi, blizej idzie nad nia", () => {
    // B wchodzi nad A (124..160); nizsza tabliczka pod B, z odstepem rownym gap albo mniejszym
    const a = r(0, 164);
    const b = r(50, 159);
    expect(lifts([a, b, { left: 120, top: 164, right: 220, bottom: 186 }])).toEqual([0, 35, 0]);
    expect(lifts([a, b, { left: 120, top: 160, right: 220, bottom: 186 }])).toEqual([0, 35, 66]);
  });

  it("podniesiona nad jedna, a potem wepchnieta w wczesniejsza, podnosi sie jeszcze raz", () => {
    const a = r(0, 164);
    const b = r(50, 159); // nad A: 124..160
    const c = r(160, 156); // obok, stoi
    const d = { left: 120, top: 166, right: 220, bottom: 186 }; // pod B, ale wchodzi na C
    // nad C (dol na 152) wpada w B — wiec jeszcze nad B (dol na 120): razem 66
    expect(lifts([a, b, c, d])).toEqual([0, 35, 0, 66]);
  });
});

describe("spread", () => {
  const r = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 36 });
  const all = () => true;

  it("zwykle jak lifts: wyzsza idzie w gore", () => {
    expect(spread([r(0, 100), r(60, 118)], all)).toEqual([22, 0]);
    expect(spread([r(0, 100), r(120, 100)], all)).toEqual([0, 0]);
  });

  it("gdy w gorze wpadlaby pod panel, wyzsza zostaje, a nizsza schodzi w dol", () => {
    // kopalnia za huta: nad tabliczka kopalni lezy lista notowan (do y = 90)
    const belowList = (s: { top: number }) => s.top >= 90;
    expect(spread([r(0, 100), r(10, 120)], belowList)).toEqual([0, -20]);
  });

  it("przy remisie zostaje w gore", () => {
    const nothingFits = () => false;
    expect(spread([r(0, 100), r(10, 120)], nothingFits)).toEqual([20, 0]);
  });

  it("podniesienia odpowiadaja kolejnosci tabliczek, a w dol bez ujemnego zera", () => {
    const belowList = (s: { top: number }) => s.top >= 90;
    expect(spread([r(10, 120), r(0, 100), r(300, 100)], belowList)).toEqual([-20, 0, 0]);
    expect(Object.is(spread([r(10, 120), r(0, 100), r(300, 100)], belowList)[2], 0)).toBe(true);
  });
});

describe("nudge", () => {
  it("tabliczka mieszczaca sie na ekranie stoi", () => {
    expect(nudge(200, 50, 400)).toBe(0);
    expect(nudge(54, 50, 400)).toBe(0);
    expect(nudge(346, 50, 400)).toBe(0);
  });

  it("przy krawedzi dosuwa sie do niej z marginesem", () => {
    expect(nudge(20, 50, 400)).toBe(34);
    expect(nudge(390, 50, 400)).toBe(-44);
    expect(nudge(0, 50, 400, 0)).toBe(50);
    expect(nudge(400, 50, 400, 0)).toBe(-50);
  });

  it("budynek poza ekranem nie dostaje tabliczki przy krawedzi", () => {
    expect(nudge(-1, 50, 400)).toBe(0);
    expect(nudge(401, 50, 400)).toBe(0);
  });
});
