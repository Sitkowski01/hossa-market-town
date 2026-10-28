import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { openTown } from "./helpers.js";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** Naruszenia axe (WCAG 2.1 A/AA) o wadze serious albo critical, jako "regula: element". */
async function violations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
  });
}

test("makieta i panel spolki bez powaznych naruszen dostepnosci", async ({ page }) => {
  await openTown(page, "seed=42&godzina=12&tempo=1");
  expect(await violations(page)).toEqual([]);
  await page.getByTestId("notowanie-RUD").click();
  await expect(page.getByTestId("panel-cena")).toHaveText(/zł$/);
  expect(await violations(page)).toEqual([]);
});
