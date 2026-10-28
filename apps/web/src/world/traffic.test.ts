import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_TRUCKS, TRUCK_LOAD, convoy, departures, nextShipPhase, portActivity, shipOffset, type ShipPhase } from "./traffic.js";

describe("convoy", () => {
  it("jeden maly ladunek to jedna ciezarowka, ktora rusza rano i jedzie 0,4 dnia", () => {
    expect(convoy("ruda", 100, 0.04)).toEqual([]);
    expect(convoy("ruda", 100, 0.05)).toEqual([0]);
    expect(convoy("ruda", 100, 0.25)[0]).toBeCloseTo(0.5);
    expect(convoy("ruda", 100, 0.45)[0]).toBeCloseTo(1);
    expect(convoy("ruda", 100, 0.46)).toEqual([]);
  });

  it("liczba ciezarowek wynika z ladownosci, ale najwyzej MAX_TRUCKS", () => {
    expect(departures("ruda", TRUCK_LOAD.ruda * 2)).toHaveLength(2);
    expect(departures("stal", TRUCK_LOAD.stal * 2 + 1)).toHaveLength(3);
    expect(departures("maszyny", 10_000)).toHaveLength(MAX_TRUCKS);
    expect(departures("ruda", TRUCK_LOAD.ruda * 2)).toEqual([0.05, 0.55]);
  });

  it("wyjazdy sa rozlozone rowno: pierwsza o 0,05, ostatnia o 0,55 dnia", () => {
    expect(convoy("maszyny", 200, 0.05)).toEqual([0]);
    const atLast = convoy("maszyny", 200, 0.55);
    expect(atLast).toHaveLength(MAX_TRUCKS - 1); // pierwsza juz dojechala (0,05 + 0,4 < 0,55)
    expect(atLast.at(-1)).toBeCloseTo(0);
    const mid = convoy("maszyny", 200, 0.3).map((p) => p * 0.4);
    expect(mid[0]).toBeCloseTo(0.3 - 0.05);
    expect(mid[1]).toBeCloseTo(0.3 - (0.05 + 0.5 / 3));
  });

  it("brak ladunku to brak ciezarowek", () => {
    expect(convoy("stal", 0, 0.3)).toEqual([]);
    expect(departures("stal", -50)).toEqual([]);
  });

  it("wlasnosc: postep zawsze w 0..1, a w ciagu dnia jedzie najwyzej MAX_TRUCKS", () => {
    fc.assert(
      fc.property(fc.constantFrom("ruda" as const, "stal" as const, "maszyny" as const), fc.integer({ min: 0, max: 5000 }), fc.double({ min: 0, max: 1, noNaN: true }), (good, q, f) => {
        const trucks = convoy(good, q, f);
        expect(trucks.length).toBeLessThanOrEqual(MAX_TRUCKS);
        for (const p of trucks) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});

describe("shipOffset", () => {
  const at = (phase: ShipPhase, f: number) => shipOffset(phase, f);

  it("przy nabrzezu i na redzie statek stoi", () => {
    expect(at("przy_nabrzezu", 0.7)).toBe(0);
    expect(at("na_redzie", 0.2)).toBe(1);
  });

  it("odplywa po poludniu: do 0,3 dnia stoi, od 0,8 jest na redzie, w polowie drogi o 0,55", () => {
    expect(at("wyplywa", 0.3)).toBe(0);
    expect(at("wyplywa", 0.55)).toBeCloseTo(0.5);
    expect(at("wyplywa", 0.8)).toBe(1);
    expect(at("wyplywa", 0.95)).toBe(1);
  });

  it("wraca rano: o polnocy na redzie, od 0,5 dnia przy nabrzezu", () => {
    expect(at("wraca", 0)).toBe(1);
    expect(at("wraca", 0.25)).toBeCloseTo(0.5);
    expect(at("wraca", 0.5)).toBe(0);
  });

  it("przed sztormem odplywa wczesnie, a zawijajac wplywa rano i odplywa wieczorem", () => {
    expect(at("chroni_sie", 0.1)).toBe(0);
    expect(at("chroni_sie", 0.6)).toBe(1);
    expect(at("zawija", 0)).toBe(1);
    expect(at("zawija", 0.25)).toBe(0);
    expect(at("zawija", 0.55)).toBe(0);
    expect(at("zawija", 0.95)).toBe(1);
  });

  it("ruch jest plynny: rusza i hamuje lagodnie", () => {
    expect(at("wyplywa", 0.32)).toBeLessThan(0.01);
    expect(at("wyplywa", 0.78)).toBeGreaterThan(0.99);
  });
});

describe("nextShipPhase", () => {
  it("dzien zaladunku: statek odplywa, a nastepnego ranka wplywa nowy", () => {
    expect(nextShipPhase("przy_nabrzezu", false, true)).toBe("wyplywa");
    expect(nextShipPhase("wyplywa", false, false)).toBe("wraca");
    expect(nextShipPhase("wraca", false, false)).toBe("przy_nabrzezu");
  });

  it("sztorm wygania pusty statek na rede (bez zaladunku) i trzyma go tam, a po sztormie statek wraca", () => {
    expect(nextShipPhase("przy_nabrzezu", true, false)).toBe("chroni_sie");
    expect(nextShipPhase("wraca", true, false)).toBe("chroni_sie");
    expect(nextShipPhase("chroni_sie", true, false)).toBe("na_redzie");
    expect(nextShipPhase("wyplywa", true, false)).toBe("na_redzie");
    expect(nextShipPhase("na_redzie", true, false)).toBe("na_redzie");
    expect(nextShipPhase("na_redzie", false, false)).toBe("wraca");
  });

  it("pierwszy spokojny dzien z towarem w porcie: statek zawija z redy, laduje i odplywa", () => {
    expect(nextShipPhase("na_redzie", false, true)).toBe("zawija");
    expect(nextShipPhase("chroni_sie", false, true)).toBe("zawija");
    expect(nextShipPhase("zawija", false, false)).toBe("wraca");
    expect(nextShipPhase("zawija", true, false)).toBe("na_redzie");
  });

  it("wlasnosc: statek nigdy nie przeskakuje miedzy dniami", () => {
    const phases: ShipPhase[] = ["przy_nabrzezu", "wyplywa", "wraca", "na_redzie", "chroni_sie", "zawija"];
    fc.assert(
      fc.property(fc.constantFrom(...phases), fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 30 }), (start, days) => {
        let phase = start;
        for (const [storm, loaded] of days) {
          const next = nextShipPhase(phase, storm, loaded);
          expect(shipOffset(next, 0)).toBe(shipOffset(phase, 1));
          phase = next;
        }
      }),
    );
  });
});

describe("portActivity", () => {
  it("dzwigi laduja tylko wtedy, gdy statek stoi przy nabrzezu w dniu zaladunku", () => {
    expect(portActivity("przy_nabrzezu", 0.5)).toEqual({ docked: true, left: 1 });
    expect(portActivity("wyplywa", 0)).toEqual({ docked: true, left: 1 });
    expect(portActivity("wyplywa", 0.3)).toEqual({ docked: false, left: 0 });
    expect(portActivity("zawija", 0.1)).toEqual({ docked: false, left: 1 });
    expect(portActivity("zawija", 0.4)).toMatchObject({ docked: true });
    expect(portActivity("zawija", 0.4).left).toBeCloseTo(0.5);
    expect(portActivity("zawija", 0.6)).toEqual({ docked: false, left: 0 });
  });

  it("statek uciekajacy przed sztormem nic nie zabiera, a w drodze i na redzie stosy stoja", () => {
    for (const phase of ["chroni_sie", "wraca", "na_redzie"] as const) for (const f of [0, 0.4, 0.9]) expect(portActivity(phase, f)).toEqual({ docked: false, left: 1 });
  });
});
