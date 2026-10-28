import type { Ticker } from "@hossa/economy";
import { Session, type Command } from "@hossa/market";
import { SimClock } from "./clock.js";
import { ParkietMirror } from "./parkiet.js";
import { ParkietFeed, withParkiet } from "./parkiet-feed.js";
import type { FromWorker, ToWorker } from "./protocol.js";
import { Observer } from "./view.js";

/**
 * Web Worker: gielda i gospodarka licza sie tu, poza watkiem rysowania, wiec scena nie
 * przycina sie, gdy boty skladaja zlecenia. Co 100 ms zegar idzie naprzod, sesja nadrabia
 * zalegle kroki, a scena dostaje migawke.
 */
const SNAPSHOT_EVERY_MS = 100;
const RECONNECT_MS = 2000;

const port = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
};

let running: { session: Session; clock: SimClock; observer: Observer } | undefined;
let last = 0;
/** Spolka otwarta w panelu — tylko dla niej worker liczy arkusz, swiece i fundamenty. */
let focus: Ticker | null = null;
/** Tryb polaczony: zlecenia ida tez do Parkietu, a notowania wracaja z jego strumienia. */
let parkiet: { mirror: ParkietMirror; feed: ParkietFeed; streaming: boolean } | undefined;

function connect(base: string, seed: number): ParkietMirror {
  // tag z czasem: ponowne otwarcie strony z tym samym ziarnem nie powtorzy clientOrderId
  const mirror = new ParkietMirror(base, `h${String(seed)}-${Date.now().toString(36)}`);
  const link = { mirror, feed: new ParkietFeed(), streaming: false };
  const url = ParkietFeed.url(new URL(base, self.location.href).href);
  // strumien wraca sam po zerwaniu; do tego czasu scena pokazuje kursy z przegladarki
  const open = () => {
    const socket = new WebSocket(url);
    socket.onopen = () => {
      link.streaming = true;
    };
    socket.onclose = () => {
      link.streaming = false;
      setTimeout(open, RECONNECT_MS);
    };
    socket.onmessage = (e: MessageEvent<string>) => {
      link.feed.handle(e.data);
    };
  };
  open();
  parkiet = link;
  return mirror;
}

function loop(): void {
  if (!running) return;
  const { session, clock, observer } = running;
  const now = performance.now();
  // Parkiet nie nadaza: czas stoi, az kolejki zlecen sie skurcza (scena tez nie ekstrapoluje)
  const waiting = parkiet?.mirror.busy() ?? false;
  clock.advance(waiting ? 0 : now - last);
  last = now;
  while (session.step < clock.stepsDue) session.tick();
  const local = observer.snapshot(session, clock, focus);
  const snapshot = waiting ? { ...local, ticksPerMs: 0 } : local;
  port.postMessage({ type: "snapshot", snapshot: parkiet ? withParkiet(snapshot, parkiet.feed, { ...parkiet.mirror.stats(), streaming: parkiet.streaming, waiting }) : snapshot });
}

port.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "start" && !running) {
    const mirror = msg.parkiet === undefined ? undefined : connect(msg.parkiet, msg.seed);
    const session = new Session({
      seed: msg.seed,
      ...(mirror
        ? {
            onCommand: (c: Command) => {
              mirror.push(c);
            },
          }
        : {}),
    });
    running = { session, clock: new SimClock(session.stepsPerDay, msg.speed), observer: new Observer(msg.seed) };
    last = performance.now();
    loop();
    setInterval(loop, SNAPSHOT_EVERY_MS);
  } else if (msg.type === "speed" && running) {
    loop(); // czas do tej chwili liczy sie jeszcze w starym tempie
    running.clock.speed = msg.speed;
    loop(); // scena od razu dostaje nowe tempo, inaczej przez 100 ms ekstrapolowalaby po staremu
  } else if (msg.type === "focus") {
    focus = msg.ticker;
    loop(); // panel nie czeka 100 ms na pierwsze dane
  }
};
