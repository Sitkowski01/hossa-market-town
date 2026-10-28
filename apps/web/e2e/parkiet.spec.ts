import process from "node:process";
import { expect, test } from "@playwright/test";
import { collectErrors, openTown } from "./helpers.js";

// Tryb polaczony z prawdziwym Parkietem (gielda w Javie z obrazu ghcr.io, parkiet/compose.yaml).
// Wymaga swiezego kontenera: arkusze musza byc puste, wiec bez ponawiania i tylko z PARKIET_E2E=1.
test.skip(!process.env.PARKIET_E2E, "Parkiet nie wystartowany (docker compose -f parkiet/compose.yaml up -d, potem PARKIET_E2E=1)");
test.describe.configure({ retries: 0 });

const matched = async (text: Promise<string | null>) => Number((/✓ ([\d ]+) zgodnych/.exec((await text) ?? "")?.[1] ?? "0").replace(/ /g, ""));

test("zlecenia botow ida do Parkietu, kazda odpowiedz zgadza sie z silnikiem w przegladarce, a panel pokazuje arkusz z gieldy", async ({ page }) => {
  const errors = collectErrors(page);
  await openTown(page, "seed=79&parkiet&tempo=4&spolka=RUD");
  const badge = page.getByTestId("parkiet");
  await expect(badge).toHaveAttribute("data-stan", /ok|czeka/);
  await expect.poll(() => matched(badge.textContent()), { timeout: 60_000 }).toBeGreaterThan(500);
  await expect(badge).not.toContainText("różnice");

  // pauza: kolejki sie oprozniaja, strumien przynosi ostatni obraz arkusza i panel ma te same
  // najlepsze oferty, co arkusz Parkietu pobrany przez REST
  await page.getByRole("button", { name: "Pauza" }).click();
  const zl = (price: string | undefined) => `${(price ?? "?").replace(".", ",")} zł`;
  const panel = page.getByRole("complementary", { name: /Kopalnia Rudawa/ });
  const bestBid = panel.getByRole("list", { name: "Oferty kupna" }).getByRole("listitem").first();
  const bestAsk = panel.getByRole("list", { name: "Oferty sprzedaży" }).getByRole("listitem").last();
  await expect
    .poll(
      async () => {
        const book = (await (await page.request.get("/parkiet/api/instruments/RUD/book")).json()) as { bids: { price: string }[]; asks: { price: string }[] };
        return [(await bestBid.textContent())?.includes(zl(book.bids[0]?.price)), (await bestAsk.textContent())?.includes(zl(book.asks[0]?.price))];
      },
      { timeout: 30_000 },
    )
    .toEqual([true, true]);
  await expect(page.getByTestId("tasma").locator("li[data-strona]").first()).toBeVisible();
  expect(errors).toEqual([]);
});
