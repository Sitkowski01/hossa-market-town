import type { Ticker } from "@hossa/economy";
import { BARS_SHOWN, type Snapshot } from "../sim/protocol.js";
import { change, price, toneOf, trend } from "../world/format.js";
import { chartSlots } from "../world/chart.js";
import { depth, facts, plant, tape, type DepthRow } from "../world/market-view.js";
import { countUp } from "../world/smooth.js";
import { drawChart } from "./chart.js";
import { setData, setText, sync, type Row } from "./dom.js";

export interface Panel {
  readonly element: HTMLElement;
  readonly ticker: Ticker | null;
  open(ticker: Ticker): void;
  close(): void;
  update(snapshot: Snapshot): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

/** Jak dlugo kurs dochodzi do wartosci po otwarciu panelu. */
const COUNT_MS = 600;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Panel spolki: kurs i zmiana, wykres swiecowy, arkusz zlecen, tasma transakcji, fundamenty
 * i wiadomosci. Na komputerze stoi po prawej, na telefonie wysuwa sie od dolu. Dane przychodza
 * z migawki workera (pole `detail`), wiec panel niczego nie liczy — tylko je pokazuje.
 */
export function createPanel(onClose: () => void): Panel {
  const root = el("aside", "panel");
  root.setAttribute("aria-labelledby", "panel-nazwa");
  root.dataset.testid = "panel";
  root.hidden = true;
  root.innerHTML = `
    <header class="panel-naglowek">
      <div>
        <h2 id="panel-nazwa" class="panel-nazwa"></h2>
        <p class="panel-zaklad"></p>
      </div>
      <button type="button" class="panel-zamknij" aria-label="Zamknij panel">×</button>
    </header>
    <div class="panel-kurs">
      <strong class="panel-cena" data-testid="panel-cena"></strong>
      <span class="panel-zmiana"></span>
    </div>
    <div class="panel-tresc" tabindex="0" aria-label="Szczegóły spółki">
      <section aria-label="Wykres">
        <canvas class="panel-wykres" role="img" aria-label="Wykres świecowy z ostatnich trzech dni"></canvas>
        <p class="panel-legenda"><span class="legenda-wycena"></span> wartość godziwa · świeca = 1/20 dnia</p>
      </section>
      <div class="panel-kolumny">
        <section aria-labelledby="h-arkusz">
          <h3 id="h-arkusz">Arkusz zleceń</h3>
          <ol class="arkusz arkusz-sprzedaz" aria-label="Oferty sprzedaży"></ol>
          <p class="arkusz-spread"></p>
          <ol class="arkusz arkusz-kupno" aria-label="Oferty kupna"></ol>
        </section>
        <section aria-labelledby="h-tasma">
          <h3 id="h-tasma">Transakcje</h3>
          <ol class="tasma" data-testid="tasma"></ol>
        </section>
      </div>
      <section aria-labelledby="h-fundamenty">
        <h3 id="h-fundamenty">Fundamenty</h3>
        <dl class="fundamenty"></dl>
      </section>
      <section aria-labelledby="h-wiadomosci">
        <h3 id="h-wiadomosci">Wiadomości spółki</h3>
        <ol class="panel-wiadomosci"></ol>
      </section>
    </div>`;
  const q = (selector: string) => root.querySelector(selector) as HTMLElement;
  const name = q(".panel-nazwa");
  const plantText = q(".panel-zaklad");
  const last = q(".panel-cena");
  const delta = q(".panel-zmiana");
  const chart = q(".panel-wykres") as HTMLCanvasElement;
  const asks = q(".arkusz-sprzedaz");
  const bids = q(".arkusz-kupno");
  const spread = q(".arkusz-spread");
  const prints = q(".tasma");
  const fundamentals = q(".fundamenty");
  const news = q(".panel-wiadomosci");
  q(".panel-zamknij").addEventListener("click", onClose);
  document.body.append(root);

  const levels = (rows: readonly DepthRow[]): Row[] => rows.map((r) => ({ cells: [r.price, r.quantity], vars: { "--udzial": r.share.toFixed(3) } }));
  const empty = (text: string): Row[] => [{ cells: [text], className: "pusto" }];

  let current: Ticker | null = null;
  // wykres rysuje sie od nowa tylko, gdy cos sie na nim zmienilo (w pauzie migawki sa takie same)
  let drawn = "";
  /** Licznik kursu po otwarciu panelu: od jakiej ceny i od kiedy; null = kurs wpisywany wprost. */
  let counting: { from: number; start: number } | null = null;
  let target = 0;
  return {
    element: root,
    get ticker() {
      return current;
    },
    open(ticker) {
      current = ticker;
      root.hidden = false;
      root.dataset.spolka = ticker;
      // reszta interfejsu robi miejsce panelowi (na telefonie chowa notowania i wiadomosci)
      document.body.dataset.panel = ticker;
      // poprzednia spolka nie mignie, zanim przyjda dane nowej
      for (const list of [asks, bids, prints, news, fundamentals]) list.replaceChildren();
      name.textContent = ticker;
      counting = null;
      for (const node of [plantText, last, delta]) node.textContent = "";
      delete plantText.dataset.stoi;
      // te same opcje co w drawChart: kontekst canvasa tworzy sie raz, z opcjami pierwszego wywolania
      const g = chart.getContext("2d", { willReadFrequently: true });
      g?.setTransform(1, 0, 0, 1, 0, 0);
      g?.clearRect(0, 0, chart.width, chart.height);
      drawn = "";
    },
    close() {
      current = null;
      root.hidden = true;
      delete root.dataset.spolka;
      delete document.body.dataset.panel;
    },
    update(snapshot) {
      const d = snapshot.detail;
      if (!current || d?.ticker !== current) return;
      const c = snapshot.companies[current];
      setText(name, `${c.name} · ${current}`);
      setText(plantText, plant(current, c.output) ?? "kredyty dla firm z miasteczka");
      setData(plantText, "stoi", String(c.output <= 0 && current !== "GRS"));
      // pierwsze dane po otwarciu: kurs dochodzi od otwarcia do biezacego (ile spolka przeszla dzisiaj)
      if (counting === null && last.textContent === "" && !still.matches) {
        counting = { from: c.open, start: performance.now() };
        const tick = (now: number) => {
          if (!counting) return;
          const t = (now - counting.start) / COUNT_MS;
          last.textContent = price(countUp(counting.from, target, t));
          if (t < 1) requestAnimationFrame(tick);
          else counting = null;
        };
        requestAnimationFrame(tick);
      }
      target = c.price;
      if (!counting) setText(last, price(c.price));
      const pct = c.price / c.open - 1;
      setText(delta, `${change(pct)} od otwarcia`);
      setData(delta, "kierunek", trend(pct));

      const lastBar = d.bars.at(-1);
      const key = [Math.floor(snapshot.time), d.bars.length, lastBar?.day, lastBar?.high, lastBar?.low, lastBar?.close, d.bars[0]?.open, c.fair, c.price, chart.clientWidth, chart.clientHeight].join("|");
      if (key !== drawn) {
        drawn = key;
        drawChart(chart, d.bars, c.fair, c.price, chartSlots(d.bars.length, BARS_SHOWN));
      }

      const book = depth(d.bids, d.asks);
      sync(asks, levels(book.asks));
      sync(bids, levels(book.bids));
      setText(spread, book.spread ? `spread ${book.spread}` : "jedna strona arkusza pusta");

      sync(
        prints,
        d.tape.length === 0
          ? empty("Jeszcze nikt nie handlował.")
          : tape(d.tape).map((t) => ({
              cells: [t.price, t.quantity, t.side === "kupno" ? "K" : "S"],
              data: { strona: t.side },
              title: t.side === "kupno" ? "kupujący uderzył w ofertę sprzedaży" : "sprzedający uderzył w ofertę kupna",
            })),
      );

      // para dt/dd w <div> (dozwolone w <dl>), zeby kazdy fakt byl jednym wierszem do aktualizacji
      sync(
        fundamentals,
        facts(c, d.fundamentals).map((f) => ({ cells: [f.label, f.value], data: { kierunek: toneOf(f.sign) } })),
        "div",
        ["dt", "dd"],
      );

      sync(
        news,
        d.news.length === 0
          ? empty("Na razie cisza — żadnych wiadomości o spółce.")
          : [...d.news].reverse().map((n) => ({ cells: [`dz. ${String(n.day)}`, n.text], data: { kierunek: toneOf(n.tone) } })),
      );
    },
  };
}
