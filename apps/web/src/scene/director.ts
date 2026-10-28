import type { Ticker } from "@hossa/economy";
import * as THREE from "three";
import { FLIGHT_MS, INTRO_MS, flightAt, focusPose, introPose, type Pose, type Vec3 } from "../world/flight.js";
import type { Model } from "./model.js";
import type { Stage } from "./stage.js";

export interface Director {
  /** Makieta przychodzi po starcie; przelot zamowiony wczesniej rusza, gdy juz jest. */
  useModel(model: Model): void;
  /** Przelot do budynku spolki; pierwszy zapamietuje ujecie, do ktorego wraca `release`. */
  focus(ticker: Ticker): void;
  release(): void;
  /** Przelot powitalny do obecnego ujecia; pomijany, gdy kamera juz gdzies leci. */
  intro(): void;
  /** Ile ekranu zaslania panel: obraz przesuwa sie tak, zeby budynek byl w srodku reszty. */
  /** Ile ekranu zaslania interfejs: lista notowan z lewej, panel z prawej albo od dolu (piksele CSS). */
  setInset(left: number, right: number, bottom: number): void;
  update(now: number): void;
}

const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
/** Jak szybko obraz dogania przesuniecie pod panel (na sekunde). */
const SHIFT_RATE = 6;

const still = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Kamera w trybie panelu: podlatuje do kliknietego zakladu, patrzy na niego z tego samego
 * kierunku co wczesniej i pozwala go obracac (OrbitControls kreci sie wokol budynku).
 * Po zamknieciu panelu wraca do ujecia sprzed pierwszego przelotu.
 */
export function createDirector(stage: Stage): Director {
  const { camera, controls } = stage;
  const poses = new Map<Ticker, { center: Vec3; distance: number }>();
  let model: Model | undefined;
  let wanted: Ticker | null = null;
  const frame = (t: Ticker, m: Model) => {
    let p = poses.get(t);
    if (!p) {
      // srodek i wielkosc glownego budynku spolki (bez falochronu czy dalekich zwalow)
      const sphere = new THREE.Box3().setFromObject(m.node(t)).getBoundingSphere(new THREE.Sphere());
      const distance = THREE.MathUtils.clamp(sphere.radius * 3.4, 110, 240);
      p = { center: [sphere.center.x, Math.min(sphere.center.y, 12), sphere.center.z], distance };
      poses.set(t, p);
    }
    return p;
  };
  const now = (): Pose => ({ position: vec(camera.position), target: vec(controls.target) });

  let flight: { from: Pose; to: Pose; elapsed: number; prev: number; duration: number; intro: boolean } | null = null;
  let home: Pose | null = null;
  // ujecie domowe znika dopiero po wyladowaniu: panel otwarty w trakcie powrotu nie zapamieta
  // jako domu punktu w polowie drogi
  let returning = false;
  const fly = (to: Pose, from = now(), duration = FLIGHT_MS, intro = false) => {
    // przy ograniczonym ruchu kamera przeskakuje od razu (przelot trwa jedna klatke)
    flight = { from, to, elapsed: 0, prev: -1, duration: still.matches ? 1 : duration, intro };
    controls.enabled = false;
  };

  const inset = { left: 0, right: 0, bottom: 0 };
  const shift = { x: 0, y: 0 };
  let last = performance.now();
  let applied = "";

  const go = (ticker: Ticker, m: Model) => {
    returning = false;
    // w trakcie przelotu powitalnego domem jest jego cel, nie punkt w polowie drogi
    home ??= flight?.intro ? flight.to : now();
    const { center, distance } = frame(ticker, m);
    fly(focusPose(now(), center, distance));
  };

  return {
    useModel(m) {
      model = m;
      if (wanted) go(wanted, m);
    },
    focus(ticker) {
      wanted = ticker;
      if (model) go(ticker, model);
    },
    release() {
      wanted = null;
      if (!home) return;
      fly(home);
      returning = true;
    },
    intro() {
      if (flight) return;
      const end = now();
      fly(end, introPose(end), INTRO_MS, true);
    },
    setInset(left, right, bottom) {
      inset.left = left;
      inset.right = right;
      inset.bottom = bottom;
    },
    update(time) {
      if (flight) {
        // najwyzej 50 ms na klatke: pierwsze klatki po wczytaniu (tekstury, mapa cieni) trwaja
        // nawet sekundy i z zegarem sciennym kamera wyladowalaby od razu u celu
        if (flight.prev >= 0) flight.elapsed += Math.min(time - flight.prev, 50);
        flight.prev = time;
        const p = flightAt(flight.from, flight.to, flight.elapsed, flight.duration);
        camera.position.set(...p.position);
        controls.target.set(...p.target);
        if (flight.elapsed >= flight.duration) {
          flight = null;
          controls.enabled = true;
          if (returning) home = null;
          returning = false;
        }
      }
      const dt = Math.min((time - last) / 1000, 0.1);
      last = time;
      const k = 1 - Math.exp(-SHIFT_RATE * dt);
      // srodek kadru = srodek wolnego pola miedzy lista notowan a panelem
      shift.x += ((inset.right - inset.left) / 2 - shift.x) * k;
      shift.y += (inset.bottom / 2 - shift.y) * k;
      const w = stage.renderer.domElement.clientWidth;
      const h = stage.renderer.domElement.clientHeight;
      // obie metody przeliczaja macierz rzutowania, wiec wolamy je tylko, gdy przesuniecie sie zmienilo
      const centered = Math.abs(shift.x) < 0.5 && Math.abs(shift.y) < 0.5;
      const key = centered ? "" : `${String(w)}|${String(h)}|${shift.x.toFixed(1)}|${shift.y.toFixed(1)}`;
      if (key === applied) return;
      applied = key;
      if (centered) camera.clearViewOffset();
      else camera.setViewOffset(w, h, shift.x, shift.y, w, h);
    },
  };
}
