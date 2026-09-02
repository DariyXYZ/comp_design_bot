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

/** basePath убран вместе с раздачей из подпапки — приложение в корне. */
const APP_PATH = "/";

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
        close() {},
        sendData(data: string) {
          sent.push(data);
        },
      },
    };
  });

  // Карточки приходят из своего роута `/api/topics`, а тот уже ходит в
  // Supabase на сервере — перехватывать надо именно роут.
  await page.route("**/api/topics/**", (route) =>
    casesFail
      ? route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "Supabase отказал" }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ rows: CASES }),
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

/** Верхняя строка основы заявки в шторке — та, что идёт следом за колодой. */
const sheetTopic = (page: Page) =>
  page.locator(".origin-row").first().locator(".origin-title");

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

  test("листание колоды меняет тему в шторке заявки", async ({ page }) => {
    await open(page);

    // Колода и шторка живут на одном экране: свайп меняет предмет заявки, не
    // трогая набранное. Тема названа в верхней строке основы — по ней и
    // проверяем.
    await expect(sheetTopic(page)).toHaveText("Кейс 0");

    await page.keyboard.press("ArrowRight");
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");
    await expect(sheetTopic(page)).toHaveText("Кейс 1");

    // Ничего боту не ушло — отправляет только кнопка в шторке.
    expect(
      await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent),
    ).toEqual([]);
  });

  test("стрелки листают колоду, но не когда ими правят текст заявки", async ({
    page,
  }) => {
    await open(page);

    // Форма и колода теперь на одном экране, и стрелки нужны обеим. Пока
    // фокус вне полей, они листают колоду.
    await page.keyboard.press("ArrowRight");
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");

    // А в описании каретка важнее: иначе правка текста молча меняет предмет
    // заявки. Шторку для этого надо раскрыть — по умолчанию она сложена.
    await page.locator(".sheet-foot .btn").click();
    await page
      .getByPlaceholder("Что нужно сделать и что хотите получить на выходе")
      .click();
    await page.keyboard.press("ArrowRight");
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");
  });

  test("вертикальный жест по карточке листает страницу, а не колоду", async ({
    page,
  }) => {
    // Карточка занимает почти всю ширину экрана, а под колодой лежит список
    // готового по теме. Пока любое движение по карточке считалось её свайпом,
    // до списка было не долистать: палец попадал в карточку, она чуть съезжала
    // и возвращалась, а страница стояла.
    //
    // Настоящие касания, а не мышь: `page.mouse` страницу не прокручивает
    // вовсе, и на нём эта проверка была бы зелёной при любом поведении.
    // Отсюда CDP — Playwright свайпа пальцем не умеет.
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    const box = (await page.locator(".deck").boundingBox())!;
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);

    async function touchDrag(dx: number, dy: number) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 14; i += 1) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: x + Math.round((dx * i) / 14), y: y + Math.round((dy * i) / 14) },
          ],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    }

    const scrollTop = () =>
      page.evaluate(() =>
        Math.round(document.querySelector(".scroll")!.scrollTop),
      );

    await touchDrag(0, -220);
    // Порог низкий намеренно: сколько именно прокрутится, зависит от инерции
    // конкретного окружения. Проверяется не расстояние, а то, что жест вообще
    // достался странице, — раньше он целиком уходил карточке.
    expect(await scrollTop()).toBeGreaterThan(30);
    await expect(topCard(page)).toHaveAttribute("data-idx", "0");

    await page.evaluate(() => document.querySelector(".scroll")!.scrollTo(0, 0));
    await touchDrag(-200, 0);
    // Горизонтальный жест остаётся свайпом колоды и страницу не двигает.
    await expect(topCard(page)).toHaveAttribute("data-idx", "1");
    expect(await scrollTop()).toBe(0);
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
    test(`${frame.width}×${frame.height}: пропорция 5:7, колода и шторка в кадре`, async ({
      page,
    }) => {
      await page.setViewportSize(frame);
      await open(page);
      // Шрифт подхватывается после первого кадра и меняет высоту подписей —
      // до этого замеры шторки говорят о раскладке, которой уже не будет.
      await page.waitForFunction(() => document.fonts.status === "loaded");

      const m = await page.evaluate(() => {
        const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const card = rect(".deck");
        const wrap = rect(".deck-wrap");
        const dots = rect(".dots-row");
        const sheet = rect(".sheet");
        const send = rect(".sheet-foot .btn");
        return {
          ratio: card.width / card.height,
          cardTop: card.top,
          cardBottom: card.bottom,
          wrapTop: wrap.top,
          wrapBottom: wrap.bottom,
          dotsBottom: dots.bottom,
          sheetBottom: sheet.bottom,
          sheetW: Math.round(sheet.width),
          sendBottom: send.bottom,
          sendTop: send.top,
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
      // Шторка прижата к нижнему краю во всю ширину, а её кнопка видна при
      // любой высоте фрейма: это единственный вход в отправку, и искать его
      // скроллом нельзя.
      expect(m.sheetBottom).toBeLessThanOrEqual(m.viewportH + 1);
      expect(m.sheetW).toBe(m.viewportW);
      expect(m.sendBottom).toBeLessThanOrEqual(m.viewportH + 1);
      expect(m.sendTop).toBeGreaterThanOrEqual(0);
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
