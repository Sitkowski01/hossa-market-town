import type { Ticker } from "@hossa/economy";
import type { Snapshot } from "../sim/protocol.js";
import { change, price, trend } from "../world/format.js";
import { TICKERS } from "../world/companies.js";
import { setPressed } from "./dom.js";

export interface Quotes {
  update(snapshot: Snapshot, selected: Ticker | null): void;
  /** Wiersz spolki, nad ktorej budynkiem albo tabliczka jest kursor. */
  highlight(ticker: Ticker | null): void;
}

/**
 * Tablica notowan: szesc spolek z kursem i zmiana od otwarcia. Kazda pozycja to przycisk —
 * otwiera panel spolki bez celowania w budynek, takze z klawiatury i na malym ekranie.
 */
const FLASH = { wzrost: "#34d399", spadek: "#f87171", "": "#f8fafc" } as const;
const still = matchMedia("(prefers-reduced-motion: reduce)");

export function createQuotes(onPick: (ticker: Ticker, from: HTMLElement) => void, onHover: (ticker: Ticker | null) => void = () => undefined): Quotes {
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
    b.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") onHover(t);
    });
    b.addEventListener("pointerleave", () => {
      onHover(null);
    });
    nav.append(b);
    return { ticker: t, button: b, price: b.children[1] as HTMLElement, change: b.children[2] as HTMLElement, text: "", last: 0 };
  });
  document.body.append(nav);
  // na telefonie lista przewija sie w bok: prawa krawedz gasnie, dopoki cos jeszcze jest za nia
  const edge = () => {
    nav.toggleAttribute("data-koniec", nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
  };
  nav.addEventListener("scroll", edge, { passive: true });
  new ResizeObserver(edge).observe(nav);

  return {
    highlight(ticker) {
      for (const r of rows) r.button.toggleAttribute("data-podswietlona", r.ticker === ticker);
    },
    update(snapshot, selected) {
      for (const r of rows) {
        const c = snapshot.companies[r.ticker];
        const pct = c.price / c.open - 1;
        setPressed(r.button, selected === r.ticker);
        const text = `${price(c.price)}|${change(pct)}`;
        if (text === r.text) continue;
        // zmiana kursu (nie pierwsze wypelnienie): cena na chwile zapala sie kolorem ruchu, jak na
        // tablicy maklerskiej (ruch od poprzedniej ceny, nie od otwarcia: spolka na plusie tez spada);
        // caly wiersz migalby przy tempie 1x przez jedna trzecia czasu
        if (r.text !== "" && !still.matches) r.price.animate([{ color: FLASH[trend(c.price / r.last - 1)] }, {}], { duration: 600, easing: "ease-out" });
        r.last = c.price;
        r.text = text;
        r.button.title = c.name;
        // jednostka z CSS: na komputerze "zl" przy cenie, na waskim kafelku telefonu sama liczba
        r.price.textContent = price(c.price).replace(/ zł$/, "");
        r.change.textContent = change(pct);
        r.button.dataset.kierunek = trend(pct);
      }
    },
  };
}
