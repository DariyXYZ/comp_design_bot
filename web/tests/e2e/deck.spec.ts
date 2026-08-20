import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозные проверки колоды: жесты, навигация и отправка выбора боту.
 *
 * Supabase и SDK Telegram подменяются — тесты проверяют наш код, а не доступность
 * внешних сервисов, и не зависят от содержимого живой таблицы `cases`.
 */

/** Прозрачный 1×1 GIF — картинки карточек не должны ходить в сеть. */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const TOTAL = 8;

/** Приложение живёт под basePath — открываем путь явно, а не как "/". */
const APP_PATH = "/comp_design_bot/";

const CASES = Array.from({ length: TOTAL }, (_, i) => ({
  key: `case-${i}`,
  title: `Кейс ${i}`,
  hint: `Подсказка ${i}`,
  eta: "2 – 3 дня",
  image_front: PIXEL,
  // У первого кейса обратной картинки нет — заодно проверим плейсхолдер.
  image_back: i === 0 ? null : PIXEL,
  sort_order: i,
}));

async function open(page: Page, { casesFail = false } = {}) {
  // Настоящий SDK не грузим: он бы перезаписал заглушку и потянул сеть.
  await page.route("**/telegram-web-app.js", (route) => route.abort());

  await page.addInitScript(() => {
    const sent: string[] = [];
    (window as unknown as { __sent: string[] }).__sent = sent;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        sendData(data: string) {
          sent.push(data);
        },
      },
    };
  });

  await page.route("**/rest/v1/cases**", (route) =>
    casesFail
      ? route.fulfill({ status: 401, contentType: "application/json", body: "[]" })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(CASES),
        }),
  );

  await page.goto(APP_PATH);

  // Ждём готовности до первого действия. `page.keyboard`/`mouse` не умеют
  // автоожидание, как `expect`, — без этой синхронизации жест мог прийти
  // раньше, чем эффект навесил слушатели, и тест падал бы через раз.
  if (casesFail) {
    await expect(page.locator(".deck-error")).toBeVisible();
  } else {
    await expect(page.locator(".deck .swipe-card")).toHaveCount(3);
  }
}

const topCard = (page: Page) => page.locator(".deck .swipe-card").last();

async function centerOf(page: Page) {
  const box = await topCard(page).boundingBox();
  if (!box) throw new Error("Карточка не отрисована");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function swipe(page: Page, dx: number) {
  const { x, y } = await centerOf(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function tap(page: Page) {
  const { x, y } = await centerOf(page);
  await page.mouse.click(x, y);
}

test.describe("колода кейсов", () => {
  test("показывает стопку, точки и счётчик", async ({ page }) => {
    await open(page);

    await expect(page.locator(".deck .swipe-card")).toHaveCount(3);
    await expect(page.locator(".dots i")).toHaveCount(TOTAL);
    await expect(topCard(page).locator("h3")).toHaveText("Кейс 0");
    await expect(topCard(page).locator(".num")).toHaveText("01 / 08");
    await expect(topCard(page).locator(".eta")).toHaveText("⏱ 2 – 3 дня");
    // Первая точка активна.
    await expect(page.locator(".dots i").first()).toHaveClass("on");
  });

  test("у кейса без примера показывает плейсхолдер вместо битой картинки", async ({
    page,
  }) => {
    await open(page);
    await expect(topCard(page).locator(".back-placeholder")).toHaveCount(1);
    await expect(topCard(page).locator(".back-photo")).toHaveCount(0);
  });

  test("тап переворачивает карточку и возвращает обратно", async ({ page }) => {
    await open(page);
    const card = topCard(page);

    await tap(page);
    await expect(card).toHaveClass(/flipped/);

    // Второй тап должен вернуть лицевую сторону: раньше touch+mouse события
    // дублировались и флип срабатывал дважды за один тап.
    await tap(page);
    await expect(card).not.toHaveClass(/flipped/);
  });

  test("свайп влево ведёт вперёд, вправо — назад", async ({ page }) => {
    await open(page);

    await swipe(page, -150);
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");
    await expect(page.locator(".dots i").nth(1)).toHaveClass("on");

    await swipe(page, 150);
    await expect(topCard(page)).toHaveAttribute("data-idx", "0");
    await expect(page.locator(".dots i").first()).toHaveClass("on");
  });

  test("недотянутый свайп возвращает карточку и не переворачивает её", async ({
    page,
  }) => {
    await open(page);

    await swipe(page, -40); // меньше порога
    await expect(topCard(page)).toHaveAttribute("data-idx", "0");
    await expect(topCard(page)).not.toHaveClass(/flipped/);
  });

  test("колода листается с клавиатуры", async ({ page }) => {
    await open(page);

    await page.keyboard.press("ArrowRight");
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");

    await page.keyboard.press("ArrowLeft");
    await expect(topCard(page)).toHaveAttribute("data-idx", "0");
  });

  test("листание колоды меняет тему заявки и список под ней", async ({ page }) => {
    await open(page);

    // Кнопка заявки больше не отправляет данные боту: колода выбирает тему, а
    // заявка открывается отдельным экраном уже с этой темой в ссылке.
    await expect(page.locator(".action-note")).toContainText("Кейс 0");

    await page.keyboard.press("ArrowRight");
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");

    await expect(page.locator(".action-note")).toContainText("Кейс 1");
    await expect(page.locator(".action-bar a")).toHaveAttribute(
      "href",
      /\/request\/\?topic=case-1/,
    );

    // Ничего боту не ушло — отправка переехала в форму заявки.
    expect(
      await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent),
    ).toEqual([]);
  });

  test("сбой Supabase объясняется текстом, а не пустым экраном", async ({ page }) => {
    await open(page, { casesFail: true });

    await expect(page.locator(".deck-error")).toContainText(
      "Не получилось загрузить карточки",
    );
    await expect(page.locator(".swipe-card")).toHaveCount(0);
  });
});

// Telegram открывает Mini App невысоким фреймом, и высота меняется при
// разворачивании. Карточка обязана уменьшаться целиком, а не сплющиваться:
// раньше `max-height` перебивал `aspect-ratio` и пропорция ехала.
test.describe("пропорции карточки", () => {
  const CARD_RATIO = 5 / 7;
  const FRAMES = [
    { width: 390, height: 460 }, // предельно низкий фрейм
    { width: 390, height: 560 },
    { width: 390, height: 660 }, // примерно как открывает Telegram
    { width: 390, height: 844 }, // почти во весь экран
    { width: 320, height: 520 }, // узкий и низкий сразу
    { width: 430, height: 932 },
  ];

  for (const frame of FRAMES) {
    test(`${frame.width}×${frame.height}: пропорция 5:7, колода и кнопка заявки в кадре`, async ({
      page,
    }) => {
      await page.setViewportSize(frame);
      await open(page);

      const m = await page.evaluate(() => {
        const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const card = rect(".deck");
        const wrap = rect(".deck-wrap");
        const dots = rect(".dots-row");
        const action = rect(".action-bar");
        return {
          ratio: card.width / card.height,
          cardTop: card.top,
          cardBottom: card.bottom,
          wrapTop: wrap.top,
          wrapBottom: wrap.bottom,
          dotsBottom: dots.bottom,
          actionBottom: action.bottom,
          actionW: Math.round(action.width),
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(m.ratio).toBeCloseTo(CARD_RATIO, 2);
      // Колода живёт в блоке заданной высоты: карточка и точки обязаны
      // остаться внутри него, иначе они наезжают на список под колодой.
      expect(m.cardTop).toBeGreaterThanOrEqual(m.wrapTop - 1);
      expect(m.cardBottom).toBeLessThanOrEqual(m.wrapBottom + 1);
      expect(m.dotsBottom).toBeLessThanOrEqual(m.wrapBottom + 1);
      // Карточка в кадре, а не обрезана сверху.
      expect(m.cardTop).toBeGreaterThanOrEqual(0);
      // Кнопка заявки стоит на одном месте внизу и не уезжает за кадр:
      // это единственный вход в заявку, скроллом его искать нельзя.
      expect(m.actionBottom).toBeLessThanOrEqual(m.viewportH + 1);
      expect(m.actionW).toBe(m.viewportW);
      // Горизонтального переполнения быть не должно ни при какой ширине.
      expect(m.overflowX).toBeLessThanOrEqual(0);
    });
  }

  for (const frame of FRAMES) {
    test(`${frame.width}×${frame.height}: содержимое карточки не вылезает за её край`, async ({
      page,
    }) => {
      await page.setViewportSize(frame);
      await open(page);

      const m = await page.evaluate(() => {
        const card = document.querySelector(".deck .swipe-card:last-child")!;
        const box = (s: string) => card.querySelector(s)!.getBoundingClientRect();
        const face = box(".card-front");
        const text = box(".body p");
        const title = box("h3");
        const eta = box(".eta");
        const num = box(".num");
        return {
          // Описание не должно доезжать до бейджей срока и счётчика.
          textOverlapsBadges: text.bottom > Math.min(eta.top, num.top) + 0.5,
          textOutsideCard: text.bottom > face.bottom + 0.5 || text.right > face.right + 0.5,
          titleOutsideCard: title.bottom > face.bottom + 0.5,
          badgesInsideCard: eta.bottom <= face.bottom + 0.5 && num.bottom <= face.bottom + 0.5,
          badgesDoNotCollide: eta.right <= num.left + 0.5,
          textVisible: text.height > 0,
        };
      });

      expect(m.textOverlapsBadges).toBe(false);
      expect(m.textOutsideCard).toBe(false);
      expect(m.titleOutsideCard).toBe(false);
      expect(m.badgesInsideCard).toBe(true);
      expect(m.badgesDoNotCollide).toBe(true);
      expect(m.textVisible).toBe(true);
    });
  }

  test("при разворачивании фрейма карточка растёт, пропорция держится", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await open(page);

    const measure = () =>
      page.evaluate(() => {
        const c = document.querySelector(".deck")!.getBoundingClientRect();
        const wrap = document.querySelector(".deck-wrap")!.getBoundingClientRect();
        return {
          w: c.width,
          ratio: c.width / c.height,
          insideWrap: c.bottom <= wrap.bottom + 1,
        };
      });

    const low = await measure();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await measure()).w > low.w).toBe(true);

    const tall = await measure();
    expect(low.ratio).toBeCloseTo(5 / 7, 2);
    expect(tall.ratio).toBeCloseTo(5 / 7, 2);
    expect(low.insideWrap).toBe(true);
    expect(tall.insideWrap).toBe(true);
  });
});

test.describe("широкий экран", () => {
  // Стрелки показываются только при `(hover:hover)` и ширине от 640px, поэтому
  // здесь эмулируем мышь: с hasTouch браузер сообщает грубый указатель без
  // hover, и кнопки остаются скрытыми — как и задумано на телефоне.
  test.use({ viewport: { width: 900, height: 900 }, hasTouch: false });

  test("кнопки-стрелки листают колоду", async ({ page }) => {
    await open(page);

    await page.locator(".arrow.right").click();
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");

    await page.locator(".arrow.left").click();
    await expect(topCard(page)).toHaveAttribute("data-idx", "0");
  });
});
