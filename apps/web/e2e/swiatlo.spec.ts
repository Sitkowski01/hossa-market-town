import { expect, test, type Page } from "@playwright/test";
import { openTown } from "./helpers.js";

/**
 * Udzial przepalonych pikseli (wszystkie kanaly >= 250) i srednia jasnosc samej makiety (0..255).
 * Canvas jest przezroczysty, a pod nim lezy grafitowe tlo strony — piksele tla (blisko #030712)
 * nie wchodza do sredniej, inaczej mierzylibysmy, ile ekranu zajmuje makieta, a nie jej swiatlo.
 */
async function exposure(page: Page): Promise<{ blown: number; mean: number }> {
  const png = (await page.locator("#scena").screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let blown = 0;
    let sum = 0;
    let model = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, gr, b] = [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0];
      if (r >= 250 && gr >= 250 && b >= 250) blown += 1;
      if (Math.abs(r - 3) + Math.abs(gr - 7) + Math.abs(b - 18) < 36) continue; // tlo strony z siatka i poswiata
      sum += 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      model += 1;
    }
    return { blown: blown / (px.length / 4), mean: sum / Math.max(1, model) };
  }, png);
}

// Poprzednia makieta (lotnisko) byla przepalona; tu pilnuje tego test na zrzucie.
test("w poludnie nic sie nie przepala, a obraz nie jest szary", async ({ page }) => {
  await openTown(page, "seed=42&godzina=12&tempo=0");
  await page.waitForTimeout(1500);
  const { blown, mean } = await exposure(page);
  expect(blown).toBeLessThan(0.02);
  expect(mean).toBeGreaterThan(70);
  expect(mean).toBeLessThan(200);
});

test("w nocy makieta jest ciemna, ale widoczna", async ({ page }) => {
  await openTown(page, "seed=42&godzina=1&tempo=0");
  await page.waitForTimeout(1500);
  const { blown, mean } = await exposure(page);
  expect(blown).toBeLessThan(0.02);
  expect(mean).toBeGreaterThan(8);
  expect(mean).toBeLessThan(60);
});
