import type { Bar } from "../sim/protocol.js";

export interface Box {
  readonly width: number;
  readonly height: number;
}

export interface CandleShape {
  /** Srodek swiecy w pikselach. */
  readonly x: number;
  /** Knot: od maksimum do minimum. */
  readonly wickTop: number;
  readonly wickBottom: number;
  /** Korpus: od wyzszej z cen otwarcia i zamkniecia; co najmniej 1 px, zeby plaska swieca byla widoczna. */
  readonly bodyTop: number;
  readonly bodyHeight: number;
  readonly up: boolean;
}

export interface ChartLayout {
  readonly candles: readonly CandleShape[];
  readonly candleWidth: number;
  /** Cena w groszach -> wspolrzedna y w pikselach. */
  readonly y: (price: number) => number;
  /** Linie siatki z cenami: okragle kwoty w zakresie wykresu. */
  readonly grid: readonly { readonly price: number; readonly y: number }[];
  /** Granice dni: x miedzy ostatnia swieca dnia a pierwsza nastepnego. */
  readonly dayLines: readonly { readonly day: number; readonly x: number }[];
}

/** Kroki siatki w groszach: 5 gr, 10 gr, ... 1000 zl. */
const STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000, 100_000];
const GRID_LINES = 4;

/** Najmniejszy krok siatki, przy ktorym na zakres wypada najwyzej `lines` linii. */
export function gridStep(range: number, lines = GRID_LINES): number {
  return STEPS.find((s) => range / s <= lines) ?? (STEPS.at(-1) as number);
}

/**
 * Uklad wykresu swiecowego: miejsce na `slots` swiec (najnowsza przy prawej krawedzi),
 * skala cen z minimum i maksimum swiec oraz wartosci godziwej, z marginesem 8% na gorze i dole.
 * Gdy wszystkie ceny sa rowne, zakres rozszerza sie o 1%, zeby nie dzielic przez zero.
 */
export function layoutChart(bars: readonly Bar[], fair: number | null, box: Box, slots: number): ChartLayout {
  const prices = bars.flatMap((b) => [b.high, b.low]);
  if (fair !== null) prices.push(fair);
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (prices.length === 0) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < hi * 0.01) {
    const mid = (hi + lo) / 2;
    lo = mid * 0.995;
    hi = mid * 1.005;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const y = (price: number) => box.height - ((price - lo) / (hi - lo)) * box.height;

  const slot = box.width / Math.max(slots, 1);
  const candleWidth = Math.max(1, Math.floor(slot * 0.7));
  // najnowsza swieca przy prawej krawedzi, starsze w lewo
  const first = slots - bars.length;
  const xAt = (i: number) => (first + i + 0.5) * slot;
  const candles = bars.map((b, i): CandleShape => {
    const top = y(Math.max(b.open, b.close));
    const bottom = y(Math.min(b.open, b.close));
    return { x: xAt(i), wickTop: y(b.high), wickBottom: y(b.low), bodyTop: top, bodyHeight: Math.max(1, bottom - top), up: b.close >= b.open };
  });

  const step = gridStep(hi - lo);
  const grid = [];
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) grid.push({ price: p, y: y(p) });

  const dayLines = [];
  for (let i = 1; i < bars.length; i++) {
    const day = (bars[i] as Bar).day;
    if (day !== (bars[i - 1] as Bar).day) dayLines.push({ day, x: xAt(i) - slot / 2 });
  }
  return { candles, candleWidth, y, grid, dayLines };
}

/** Plakietka ceny ma 18 px wysokosci; podpis siatki blizej niz tyle zostalby nia przykryty. */
export const TAG_CLEARANCE = 14;

/**
 * Linie siatki, ktorych podpis mozna narysowac: nie przy samej krawedzi (bylby uciety w pol)
 * i nie pod plakietka ostatniej ceny ani wartosci godziwej (spod plakietki wystaja tylko kawalki cyfr).
 */
export function labelledGrid<T extends { readonly y: number }>(grid: readonly T[], plotHeight: number, tags: readonly number[]): T[] {
  return grid.filter((line) => line.y >= 7 && line.y <= plotHeight - 7 && tags.every((t) => Math.abs(t - line.y) >= TAG_CLEARANCE));
}

/**
 * Ile miejsc na swiece rysuje wykres: tyle, ile swiec, ale nie mniej niz `min` i nie wiecej niz
 * `max`. Na poczatku sesji kilka swiec nie stoi sciesnionych w prawym rogu 60 pustych miejsc.
 */
export function chartSlots(count: number, max: number, min = 20): number {
  return Math.min(max, Math.max(min, count));
}
