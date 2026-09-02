import { expect, test, type Page } from "@playwright/test";

/**
 * Шторка заявки: жест.
 *
 * Проверка написана по живому багу, который глазами выглядел как «кривая
 * анимация»: высоту шторки пересчитывал ResizeObserver, повешенный на её же
 * части, а тело меняет высоту на каждый кадр жеста. Наблюдатель возвращал
 * шторку в её положение прямо под пальцем — тянуть её было невозможно,
 * двигалась она только тапами по ручке. Симптом молчаливый: ошибок нет,
 * тесты на раскладку зелёные, ломается только ощущение.
 *
 * Поэтому здесь меряется середина жеста, а не результат.
 */

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function open(page: Page) {
  await page.route("**/telegram-web-app.js", (route) => route.abort());
  await page.route("**/api/topics/**", (route) =>
    route.fulfill({
      json: {
        rows: ["physics", "geometry", "docs"].map((key, i) => ({
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
  await page.goto("/");
  await expect(page.locator(".sheet")).toBeVisible();
  // Шрифт подхватывается после первого кадра и меняет высоту подписей — до
  // этого замеры шторки говорят о раскладке, которой уже не будет.
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

const height = (page: Page) =>
  page.evaluate(() =>
    Math.round(document.querySelector(".sheet")!.getBoundingClientRect().height),
  );

/**
 * Высота, когда шторка перестала её уточнять.
 *
 * Замер идёт в два захода: сначала по первому кадру, потом по подхваченному
 * шрифту — подпись под кнопкой переезжает на вторую строку, шапка становится
 * выше, и положения пересчитываются. Без ожидания тест ловит промежуточное
 * значение и сравнивает с ним же после жеста.
 */
async function settled(page: Page): Promise<number> {
  let last = -1;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const now = await height(page);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(120);
  }
  return last;
}

const fullHeight = (page: Page) => page.evaluate(() => window.innerHeight - 56);

/** Точка на шапке шторки — за неё её и тянут. */
const headGrip = (page: Page) =>
  page.evaluate(
    () => document.querySelector(".sheet-head")!.getBoundingClientRect().top + 16,
  );

test.describe("жест шторки", () => {
  test("медленное движение за верх ведёт шторку за пальцем", async ({ page }) => {
    await open(page);
    const start = await settled(page);
    const y = await headGrip(page);

    await page.mouse.move(195, y);
    await page.mouse.down();

    // Медленно: 10 пикселей за 30 мс — это установка на нужную высоту, а не
    // бросок (порог броска 0.5 px/ms). Меряем в середине жеста, до отпускания.
    const seen: number[] = [];
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(195, y - step * 10);
      await page.waitForTimeout(30);
      seen.push(await height(page));
    }

    expect(seen[0]).toBeGreaterThan(start);
    // Каждый следующий замер не ниже предыдущего: шторка не отпрыгивает назад.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBeGreaterThan(start + 200);

    await page.mouse.up();
    // Отпустили за серединой между средним и верхним — магнитится к верхнему.
    await expect.poll(() => height(page)).toBe(await fullHeight(page));
  });

  test("смахивание вниз сворачивает шторку и открывает список под колодой", async ({
    page,
  }) => {
    await open(page);
    const start = await settled(page);
    const y = await headGrip(page);

    await page.mouse.move(195, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(195, y + step * 18);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();

    await expect.poll(async () => (await height(page)) < start).toBe(true);
    // В нижнем положении под шторкой видно готовое по теме — ради этого её и
    // сворачивают.
    await expect(page.locator(".rows .row").first()).toBeInViewport();
  });

  test("тап по ручке переключает между нижним и средним положением", async ({
    page,
  }) => {
    await open(page);
    const half = await settled(page);

    await page.locator(".sheet-grab").click();
    await expect.poll(async () => (await height(page)) < half).toBe(true);

    await page.locator(".sheet-grab").click();
    await expect.poll(() => height(page)).toBe(half);
  });
});
