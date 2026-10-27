import type { Ticker } from "@hossa/economy";
import type { Snapshot } from "../sim/protocol.js";
import { toneOf } from "../world/format.js";

export interface NewsBar {
  update(snapshot: Snapshot): void;
}

/**
 * Pasek wiadomosci na dole ekranu: najnowszy nagłówek z kropka w kolorze wydzwieku. Nowa
 * wiadomosc wjezdza z animacja i jest czytana przez czytnik ekranu (aria-live). Klik otwiera
 * panel spolki, ktorej wiadomosc dotyczy najbardziej.
 */
export function createNewsBar(onPick: (ticker: Ticker, from: HTMLElement) => void): NewsBar {
  const bar = document.createElement("section");
  bar.className = "wiadomosci";
  bar.setAttribute("aria-label", "Wiadomości z miasteczka");
  bar.innerHTML = `<span class="wiadomosci-etykieta">Wiadomości</span><button type="button" class="wiadomosci-tekst" data-testid="wiadomosc" aria-live="polite"></button>`;
  const text = bar.querySelector(".wiadomosci-tekst") as HTMLButtonElement;
  document.body.append(bar);
  let shown = -1;
  let target: Ticker | undefined;
  text.addEventListener("click", () => {
    if (target) onPick(target, text);
  });

  return {
    update(snapshot) {
      const n = snapshot.news.at(-1);
      if (!n) {
        if (shown === -1 && text.textContent === "") {
          text.textContent = "Spokojnie — miasteczko pracuje, rynek czeka na wieści.";
          text.disabled = true;
          text.dataset.kierunek = "";
          text.title = text.textContent;
        }
        return;
      }
      if (n.id === shown) return;
      shown = n.id;
      target = n.tickers[0];
      text.disabled = !target;
      text.textContent = `dz. ${String(n.day)} · ${n.text}`;
      text.dataset.kierunek = toneOf(n.tone);
      // na waskim ekranie tekst jest uciety wielokropkiem — pelna tresc w podpowiedzi
      text.title = target ? `${text.textContent} (otwórz panel ${target})` : text.textContent;
      // nowa wiadomosc wjezdza od dolu; kto wylaczyl animacje w systemie, widzi ja od razu
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        text.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: "ease-out" });
      }
    },
  };
}
