import { roundCorners, type Vec2 } from "./path.js";

/** Tylu przechodniow miesci rynek w poludnie przy pelnym popycie; wiecej robi z placu tlum. */
export const MAX_WALKERS = 24;
/** Nocni spacerowicze — rynek nigdy nie jest calkiem pusty. */
const NIGHT_WALKERS = 3;
/** W sztorm wychodzi co czwarty — reszta czeka w domu. */
const STORM_SHARE = 0.25;

/**
 * Ilu przechodniow jest teraz na rynku: w dzien wiecej, w nocy kilku, a w dzien liczba rosnie
 * z popytem w Sieci Koszyk (produkcja KSZ 0..1) — ludzie na placu to klienci sklepu.
 */
export function crowdSize(day: number, demand: number, storm: boolean): number {
  const d = Math.min(1, Math.max(0, day));
  const shoppers = 0.5 + 0.5 * Math.min(1, Math.max(0, demand));
  const size = Math.round(NIGHT_WALKERS + (MAX_WALKERS - NIGHT_WALKERS) * d * shoppers);
  return storm ? Math.round(size * STORM_SHARE) : size;
}

const ring = (radius: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i): Vec2 => [radius * Math.cos((2 * Math.PI * i) / n), radius * Math.sin((2 * Math.PI * i) / n)]);

const close = (points: readonly Vec2[]): Vec2[] => [...points, points[0] as Vec2];

/**
 * Petle spacerow po rynku w metrach od srodka placu (x na wschod, z na poludnie): wokol fontanny,
 * alejka wzdluz drzew i obchod od drzwi Koszyka (wschod) przez schody gieldy (polnoc) do banku (zachod).
 * Kazda petla jest zamknieta: ostatni punkt to pierwszy. Rogi sa zaokraglone, wiec petla zaczyna sie
 * w polowie boku — tam roundCorners nic nie zmienia i spacer nie ma ostrego zakretu.
 */
export const PLAZA_LOOPS: readonly (readonly Vec2[])[] = [
  close(ring(8, 20)),
  roundCorners([[11, 0], [11, 15], [-11, 15], [-11, -15], [11, -15], [11, 0]], 4),
  roundCorners([[13.5, -5], [9, -12], [0, -16], [-9, -12], [-18, 2], [-9, 14], [9, 14], [18, 2], [13.5, -5]], 3),
];

export interface Walker {
  readonly loop: number;
  /** Gdzie na petli zaczyna (ulamek dlugosci). */
  readonly start: number;
  /** Predkosc w m/s, ujemna = idzie petla w druga strone. */
  readonly speed: number;
  /** Ktory z wzorcow pieszego. */
  readonly look: number;
}

/** Ulamek 0..1 z liczby — rozrzuca przechodniow bez losowosci, wiec zrzuty sa powtarzalne. */
const spread = (i: number, k: number): number => {
  const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Staly zestaw przechodniow: kazdy ma swoja petle, miejsce startu, tempo i kierunek. */
export function walkers(count: number, loops: number, looks: number): Walker[] {
  return Array.from({ length: count }, (_, i) => ({
    loop: i % loops,
    start: spread(i, 1),
    speed: (1 + 0.5 * spread(i, 2)) * (spread(i, 3) < 0.5 ? -1 : 1),
    look: i % looks,
  }));
}

/** Droga od poczatku petli (0..length) po `seconds` marszu. */
export function walked(walker: Walker, length: number, seconds: number): number {
  const s = walker.start * length + walker.speed * seconds;
  return ((s % length) + length) % length;
}
