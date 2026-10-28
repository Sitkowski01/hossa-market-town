/** Plynne przejscie 0 -> 1 miedzy edge0 a edge1 (jak smoothstep w GLSL): lagodny start i koniec. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Licznik "dochodzacy" do wartosci: od `from` do `to` w czasie 0..1, szybko na poczatku i lagodnie
 * na koncu (ease-out), zaokraglony do pelnych groszy.
 */
export function countUp(from: number, to: number, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return Math.round(from + (to - from) * (1 - (1 - x) ** 3));
}
