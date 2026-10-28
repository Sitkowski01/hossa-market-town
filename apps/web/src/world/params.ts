import type { Ticker } from "@hossa/economy";
import { SPEEDS, type Speed } from "../sim/protocol.js";
import { tickerOf } from "./flight.js";

export interface Params {
  readonly seed: number;
  readonly speed: Speed;
  /** Zatrzymana pora dnia (do zrzutow ekranu). */
  readonly hour?: number;
  /** Polozenie kamery i punkt, na ktory patrzy: x, y, z, celX, celY, celZ. */
  readonly camera?: readonly [number, number, number, number, number, number];
  /** Spolka, ktorej panel otwiera sie od razu (link "zobacz strajk w RUD"). */
  readonly company?: Ticker;
  /** Tryb polaczony: adres Parkietu na tym samym serwerze (proxy Vite), domyslnie /parkiet. */
  readonly parkiet?: string;
}

const MAX_SEED = 2 ** 31;

/** Liczba z parametru albo NaN, gdy parametru nie ma lub jest pusty (Number("") to 0, nie NaN). */
const numberOf = (text: string | null): number => (text === null || text.trim() === "" ? Number.NaN : Number(text));

/**
 * Parametry z adresu strony: ?seed=42&tempo=4&godzina=12&kamera=x,y,z,celX,celY,celZ&spolka=RUD&parkiet.
 * Adres moze przyjsc od kazdego, wiec zle wartosci sa pomijane, a nie przekazywane dalej:
 * NaN jako ziarno zepsuloby cala sesje, a NaN jako godzina zaciemnilby scene.
 */
export function readParams(search: string, random: () => number = Math.random): Params {
  const q = new URLSearchParams(search);
  const seedValue = numberOf(q.get("seed"));
  const seed = Number.isInteger(seedValue) && seedValue >= 0 && seedValue < MAX_SEED ? seedValue : Math.floor(random() * 1e6);
  const speed = SPEEDS.find((s) => String(s) === q.get("tempo")) ?? 1;
  const hourValue = numberOf(q.get("godzina"));
  const hour = hourValue >= 0 && hourValue < 24 ? hourValue : undefined;
  const view = q.get("kamera")?.split(",").map(numberOf);
  const camera = view?.length === 6 && view.every(Number.isFinite) ? (view as unknown as Params["camera"]) : undefined;
  const name = q.get("spolka")?.toUpperCase() ?? "";
  // sam ticker, bez czesci budynku: "STW" tak, "STW_suwnica" nie
  const company = tickerOf(name) === name ? name : null;
  // tylko sciezka na tym serwerze z niepustymi segmentami: "//host" i "/" (z ktorego mirror zrobilby
  // "//api") prowadzilyby na obcy adres, a link od obcego nie moze skierowac tam zlecen
  const link = q.get("parkiet");
  const parkiet = link === "" ? "/parkiet" : link !== null && /^(\/[\w-]+)+$/.test(link) ? link : undefined;
  return { seed, speed, ...(hour === undefined ? {} : { hour }), ...(camera ? { camera } : {}), ...(company ? { company } : {}), ...(parkiet ? { parkiet } : {}) };
}
