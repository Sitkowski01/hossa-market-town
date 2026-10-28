import type { Ticker } from "@hossa/economy";
import * as THREE from "three";
import type { Snapshot } from "../sim/protocol.js";
import { TICKERS } from "../world/companies.js";
import { FONT } from "../fonts.js";
import { change, price, trend } from "../world/format.js";
import { covered, fade, type Rect } from "../world/overlap.js";
import { BLOOM_THRESHOLD } from "./stage.js";
import type { Model } from "./model.js";

const UP = "#2fbf71";
const DOWN = "#e5484d";
const FLAT = "#93a4bb";
const SIGN_PX = 130;

export interface Tickers {
  /** Tabliczki nad spolkami — klikalne jak budynki (userData.ticker). */
  readonly signs: readonly THREE.Sprite[];
  /** `panels` to prostokaty interfejsu na ekranie — tabliczka, ktora by pod nie weszla, gasnie. */
  update(snapshot: Snapshot, dt: number, camera: THREE.PerspectiveCamera, viewport: { width: number; height: number }, panels: readonly Rect[]): void;
  /** Tabliczka spolki pod kursorem (na makiecie albo w notowaniach) rosnie i wychodzi na wierzch. */
  highlight(ticker: Ticker | null): void;
}

// ten sam prog co w notowaniach i panelu: "+0,03%" jest zielone wszedzie, nie tylko w liscie
const TONES = { wzrost: UP, spadek: DOWN, "": FLAT } as const;
const tone = (pct: number): string => TONES[trend(pct)];

/**
 * Notowania na makiecie: tabliczka z kursem nad kazda spolka (zawsze widoczna, zielona albo
 * czerwona wzgledem otwarcia) i pas LED na fasadzie gieldy, po ktorym przewijaja sie kursy.
 * Tekst rysowany na canvasie i odswiezany tylko wtedy, gdy zmieni sie cena.
 */
export function createTickers(model: Model, scene: THREE.Scene): Tickers {
  const signs = TICKERS.map((t) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // stala wielkosc na ekranie: tabliczka ma byc czytelna z kazdej odleglosci
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false, sizeAttenuation: false }));
    sprite.renderOrder = 10;
    sprite.userData = { ticker: t };
    sprite.position.copy(model.anchor(`${t}_kurs`)).add(new THREE.Vector3(0, 4, 0));
    scene.add(sprite);
    return { ticker: t, sprite, canvas, texture, text: "", grow: 1 };
  });

  const led = model.node("GIELDA_led") as THREE.Mesh;
  const ledCanvas = document.createElement("canvas");
  ledCanvas.width = 2048;
  ledCanvas.height = 64;
  const ledTexture = new THREE.CanvasTexture(ledCanvas);
  ledTexture.colorSpace = THREE.SRGBColorSpace;
  ledTexture.wrapS = THREE.RepeatWrapping;
  ledTexture.flipY = false; // UV z glTF maja poczatek u gory, canvas tez — bez odwracania
  led.material = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ledTexture, emissiveIntensity: BLOOM_THRESHOLD * 0.9 });
  let ledText = "";
  let hovered: Ticker | null = null;
  // tabliczki narysowane przed wczytaniem kroju maja czcionke zastepcza — po wczytaniu od nowa.
  // Sam canvas nie zamawia kroju, a document.fonts.ready bywa juz spelnione, wiec zamawiamy jawnie
  // (w pauzie ceny sie nie zmieniaja i tabliczki zostalyby z zastepcza na zawsze)
  void Promise.all([document.fonts.load(`600 30px ${FONT}`), document.fonts.load(`700 30px ${FONT}`)]).then(() => {
    for (const s of signs) s.text = "";
  });

  return {
    signs: signs.map((s) => s.sprite),
    highlight(ticker) {
      hovered = ticker;
    },
    update(snapshot, dt, camera, viewport, panels) {
      // sprite bez perspektywy ma wielkosc w jednostkach wysokosci ekranu, podzielona przez
      // tan(fov/2); liczymy ja z szerokosci w pikselach, zeby tabliczka byla tak samo czytelna
      // na monitorze i na telefonie (najwyzej 24% szerokosci ekranu)
      const px = Math.min(SIGN_PX, viewport.width * 0.24);
      const size = ((2 * px) / viewport.height) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const at = new THREE.Vector3();
      for (const s of signs) {
        // wyroznienie rosnie i maleje plynnie (ok. 0,15 s), wyrozniona tabliczka jest nad innymi
        s.grow += ((s.ticker === hovered ? 1.18 : 1) - s.grow) * Math.min(1, dt * 14);
        s.sprite.renderOrder = s.ticker === hovered ? 11 : 10;
        s.sprite.scale.set(size * s.grow, size * 0.375 * s.grow, 1);
        // gdzie tabliczka jest na ekranie: srodek z rzutu kamery, wymiary jak w skali wyzej
        at.copy(s.sprite.position).project(camera);
        const x = ((at.x + 1) / 2) * viewport.width;
        const y = ((1 - at.y) / 2) * viewport.height;
        const rect = { left: x - px / 2, right: x + px / 2, top: y - px * 0.1875, bottom: y + px * 0.1875 };
        // uciete krawedzia ekranu tez gasna — polowa tabliczki to polowa ceny
        const offScreen = rect.left < 0 || rect.top < 0 || rect.right > viewport.width || rect.bottom > viewport.height;
        const hidden = at.z > 1 || offScreen || covered(rect, panels);
        const material = s.sprite.material;
        material.opacity = fade(material.opacity, hidden ? 0 : 1, dt);
        // niewidoczna tabliczka nie przechwytuje klikniec przeznaczonych dla panelu
        s.sprite.visible = material.opacity > 0.01;
        const c = snapshot.companies[s.ticker];
        const pct = c.price / c.open - 1;
        const text = `${s.ticker}|${price(c.price)}|${change(pct)}`;
        if (text === s.text) continue;
        s.text = text;
        const g = s.canvas.getContext("2d") as CanvasRenderingContext2D;
        g.clearRect(0, 0, 256, 96);
        g.fillStyle = "rgba(11, 18, 32, 0.86)";
        g.beginPath();
        g.roundRect(4, 4, 248, 88, 14);
        g.fill();
        g.fillStyle = tone(pct);
        g.fillRect(4, 80, 248, 12);
        g.font = `600 30px ${FONT}`;
        g.fillStyle = "#e6edf6";
        g.fillText(s.ticker, 18, 40);
        g.fillStyle = tone(pct);
        g.textAlign = "right";
        g.fillText(change(pct), 238, 40);
        g.textAlign = "left";
        g.font = `700 30px ${FONT}`;
        g.fillStyle = "#e6edf6";
        g.fillText(price(c.price), 18, 72);
        s.texture.needsUpdate = true;
      }

      const line = TICKERS.map((t) => `${t} ${price(snapshot.companies[t].price)}`).join("   ·   ");
      if (line !== ledText) {
        ledText = line;
        const g = ledCanvas.getContext("2d") as CanvasRenderingContext2D;
        g.fillStyle = "#000";
        g.fillRect(0, 0, 2048, 64);
        g.textBaseline = "middle";
        // bez Consolas (Linux, macOS) czcionka zastepcza jest szersza — dopasuj, zeby ostatni kurs sie zmiescil
        const labels = TICKERS.map((t) => `${t} ${price(snapshot.companies[t].price)}   `);
        g.font = "700 40px Consolas, monospace";
        const width = g.measureText(labels.join("")).width;
        g.font = `700 ${String(Math.floor(40 * Math.min(1, 2008 / width)))}px Consolas, monospace`;
        let x = 20;
        for (const [i, t] of TICKERS.entries()) {
          const c = snapshot.companies[t];
          g.fillStyle = tone(c.price / c.open - 1);
          const label = labels[i] ?? "";
          g.fillText(label, x, 34);
          x += g.measureText(label).width;
        }
        ledTexture.needsUpdate = true;
      }
      ledTexture.offset.x = (ledTexture.offset.x + dt * 0.04) % 1;
    },
  };
}
