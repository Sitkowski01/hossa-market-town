import type { Bar } from "../sim/protocol.js";
import { labelledGrid, layoutChart } from "../world/chart.js";
import { price } from "../world/format.js";

const COLORS = { up: "#2fbf71", down: "#e5484d", grid: "rgb(147 164 187 / 14%)", label: "#93a4bb", fair: "#e0b44c", last: "#e6edf6" };
/** Pas po prawej na ceny siatki. */
const AXIS = 58;

/**
 * Wykres swiecowy na canvasie: swiece krokow gieldy, granice dni, siatka cen, przerywana linia
 * wartosci godziwej (do niej ciagna gracze fundamentalni) i etykieta ostatniej ceny.
 * Rysuje w pikselach urzadzenia, zeby na telefonie z gesta matryca linie byly ostre.
 */
export function drawChart(canvas: HTMLCanvasElement, bars: readonly Bar[], fair: number, last: number, slots: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  // canvas programowy, nie przyspieszany: maly wykres rysuje sie 10 razy na sekunde, a na GPU
  // kazde rysowanie czekaloby w kolejce za klatka sceny WebGL (bez karty — nawet sekundami)
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);

  const plot = { width: width - AXIS, height: height - 16 };
  const l = layoutChart(bars, fair, plot, slots);
  g.font = "11px 'Segoe UI', system-ui, sans-serif";
  g.textBaseline = "middle";

  const fy = Math.round(l.y(fair)) + 0.5;
  const ly = l.y(last);
  // wartosc godziwa ustepuje ostatniej cenie, gdy plakietki by na siebie zachodzily
  const showFair = Math.abs(fy - ly) > 18;
  g.fillStyle = COLORS.grid;
  for (const line of l.grid) g.fillRect(0, Math.round(line.y), plot.width, 1);
  g.fillStyle = COLORS.label;
  for (const line of labelledGrid(l.grid, plot.height, showFair ? [ly, fy] : [ly])) {
    g.fillText(price(line.price).replace(" zł", ""), plot.width + 8, line.y);
  }
  for (const d of l.dayLines) {
    g.fillStyle = COLORS.grid;
    g.fillRect(Math.round(d.x), 0, 1, plot.height);
    g.fillStyle = COLORS.label;
    g.fillText(`dz. ${String(d.day)}`, d.x + 4, plot.height + 9);
  }

  for (const c of l.candles) {
    g.fillStyle = c.up ? COLORS.up : COLORS.down;
    g.fillRect(Math.round(c.x - 0.5), c.wickTop, 1, Math.max(1, c.wickBottom - c.wickTop));
    g.fillRect(Math.round(c.x - l.candleWidth / 2), c.bodyTop, l.candleWidth, c.bodyHeight);
  }

  g.strokeStyle = COLORS.fair;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(0, fy);
  g.lineTo(plot.width, fy);
  g.stroke();
  g.setLineDash([]);

  // ostatnia cena jako plakietka na osi
  const tag = (y: number, text: string, bg: string, fg: string) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(plot.width + 2, y - 9, AXIS - 4, 18, 4);
    g.fill();
    g.fillStyle = fg;
    g.fillText(text, plot.width + 7, y);
  };
  if (showFair) tag(fy, price(fair).replace(" zł", ""), COLORS.fair, "#0b1220");
  const lastBar = bars.at(-1);
  tag(ly, price(last).replace(" zł", ""), lastBar && lastBar.close < lastBar.open ? COLORS.down : COLORS.up, "#0b1220");
}
