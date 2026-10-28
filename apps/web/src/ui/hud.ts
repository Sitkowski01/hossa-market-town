import { SPEEDS, type Snapshot, type Speed } from "../sim/protocol.js";
import { change, trend } from "../world/format.js";
import { linkLabel } from "../world/link.js";
import { setData, setPressed, setText } from "./dom.js";

export interface Hud {
  update(snapshot: Snapshot, hour: number): void;
}

const LABELS: Record<Speed, string> = { 0: "❚❚", 1: "1×", 4: "4×", 16: "16×" };

/** Pasek u gory: dzien i godzina w miasteczku, indeks i tempo czasu. */
export function createHud(onSpeed: (speed: Speed) => void): Hud {
  const bar = document.createElement("header");
  bar.className = "hud";
  bar.innerHTML = `
    <strong class="hud-nazwa">Hossa</strong>
    <span class="hud-czas" data-testid="czas"></span>
    <span class="hud-indeks" data-testid="indeks"></span>
    <nav class="hud-tempo" aria-label="Tempo czasu"></nav>
    <span class="hud-parkiet" data-testid="parkiet" role="status" hidden></span>`;
  const time = bar.querySelector(".hud-czas") as HTMLElement;
  const index = bar.querySelector(".hud-indeks") as HTMLElement;
  const nav = bar.querySelector(".hud-tempo") as HTMLElement;
  const parkiet = bar.querySelector(".hud-parkiet") as HTMLElement;
  const buttons = SPEEDS.map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = LABELS[s];
    // czytnik ekranu nie przeczyta "❚❚" jako pauzy, a title nie nadaje nazwy przyciskowi z tekstem
    if (s === 0) b.setAttribute("aria-label", "Pauza");
    b.title = s === 0 ? "Pauza" : `Tempo ${String(s)}×`;
    b.addEventListener("click", () => {
      onSpeed(s);
    });
    nav.append(b);
    return { speed: s, button: b };
  });
  document.body.append(bar);
  // lista notowan stoi pod paskiem; pasek zawija sie (waski ekran, otwarty panel), wiec jego dol
  // idzie do CSS jako zmienna, zamiast sztywnych 64 px, pod ktorymi znikala druga linia z pauza
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--hud-dol", `${String(Math.round(bar.getBoundingClientRect().bottom))}px`);
  }).observe(bar);

  return {
    update(snapshot, hour) {
      const h = Math.floor(hour);
      const m = Math.floor((hour - h) * 60);
      setText(time, `Dzień ${String(snapshot.day)} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      const pct = snapshot.index / snapshot.indexOpen - 1;
      setText(index, `Indeks ${snapshot.index.toFixed(1).replace(".", ",")} (${change(pct)})`);
      setData(index, "kierunek", trend(pct));
      for (const { speed, button } of buttons) setPressed(button, speed === snapshot.speed);
      if (snapshot.link) {
        const label = linkLabel(snapshot.link);
        parkiet.hidden = false;
        setText(parkiet, label.text);
        setData(parkiet, "stan", label.tone);
        if (parkiet.title !== label.title) parkiet.title = label.title;
      }
    },
  };
}
