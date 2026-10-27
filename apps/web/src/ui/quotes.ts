import type { Ticker } from "@hossa/economy";
import type { Snapshot } from "../sim/protocol.js";
import { change, price, trend } from "../world/format.js";
import { TICKERS } from "../world/companies.js";
import { setPressed } from "./dom.js";

export interface Quotes {
  update(snapshot: Snapshot, selected: Ticker | null): void;
}

/**
 * Tablica notowan: szesc spolek z kursem i zmiana od otwarcia. Kazda pozycja to przycisk —
 * otwiera panel spolki bez celowania w budynek, takze z klawiatury i na malym ekranie.
 */
export function createQuotes(onPick: (ticker: Ticker, from: HTMLElement) => void): Quotes {
  const nav = document.createElement("nav");
  nav.className = "notowania";
  nav.setAttribute("aria-label", "Notowania spółek");
  const rows = TICKERS.map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.testid = `notowanie-${t}`;
    b.innerHTML = `<span class="notowanie-ticker">${t}</span><span class="notowanie-cena"></span><span class="notowanie-zmiana"></span>`;
    b.addEventListener("click", () => {
      onPick(t, b);
    });
    nav.append(b);
    return { ticker: t, button: b, price: b.children[1] as HTMLElement, change: b.children[2] as HTMLElement, text: "" };
  });
  document.body.append(nav);
  // na telefonie lista przewija sie w bok: prawa krawedz gasnie, dopoki cos jeszcze jest za nia
  const edge = () => {
    nav.toggleAttribute("data-koniec", nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
  };
  nav.addEventListener("scroll", edge, { passive: true });
  new ResizeObserver(edge).observe(nav);

  return {
    update(snapshot, selected) {
      for (const r of rows) {
        const c = snapshot.companies[r.ticker];
        const pct = c.price / c.open - 1;
        setPressed(r.button, selected === r.ticker);
        const text = `${price(c.price)}|${change(pct)}`;
        if (text === r.text) continue;
        r.text = text;
        r.button.title = c.name;
        r.price.textContent = price(c.price);
        r.change.textContent = change(pct);
        r.button.dataset.kierunek = trend(pct);
      }
    },
  };
}
