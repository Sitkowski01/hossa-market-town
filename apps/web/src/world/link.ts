import type { Link } from "../sim/protocol.js";
import { count } from "./format.js";

export interface LinkLabel {
  readonly text: string;
  /** ok = zgodnie, czeka = laczenie albo gielda nie nadaza, blad = roznice albo brak polaczenia. */
  readonly tone: "ok" | "czeka" | "blad";
  /** Dymek: co znaczy plakietka albo co dokladnie poszlo nie tak. */
  readonly title: string;
}

const ABOUT = "Każde zlecenie botów idzie też do Parkietu (giełda w Javie) i daje te same zdarzenia co silnik w przeglądarce. Kursy, arkusz i taśma są z Parkietu.";

/** Plakietka trybu polaczonego w pasku u gory. */
export function linkLabel(link: Link): LinkLabel {
  const why = link.lastError ?? "";
  if (link.state === "connecting") return { text: "Parkiet · łączenie…", tone: "czeka", title: ABOUT };
  if (link.state === "error") return { text: "Parkiet · brak połączenia", tone: "blad", title: why };
  if (link.mismatched > 0) return { text: `Parkiet · różnice: ${count(link.mismatched)}`, tone: "blad", title: why };
  if (!link.streaming) return { text: "Parkiet · strumień zamknięty", tone: "blad", title: "Strumień notowań /ws/market się rozłączył — kursy na scenie są z przeglądarki, łącze próbuje wrócić." };
  const agreed = `Parkiet ✓ ${count(link.matched)} zgodnych`;
  if (link.waiting) return { text: `${agreed} · czeka na giełdę`, tone: "czeka", title: `${ABOUT} Czas stoi, aż Parkiet obsłuży ${count(link.pending)} zleceń z kolejki.` };
  // po pierwszym bledzie lacza mirror przechodzi w stan error, wiec tu bledow juz nie ma
  return { text: agreed, tone: "ok", title: ABOUT };
}
