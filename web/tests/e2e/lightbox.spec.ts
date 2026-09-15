import { expect, test, type Page } from "@playwright/test";

/**
 * Картинка заявки крупно: тап по миниатюре раскрывает снимок поверх шторки,
 * тап в любое место закрывает. Загрузка на сервер подменена — снимок в слоте
 * появляется из локального object URL, серверу тут делать нечего.
 */

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// 40×30 PNG, чтобы у снимка была не единичная пропорция.
const PNG_4x3 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsMlBE4qRhQw4mvRvputExGKxWCwWi8VisVj8N16ZMgs77CzDpgAAAABJRU5ErkJggg==",
  "base64",
);

async function openWithPhoto(page: Page) {
  await page.route("**/telegram-web-app.js", (route) => route.abort());
  await page.route("**/api/topics/**", (route) =>
    route.fulfill({
      json: {
        rows: ["physics"].map((key, i) => ({
          key,
          title: `Тема ${key}`,
          hint: "Подсказка",
          eta: "2 – 3 дня",
          image_front: PIXEL,
          image_back: PIXEL,
          sort_order: i,
        })),
      },
    }),
  );
  await page.route("**/api/uploads/**", (route) => route.fulfill({ json: { guid: "test-guid" } }));
  await page.addInitScript(() => {
    localStorage.setItem("comp-design-bot:session-token", "test.token");
  });
  await page.goto("/");
  await expect(page.locator(".sheet")).toBeVisible();
  await page.locator(".sheet-grab").click();
  await page.locator("input[type=file]").setInputFiles({
    name: "ref.png",
    mimeType: "image/png",
    buffer: PNG_4x3,
  });
  await expect(page.locator(".slot-view img")).toBeVisible();
}

test.describe("картинка крупно", () => {
  test("раскрывается из миниатюры и закрывается тапом в любое место", async ({ page }) => {
    await openWithPhoto(page);
    await page.locator(".slot-view").click();
    const box = page.locator(".lightbox");
    await expect(box).toBeVisible();
    await expect(box).toHaveClass(/lightbox-open/);
    // Снимок крупнее миниатюры и не выходит за экран.
    const img = page.locator(".lightbox-img");
    await expect
      .poll(async () => (await img.boundingBox())?.width ?? 0)
      .toBeGreaterThan(200);
    const rect = (await img.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);

    // Тап где угодно — в угол экрана, не по снимку.
    await page.mouse.click(5, 5);
    await expect(box).toHaveCount(0);
    // Слот на месте, снимок из заявки не пропал.
    await expect(page.locator(".slot-view img")).toBeVisible();
  });
});
