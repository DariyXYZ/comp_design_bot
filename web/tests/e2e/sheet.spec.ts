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
  let stable = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await height(page);
    // Три одинаковых замера подряд, а не два: высота меняется дважды — по
    // первому кадру и по подхваченному шрифту, — и между этими правками легко
    // застать пару одинаковых значений.
    stable = now === last ? stable + 1 : 0;
    if (stable >= 2) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

/** Среднее положение: ровно половина экрана. */
const halfHeight = (page: Page) =>
  page.evaluate(() => Math.round(window.innerHeight * 0.5));

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
    // Отпустили рядом со средним положением — магнитится ровно к половине
    // экрана, а не остаётся там, где отпустили.
    await expect.poll(() => height(page)).toBe(await halfHeight(page));
  });

  test("смахивание вниз возвращает шторку в сложенный вид", async ({ page }) => {
    await open(page);
    const peek = await settled(page);

    // Сначала поднимаем: сворачивать из сложенного нечего.
    await page.locator(".sheet-grab").click();
    await expect.poll(() => height(page)).toBe(await halfHeight(page));

    const y = await headGrip(page);
    await page.mouse.move(195, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(195, y + step * 18);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();

    await expect.poll(() => height(page)).toBe(peek);
    // В сложенном виде под шторкой видно готовое по теме — ради этого она и
    // стоит внизу по умолчанию.
    await expect(page.locator(".rows .row").first()).toBeInViewport();
  });

  test("карточка не меняет размер, когда шторку поднимают", async ({ page }) => {
    // Замечание глазами: «открываю шторку на половину — карточка чуть
    // уменьшается, выглядит как баг». Так и было: подпись над кнопкой
    // появляется вместе с открытием шторки, попадала в замер сложенной высоты,
    // а от неё считается место под колоду.
    await open(page);
    await settled(page);
    const cardWidth = () =>
      page.evaluate(() =>
        Math.round(document.querySelector(".deck")!.getBoundingClientRect().width),
      );

    const collapsed = await cardWidth();
    expect(collapsed).toBeGreaterThan(0);

    await page.locator(".sheet-grab").click();
    await expect.poll(() => height(page)).toBe(await halfHeight(page));
    expect(await cardWidth()).toBe(collapsed);

    // И на всю высоту тоже: карточку она закрывает, но не пересчитывает.
    await page
      .getByPlaceholder("Что нужно сделать и что хотите получить на выходе")
      .click();
    await page.waitForTimeout(400);
    expect(await cardWidth()).toBe(collapsed);

    await page.locator(".sheet-grab").click();
    await page.waitForTimeout(400);
    expect(await cardWidth()).toBe(collapsed);
  });

  test("тап по ручке переключает между сложенным и средним положением", async ({
    page,
  }) => {
    await open(page);
    const peek = await settled(page);

    await page.locator(".sheet-grab").click();
    await expect.poll(() => height(page)).toBe(await halfHeight(page));

    await page.locator(".sheet-grab").click();
    await expect.poll(() => height(page)).toBe(peek);
  });
});
