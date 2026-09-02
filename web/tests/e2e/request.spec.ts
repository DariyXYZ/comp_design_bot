import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозная проверка отправки заявки боту.
 *
 * Это единственный канал между Mini App и ботом, и ломается он молча: страница
 * выглядит рабочей, а `web_app_data` до бота не доходит. Поэтому проверяется
 * ровно то, что уйдёт в Telegram.
 *
 * Заявка живёт шторкой над колодой, а её черновик — в оболочке приложения.
 * Отсюда вторая тема этого файла: набранное обязано переживать переходы между
 * экранами. Раньше форма была отдельным маршрутом, теряла состояние на каждом
 * уходе, и это приходилось прикрывать вопросом «выйти?».
 */

const APP_PATH = "/";

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Карточки колоды: заявка по теме должна работать и без живой Supabase. */
async function stubCases(page: Page) {
  await page.route("**/api/topics/**", (route) =>
    route.fulfill({
      json: {
        rows: ["physics", "revit", "unique"].map((key, i) => ({
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
}

const sendButton = (page: Page) => page.locator(".sheet-foot .btn");
const description = (page: Page) =>
  page.getByPlaceholder("Что нужно сделать и что хотите получить на выходе");

async function openForm(page: Page, query: string) {
  await page.route("**/telegram-web-app.js", (route) => route.abort());
  await stubCases(page);
  await page.addInitScript(() => {
    const sent: string[] = [];
    const asked: string[] = [];
    const probe = window as unknown as {
      __sent: string[];
      __asked: string[];
      __answer: boolean;
      __closingConfirmation: boolean;
      __back?: () => void;
      __backShown: boolean;
    };
    probe.__sent = sent;
    probe.__asked = asked;
    probe.__answer = false;
    probe.__closingConfirmation = false;
    probe.__backShown = false;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        close() {},
        sendData(data: string) {
          sent.push(data);
        },
        // Нативный вопрос клиента: тест записывает текст и отвечает тем,
        // что задано в `__answer`.
        showConfirm(message: string, callback: (confirmed: boolean) => void) {
          asked.push(message);
          callback(probe.__answer);
        },
        enableClosingConfirmation() {
          probe.__closingConfirmation = true;
        },
        disableClosingConfirmation() {
          probe.__closingConfirmation = false;
        },
        BackButton: {
          show() {
            probe.__backShown = true;
          },
          hide() {
            probe.__backShown = false;
          },
          // Обработчик оболочки складываем наружу — тест нажимает кнопку
          // клиента так же, как это делает Telegram.
          onClick(handler: () => void) {
            probe.__back = handler;
          },
          offClick() {
            probe.__back = undefined;
          },
        },
      },
    };
  });
  await page.goto(`${APP_PATH}request/?${query}`);
  // Прямая ссылка раскладывает основу и уводит на главный экран, где шторка
  // уже развёрнута.
  await expect(page.locator(".origin-row").first()).toBeVisible();
}

const sentPayloads = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);

/**
 * Печатает текст в поле так, как это делает человек.
 *
 * Не `fill()`: он ставит значение одним событием, и до состояния React оно в
 * этой сборке не доходит — значение оказывается в DOM, а форма остаётся
 * незаполненной (кнопка отправки заблокирована). Посимвольный ввод повторяет
 * настоящие события и проверяет ровно тот путь, которым идёт человек.
 */
async function type(page: Page, placeholder: string, text: string) {
  const field = page.getByPlaceholder(placeholder);
  await field.click();
  await field.pressSequentially(text, { delay: 10 });
}

test.describe("заявка из Mini App", () => {
  test("без описания отправка заблокирована", async ({ page }) => {
    await openForm(page, "topic=revit&t=Revit");

    await expect(sendButton(page)).toBeDisabled();
    await expect(page.locator(".sheet-foot .action-note")).toContainText(
      "Опишите задачу",
    );

    expect(await sentPayloads(page)).toEqual([]);
  });

  test("заявка из материала уходит боту с темой, основой и путём к решению", async ({
    page,
  }) => {
    await openForm(page, "item=tool-insolation");

    await type(page, "1-19-2026 МР Верейская БЦ", "2-04-2026 МФК Ленинский");
    await type(
      page,
      "Что нужно сделать и что хотите получить на выходе",
      "Посчитать инсоляцию двух вариантов двора",
    );
    await page.locator('input[type="date"]').fill("2026-08-28");

    await sendButton(page).click();

    const payloads = await sentPayloads(page);
    expect(payloads).toHaveLength(1);
    const payload = JSON.parse(payloads[0]);
    // Тема берётся из материала, а не из адреса: заявка «по инструменту» должна
    // попасть в ту же тему, под которой инструмент лежит.
    expect(payload.case).toBe("physics");
    expect(payload.description).toBe("Посчитать инсоляцию двух вариантов двора");
    expect(payload.project).toBe("2-04-2026 МФК Ленинский");
    // Pyrus принимает дату в ISO — ровно это и отдаёт нативный календарь.
    expect(payload.deadline).toBe("2026-08-28");
    // В реестр отдела уходит внутреннее слово («Инструмент»), а не подпись из
    // интерфейса: по нему исполнители ищут в Pyrus.
    expect(payload.origin).toBe("Инструмент · IND Solar — инсоляция и КЕО");
    expect(payload.origin_path).toContain("CompDesign_Projects");
  });

  test("после отправки черновик пуст — вернувшийся не видит чужую заявку", async ({
    page,
  }) => {
    await openForm(page, "topic=revit&t=Revit");
    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад");
    await sendButton(page).click();

    expect(await sentPayloads(page)).toHaveLength(1);
    await expect(description(page)).toHaveValue("");
    expect(
      await page.evaluate(
        () => (window as unknown as { __closingConfirmation: boolean }).__closingConfirmation,
      ),
    ).toBe(false);
  });

  test("вне Telegram отправка объясняет себя, а не молчит", async ({ page }) => {
    // Без заглушки SDK: ровно то, что видит человек, открывший ссылку в браузере.
    await page.route("**/telegram-web-app.js", (route) => route.abort());
    await stubCases(page);
    await page.goto(`${APP_PATH}request/?topic=revit&t=Revit`);

    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад в Revit");
    await sendButton(page).click();

    await expect(page.locator(".sheet-foot .banner")).toContainText(
      "только внутри Telegram",
    );
  });

  test("набранное переживает поход в другой раздел", async ({ page }) => {
    // Ради этого шторка и появилась. Раньше форма была отдельным экраном и
    // теряла состояние на любом уходе — поэтому уход спрашивал «выйти?».
    // Спрашивать больше не о чем, и вопроса быть не должно.
    await openForm(page, "topic=revit&t=Revit");
    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад");

    await page.locator(".pill").first().click();
    await expect(page).toHaveURL(/\/feed\/$/);
    expect(
      await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked),
    ).toEqual([]);

    await page.locator(".back").click();
    await expect(description(page)).toHaveValue("Передать фасад");
  });

  test("«назад» клиента живёт только на вложенных экранах", async ({ page }) => {
    const shown = () =>
      page.evaluate(() => (window as unknown as { __backShown: boolean }).__backShown);

    await openForm(page, "topic=revit&t=Revit");
    // Главный экран — корень приложения: уходить с него некуда, кнопка скрыта.
    expect(await shown()).toBe(false);

    await page.locator(".pill").nth(1).click();
    await expect(page).toHaveURL(/\/my\/$/);
    expect(await shown()).toBe(true);

    await page.evaluate(() => (window as unknown as { __back?: () => void }).__back?.());
    await expect(page).toHaveURL(/\/$/);
  });

  test("подтверждение закрытия включается вместе с первым введённым словом", async ({
    page,
  }) => {
    // Свайп вниз и крест в шапке идут мимо навигации — там спросить может
    // только сам Telegram, и просить его надо ровно пока есть что терять.
    const flag = () =>
      page.evaluate(
        () => (window as unknown as { __closingConfirmation: boolean }).__closingConfirmation,
      );
    await openForm(page, "topic=revit&t=Revit");
    expect(await flag()).toBe(false);

    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад");
    expect(await flag()).toBe(true);
  });
});
