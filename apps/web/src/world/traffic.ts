import type { Good } from "@hossa/economy";
import { smoothstep } from "./smooth.js";

/** Ile miesci jedna ciezarowka: tony rudy i stali albo sztuki maszyn. */
export const TRUCK_LOAD: Readonly<Record<Good, number>> = { ruda: 300, stal: 175, maszyny: 50 };
/** Wiecej ciezarowek na jednej trasie naraz robi z drogi korek, a nie pokazuje wiecej. */
export const MAX_TRUCKS = 4;

const FIRST_DEPARTURE = 0.05;
const LAST_DEPARTURE = 0.55;
/** Przejazd trwa taki ulamek dnia — ostatnia ciezarowka dojezdza przed polnoca gospodarki. */
const TRIP = 0.4;

/**
 * Dzisiejsza wysylka jako kolumna ciezarowek: ilu ich trzeba na ladunek (najwyzej MAX_TRUCKS)
 * i kiedy ruszaja (ulamki dnia, rowno od rana do wczesnego popoludnia).
 */
export function departures(good: Good, quantity: number): number[] {
  const trucks = Math.min(MAX_TRUCKS, Math.max(0, Math.ceil(quantity / TRUCK_LOAD[good])));
  if (trucks === 1) return [FIRST_DEPARTURE];
  return Array.from({ length: trucks }, (_, i) => FIRST_DEPARTURE + ((LAST_DEPARTURE - FIRST_DEPARTURE) * i) / (trucks - 1));
}

/** Postep (0..1) tych ciezarowek z dzisiejszej wysylki, ktore sa teraz w drodze. */
export function convoy(good: Good, quantity: number, dayFraction: number): number[] {
  return departures(good, quantity)
    .map((departs) => (dayFraction - departs) / TRIP)
    .filter((progress) => progress >= 0 && progress <= 1);
}

/**
 * Gdzie jest statek: przy nabrzezu, w drodze albo na redzie (za falochronem, w sztorm tam czeka).
 * chroni_sie = odplywa pusty przed sztormem; zawija = wraca z redy, laduje i odplywa tego samego dnia
 * (pierwszy spokojny dzien po sztormie, gdy w porcie czeka towar).
 */
export type ShipPhase = "przy_nabrzezu" | "wyplywa" | "wraca" | "na_redzie" | "chroni_sie" | "zawija";

/**
 * Odleglosc statku od nabrzeza: 0 = przy nabrzezu, 1 = na redzie. W dniu zaladunku dzwigi
 * pracuja rano, a statek odplywa po poludniu; nowy statek wplywa nastepnego ranka.
 */
export function shipOffset(phase: ShipPhase, dayFraction: number): number {
  switch (phase) {
    case "przy_nabrzezu":
      return 0;
    case "na_redzie":
      return 1;
    case "wyplywa":
      return smoothstep(0.3, 0.8, dayFraction);
    case "wraca":
      return 1 - smoothstep(0, 0.5, dayFraction);
    case "chroni_sie":
      return smoothstep(0.1, 0.6, dayFraction);
    case "zawija":
      return dayFraction < 0.5 ? 1 - smoothstep(0, 0.25, dayFraction) : smoothstep(0.6, 0.95, dayFraction);
  }
}

/** Kiedy statek stoi przy nabrzezu i jaka czesc stosow w porcie jeszcze na niego czeka (1 = wszystko). */
export function portActivity(phase: ShipPhase, dayFraction: number): { readonly docked: boolean; readonly left: number } {
  switch (phase) {
    case "przy_nabrzezu":
      return { docked: true, left: 1 };
    case "wyplywa":
      return { docked: dayFraction < 0.3, left: 1 - smoothstep(0, 0.3, dayFraction) };
    case "zawija":
      return { docked: dayFraction >= 0.25 && dayFraction < 0.6, left: 1 - smoothstep(0.25, 0.55, dayFraction) };
    default:
      return { docked: false, left: 1 };
  }
}

/**
 * Faza statku na kolejny dzien. Pilnuje ciaglosci: dzien zaczyna sie tam, gdzie skonczyl
 * poprzedni (na redzie po odplynieciu albo przeczekaniu sztormu, inaczej przy nabrzezu).
 */
export function nextShipPhase(previous: ShipPhase, storm: boolean, loaded: boolean): ShipPhase {
  const atSea = previous !== "przy_nabrzezu" && previous !== "wraca";
  if (storm) return atSea ? "na_redzie" : "chroni_sie";
  if (atSea) return loaded ? "zawija" : "wraca";
  return loaded ? "wyplywa" : "przy_nabrzezu";
}
