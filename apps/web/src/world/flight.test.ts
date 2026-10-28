import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ELEVATION, FLIGHT_MS, INTRO_MS, ease, flightAt, focusPose, introPose, tickerOf, type Pose } from "./flight.js";

describe("tickerOf", () => {
  it("rozpoznaje spolke po przedrostku nazwy z Blendera", () => {
    expect(tickerOf("STW")).toBe("STW");
    expect(tickerOf("STW_suwnica")).toBe("STW");
    expect(tickerOf("BPT_dzwig_2")).toBe("BPT");
    expect(tickerOf("RUD_wieza")).toBe("RUD");
  });

  it("reszta miasta i podobne nazwy nie sa spolka", () => {
    expect(tickerOf("GIELDA")).toBeNull();
    expect(tickerOf("domy_centrum")).toBeNull();
    expect(tickerOf("RUDA")).toBeNull();
    expect(tickerOf("xSTW")).toBeNull();
    expect(tickerOf("")).toBeNull();
  });
});

describe("ease", () => {
  it("zaczyna w 0, konczy w 1, w polowie jest w polowie", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(0.25)).toBeCloseTo(0.0625);
    expect(ease(0.75)).toBeCloseTo(0.9375);
  });

  it("poza przedzialem stoi na koncach i nigdy nie cofa sie", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(ease(lo)).toBeLessThanOrEqual(ease(hi) + 1e-12);
      }),
    );
  });
});

describe("focusPose", () => {
  const from: Pose = { position: [100, 200, 0], target: [0, 0, 0] };

  it("patrzy na budynek z zadanej odleglosci, z tego samego kierunku co wczesniej", () => {
    const p = focusPose(from, [10, 0, 20], 80);
    expect(p.target).toEqual([10, 0, 20]);
    const [x, y, z] = p.position;
    expect(Math.hypot(x - 10, y, z - 20)).toBeCloseTo(80);
    // kamera byla na wschod od celu (+x) — i dalej jest na wschod
    expect(x - 10).toBeGreaterThan(0);
    expect(z - 20).toBeCloseTo(0);
    expect(y).toBeCloseTo(80 * Math.sin(ELEVATION));
  });

  it("kierunek bierze z obu osi poziomych, takze gdy cel nie lezy w zerze", () => {
    // kamera 10 na wschod i 20 na poludnie od celu: ten sam kierunek (1:2) po przelocie
    const p = focusPose({ position: [10, 50, 30], target: [0, 0, 10] }, [5, 2, -5], 60);
    const [dx, dz] = [p.position[0] - 5, p.position[2] + 5];
    expect(dz / dx).toBeCloseTo(2);
    expect(Math.hypot(dx, dz)).toBeCloseTo(60 * Math.cos(ELEVATION));
  });

  it("z kamery prosto z gory patrzy od poludnia", () => {
    const p = focusPose({ position: [5, 300, 5], target: [5, 0, 5] }, [0, 0, 0], 50);
    expect(p.position[0]).toBeCloseTo(0);
    expect(p.position[2]).toBeCloseTo(50 * Math.cos(ELEVATION));
  });
});

describe("flightAt", () => {
  const a: Pose = { position: [0, 100, 0], target: [0, 0, 0] };
  const b: Pose = { position: [100, 50, 100], target: [40, 0, 20] };

  it("na starcie jest w a, po czasie przelotu w b, w polowie w polowie drogi", () => {
    expect(flightAt(a, b, 0)).toEqual(a);
    expect(flightAt(a, b, FLIGHT_MS)).toEqual(b);
    expect(flightAt(a, b, FLIGHT_MS * 5)).toEqual(b);
    const mid = flightAt(a, b, FLIGHT_MS / 2);
    expect(mid.position[0]).toBeCloseTo(50);
    expect(mid.position[1]).toBeCloseTo(75);
    expect(mid.target[2]).toBeCloseTo(10);
  });

  it("kazda os idzie od a do b, takze gdy a nie lezy w zerze", () => {
    const from: Pose = { position: [-30, 80, 60], target: [10, 4, -20] };
    const mid = flightAt(from, b, FLIGHT_MS / 2);
    expect(mid.position[0]).toBeCloseTo(35);
    expect(mid.position[2]).toBeCloseTo(80);
    expect(mid.target[0]).toBeCloseTo(25);
    expect(mid.target[1]).toBeCloseTo(2);
    expect(mid.target[2]).toBeCloseTo(0);
  });

  it("czas przelotu mozna podac", () => {
    expect(flightAt(a, b, 100, 100)).toEqual(b);
    expect(flightAt(a, b, 25, 100).position[0]).toBeCloseTo(100 * ease(0.25));
  });
});

describe("introPose", () => {
  const end = { position: [10, 100, 50] as const, target: [10, 0, 0] as const };

  it("bez obrotu to samo ujecie, tylko dalej i wyzej", () => {
    const p = introPose(end, 2, 0);
    expect(p.target).toEqual(end.target);
    expect(p.position[0]).toBeCloseTo(10);
    expect(p.position[1]).toBeCloseTo(200);
    expect(p.position[2]).toBeCloseTo(100);
  });

  it("obrot trzyma odleglosc w poziomie i obraca wokol celu", () => {
    const p = introPose(end, 1, Math.PI / 2);
    expect(p.position[0]).toBeCloseTo(10 - 50);
    expect(p.position[1]).toBeCloseTo(100);
    expect(p.position[2]).toBeCloseTo(0);
  });

  it("obraca o zadany kat wokol celu lezacego poza zerem, w kazdej osi", () => {
    const from = { position: [20, 40, 5] as const, target: [7, 3, -11] as const };
    const p = introPose(from, 1.5, 0.3);
    const [x, y, z] = p.position;
    // w poziomie: promien 1,5 raza wiekszy, kat (atan2 z, x) wiekszy o 0,3
    expect(Math.hypot(x - 7, z + 11)).toBeCloseTo(1.5 * Math.hypot(13, 16));
    expect(Math.atan2(z + 11, x - 7)).toBeCloseTo(Math.atan2(16, 13) + 0.3);
    expect(y).toBeCloseTo(3 + 37 * 1.5);
  });

  it("domyslnie startuje 1,6 raza dalej i z boku", () => {
    const p = introPose(end);
    const [dx, dy, dz] = [p.position[0] - 10, p.position[1], p.position[2]];
    expect(Math.hypot(dx, dz)).toBeCloseTo(80);
    expect(dy).toBeCloseTo(160);
    expect(dx).toBeGreaterThan(0);
    expect(INTRO_MS).toBeGreaterThan(FLIGHT_MS);
  });
});
