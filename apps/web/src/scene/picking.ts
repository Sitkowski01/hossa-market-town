import type { Ticker } from "@hossa/economy";
import * as THREE from "three";
import { tickerOf } from "../world/flight.js";
import type { Model } from "./model.js";

/** Przesuniecie wskaznika (px), powyzej ktorego to bylo obracanie kamery, a nie klikniecie. */
const DRAG_PX = 6;

export interface Picker {
  /** Spolka pod punktem ekranu albo null (ulica, domy, morze). */
  at(clientX: number, clientY: number): Ticker | null;
}

/**
 * Wybieranie spolki na makiecie: promien z kamery przez punkt ekranu trafia w budynek albo
 * w tabliczke z kursem. Sprawdzamy tylko obiekty spolek (bez drzew i domow z instancji),
 * wiec promien jest tani nawet przy ruchu myszy.
 */
export function createPicker(model: Model, camera: THREE.Camera, canvas: HTMLCanvasElement, signs: readonly THREE.Object3D[]): Picker {
  const targets: THREE.Object3D[] = [...signs];
  for (const top of model.root.children) if (tickerOf(top.name)) targets.push(top);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const owner = (o: THREE.Object3D): Ticker | null => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      const t = (n.userData as { ticker?: Ticker }).ticker ?? tickerOf(n.name);
      if (t) return t;
    }
    return null;
  };

  return {
    at(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const hit of ray.intersectObjects(targets, true)) {
        if (!hit.object.visible) continue;
        const t = owner(hit.object);
        if (t) return t;
      }
      return null;
    },
  };
}

/**
 * Klikniecie w makiete, ale nie koniec obracania: pointerdown i pointerup blisko siebie, jednym
 * palcem (gest dwoma palcami to przyblizanie, nawet gdy palce prawie sie nie ruszyly).
 * Kursor nad spolka zmienia sie w raczke, a `hover` dostaje spolke pod kursorem (tylko mysz —
 * na dotyku nie ma najechania).
 */
export function onPick(canvas: HTMLCanvasElement, picker: Picker, pick: (ticker: Ticker | null) => void, hover: (ticker: Ticker | null) => void = () => undefined): void {
  let down: { x: number; y: number } | null = null;
  const pointers = new Set<number>();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.add(e.pointerId);
    // prawy i srodkowy przycisk przesuwaja kamere — wybiera tylko lewy (i dotyk, ktory ma button 0)
    down = pointers.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
  };
  canvas.addEventListener("pointercancel", (e) => {
    lift(e);
    down = null;
  });
  canvas.addEventListener("pointerup", (e) => {
    lift(e);
    if (down && pointers.size === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_PX) pick(picker.at(e.clientX, e.clientY));
    if (pointers.size === 0) down = null;
  });
  let pending = false;
  // kursor juz poza makieta: sprawdzenie zamowione na nastepna klatke nie moze podswietlic
  // budynku, nad ktorym byl wczesniej (np. gdy przeszedl prosto na wiersz notowan)
  let inside = false;
  canvas.addEventListener("pointermove", (e) => {
    inside = true;
    if (e.pointerType !== "mouse" || e.buttons !== 0 || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!inside) return;
      const t = picker.at(e.clientX, e.clientY);
      canvas.style.cursor = t ? "pointer" : "";
      hover(t);
    });
  });
  canvas.addEventListener("pointerleave", () => {
    inside = false;
    hover(null);
  });
}
