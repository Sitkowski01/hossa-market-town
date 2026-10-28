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

/**
 * O ile pikseli podniesc kazda tabliczke, zeby sie nie nakladaly (GRS i KSZ stoja obok siebie na
 * rynku). Nizsza na ekranie zostaje, wyzsza idzie nad nia — tak jak etykiety na wykresie.
 */
export function lifts(signs: readonly Rect[], gap = 4): number[] {
  const order = signs.map((_, i) => i).sort((a, b) => (signs[b]?.bottom ?? 0) - (signs[a]?.bottom ?? 0));
  const out = signs.map(() => 0);
  const placed: Rect[] = [];
  for (const i of order) {
    let r = signs[i] as Rect;
    let lift = 0;
    for (let moved = true; moved; ) {
      moved = false;
      for (const p of placed) {
        if (r.left < p.right && r.right > p.left && r.top < p.bottom + gap && r.bottom > p.top - gap) {
          const d = r.bottom - (p.top - gap);
          lift += d;
          r = { ...r, top: r.top - d, bottom: r.bottom - d };
          moved = true;
        }
      }
    }
    out[i] = lift;
    placed.push(r);
  }
  return out;
}
