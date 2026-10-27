/** Prostokat na ekranie w pikselach CSS (jak DOMRect). */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Czy tabliczka kursu wpada pod ktorys z paneli interfejsu. Margines `gap` sprawia, ze tabliczka
 * znika, zanim dotknie panelu — inaczej wystaje zza niego skrawek z polowa ceny.
 */
export function covered(sign: Rect, panels: readonly Rect[], gap = 6): boolean {
  return panels.some((p) => sign.left < p.right + gap && sign.right > p.left - gap && sign.top < p.bottom + gap && sign.bottom > p.top - gap);
}

/** Przejscie przezroczystosci do celu ze stala predkoscia (na sekunde), bez przeskoku. */
export function fade(current: number, target: number, dt: number, rate = 6): number {
  const step = rate * dt;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}
