import type { Ticker } from "@hossa/economy";
import "./fonts.js";
import type { FromWorker, Snapshot, ToWorker } from "./sim/protocol.js";
import { dayFraction, extrapolate } from "./sim/clock.js";
import { createDirector } from "./scene/director.js";
import { loadModel } from "./scene/model.js";
import { createPicker, onPick } from "./scene/picking.js";
import { createPickets } from "./scene/pickets.js";
import { createProps } from "./scene/props.js";
import { createRain } from "./scene/rain.js";
import { createGroundShadow, createSky } from "./scene/sky.js";
import { createSmoke } from "./scene/smoke.js";
import { createStage } from "./scene/stage.js";
import { installSzlifHook } from "./scene/szlif.js";
import { createTickers } from "./scene/tickers.js";
import { createTrucks } from "./scene/trucks.js";
import { createWalkers } from "./scene/walkers.js";
import { createHud } from "./ui/hud.js";
import { createNewsBar } from "./ui/news.js";
import { createPanel } from "./ui/panel.js";
import { createQuotes } from "./ui/quotes.js";
import { daylight, hourOf } from "./world/daylight.js";
import { readParams } from "./world/params.js";

const { seed, speed, hour: fixedHour, camera: view, company, parkiet } = readParams(location.search);

const canvas = document.getElementById("scena") as HTMLCanvasElement;
const stage = createStage(canvas);
const sky = createSky(stage.renderer, stage.scene, stage.lowPower);
if (view) {
  const [x, y, z, tx, ty, tz] = view;
  stage.camera.position.set(x, y, z);
  stage.controls.target.set(tx, ty, tz);
}

let latest: Snapshot | undefined;
let receivedAt = 0;
const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => {
  worker.postMessage(msg);
};
const hud = createHud((s) => {
  send({ type: "speed", speed: s });
});

// panel spolki: klik w budynek, tabliczke, notowanie albo wiadomosc
const director = createDirector(stage);
let opener: HTMLElement | null = null;
/**
 * `from` to przycisk, ktorym otwarto panel — po zamknieciu (Escape, ×) wraca do niego fokus.
 * Nie bierzemy document.activeElement: Safari nie daje fokusu kliknietemu przyciskowi.
 * Zamkniecie kliknieciem w scene fokusu nie przenosi — uzytkownik jest wtedy przy makiecie.
 */
const select = (ticker: Ticker | null, from: HTMLElement | null = null) => {
  if (ticker === panel.ticker) return;
  if (!ticker) {
    panel.close();
    director.release();
    fitInset();
    send({ type: "focus", ticker: null });
    if (from !== canvas) opener?.focus();
    opener = null;
    return;
  }
  if (!panel.ticker) opener = from === canvas ? null : from;
  panel.open(ticker);
  send({ type: "focus", ticker });
  director.focus(ticker);
  if (latest) quotes.update(latest, ticker);
};
const panel = createPanel(() => {
  select(null);
});
// najechanie na budynek, tabliczke albo wiersz notowan wyroznia te sama spolke w obu miejscach
let hoverTicker: (ticker: Ticker | null) => void = () => undefined;
const quotes = createQuotes(select, (t) => {
  hoverTicker(t);
});
const newsBar = createNewsBar(select);
// panel zaslania prawa strone (komputer) albo dol ekranu (telefon) — scena przesuwa obraz o tyle
const szlifMode = new URLSearchParams(location.search).has("szlif");
const fitInset = () => {
  // bez panelu: na wezszym ekranie makieta odsuwa sie od listy notowan, zeby tabliczki nie wchodzily pod nia
  if (panel.element.hidden) {
    const list = document.querySelector<HTMLElement>(".notowania");
    // ?szlif ustawia kamere sam (modele z pieciu stron) — przesuniecie zsuwaloby kadr
    const narrow = window.innerWidth < 1200 && window.innerWidth > 720 && !szlifMode;
    // o polowe: cala lista zepchnelaby prawa krawedz makiety poza ekran
    director.setInset(narrow && list ? (list.offsetLeft + list.offsetWidth) / 2 : 0, 0, 0);
    return;
  }
  // offsetLeft/Top to miejsce z ukladu strony, bez transformacji: animacja wjazdu ich nie przesuwa
  // (getBoundingClientRect zmierzylby panel w polowie drogi i obraz zostalby przesuniety za malo)
  const { offsetLeft: left, offsetTop: top } = panel.element;
  const bottomSheet = left < 1;
  // na komputerze z lewej stoi lista notowan — budynek ma wyladowac miedzy nia a panelem
  const list = document.querySelector<HTMLElement>(".notowania");
  const listEdge = !bottomSheet && list ? list.offsetLeft + list.offsetWidth : 0;
  director.setInset(listEdge, bottomSheet ? 0 : window.innerWidth - left, bottomSheet ? window.innerHeight - top : 0);
};
new ResizeObserver(fitInset).observe(panel.element);
window.addEventListener("resize", fitInset);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panel.ticker) select(null);
});

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  latest = e.data.snapshot;
  receivedAt = performance.now();
  document.body.dataset.dzien = String(latest.day);
  quotes.update(latest, panel.ticker);
  newsBar.update(latest);
  panel.update(latest);
};

// symulacja rusza od razu, rownolegle z pobieraniem makiety — klikniete w tym czasie tempo nie ginie
send({ type: "start", seed, speed, ...(parkiet ? { parkiet } : {}) });

const loading = document.getElementById("ladowanie");
const loadingText = loading?.querySelector(".ladowanie-tekst");
const bar = loading?.querySelector<HTMLElement>(".ladowanie-pasek");
const model = await loadModel(import.meta.env.BASE_URL, (fraction) => {
  if (!bar || !loadingText) return;
  // bez rozmiaru od serwera pasek tylko sie przesuwa (stan nieokreslony), bez procentow
  bar.toggleAttribute("data-nieokreslony", fraction === null);
  if (fraction === null) return;
  const pct = Math.round(fraction * 100);
  bar.style.setProperty("--postep", String(fraction));
  bar.setAttribute("aria-valuenow", String(pct));
  loadingText.textContent = `Wczytywanie makiety… ${String(pct)}%`;
}).catch((error: unknown) => {
  loading?.setAttribute("data-blad", "");
  if (loadingText) loadingText.textContent = `Nie udało się wczytać makiety (${error instanceof Error ? error.message : String(error)}). Odśwież stronę.`;
  throw error;
});
stage.scene.add(model.root, createGroundShadow(model.root));
const trucks = createTrucks(model, stage.scene);
const props = createProps(model, stage.scene);
const tickers = createTickers(model, stage.scene);
const pickets = createPickets(model, stage.scene);
const walkers = createWalkers(model, stage.scene);
const rain = createRain(stage.scene);
director.useModel(model);
installSzlifHook(stage, model);
// przelot powitalny: makieta obraca sie do widza; nie, gdy adres ustawia kamere albo spolke,
// ani przy ?szlif — petla szlifu sama ustawia kamere, a przelot by ja nadpisywal
const szlif = new URLSearchParams(location.search).has("szlif");
if (!view && !company && !szlif && !matchMedia("(prefers-reduced-motion: reduce)").matches) director.intro();
hoverTicker = (t) => {
  tickers.highlight(t);
  quotes.highlight(t);
};
onPick(
  canvas,
  createPicker(model, stage.camera, canvas, tickers.signs),
  (t) => {
    // klik w puste miejsce makiety zamyka panel
    select(t, canvas);
  },
  hoverTicker,
);
if (company) select(company);
const chimneys = [
  { smoke: createSmoke(stage.scene, model.anchor("STW_dym_1"), stage.renderer.getPixelRatio()), rate: (s: Snapshot) => s.companies.STW.output },
  { smoke: createSmoke(stage.scene, model.anchor("STW_dym_2"), stage.renderer.getPixelRatio()), rate: (s: Snapshot) => s.companies.STW.output },
  { smoke: createSmoke(stage.scene, model.anchor("MTK_dym"), stage.renderer.getPixelRatio()), rate: (s: Snapshot) => s.companies.MTK.output },
];
// panele interfejsu nad makieta: tabliczki kursow pod nimi gasna
// czytane najwyzej co 100 ms: odczyt ukladu w kazdej klatce kosztuje, a panele ruszaja sie rzadko
let overlayRects: DOMRect[] = [];
let overlaysAt = -Infinity;
const overlays = (now: number) => {
  if (now - overlaysAt >= 100) {
    overlaysAt = now;
    overlayRects = [...document.querySelectorAll(".hud, .notowania, .wiadomosci, .panel:not([hidden])")].map((e) => e.getBoundingClientRect());
  }
  return overlayRects;
};
let previous = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  const snap = latest;
  if (snap) {
    const time = extrapolate(snap.time, snap.ticksPerMs, now - receivedAt, snap.stepsPerDay);
    const fraction = dayFraction(time, snap.stepsPerDay);
    const hour = fixedHour ?? hourOf(fraction);
    const light = daylight(hour);
    const storm = snap.incidents.some((i) => i.kind === "SZTORM");
    // animacje zakladow ida w tempie symulacji: w pauzie dym stoi, przy 16× kleby leca szybciej
    // czas symulacji stoi w pauzie i gdy worker czeka na Parkiet (ticksPerMs = 0) — maszyny tez
    const simDt = snap.ticksPerMs > 0 ? dt * snap.speed : 0;
    sky.update(light, storm);
    trucks.update(snap, fraction);
    props.update(snap, fraction, light, storm, simDt, now);
    tickers.update(snap, dt, stage.camera, { width: canvas.clientWidth, height: canvas.clientHeight }, overlays(now));
    pickets.update(snap, now);
    walkers.update(snap, light, storm, dt);
    rain.update(storm, dt);
    for (const c of chimneys) c.smoke.update(c.rate(snap), simDt, light.day);
    hud.update(snap, hour);
  }
  director.update(now);
  stage.render();
}
// shadery kompiluja sie jeszcze pod ekranem ladowania, a nie w pierwszej klatce makiety: ze
// swiatlem tej pory dnia (w nocy slonce jest wylaczone, a liczba swiatel zmienia shadery)
// i ze schowanymi obiektami (przechodnie w kurtkach, ciezarowki, pikiety) — compileAsync
// pomija niewidoczne
const firstHour = fixedHour ?? (latest ? hourOf(dayFraction(latest.time, latest.stepsPerDay)) : hourOf(0));
sky.update(daylight(firstHour), false);
const hidden: { visible: boolean }[] = [];
stage.scene.traverse((o) => {
  if (o.visible) return;
  hidden.push(o);
  o.visible = true;
});
await stage.renderer.compileAsync(stage.scene, stage.camera);
for (const o of hidden) o.visible = false;
requestAnimationFrame(frame);

loading?.classList.add("gotowe");
document.body.dataset.gotowe = "1";
