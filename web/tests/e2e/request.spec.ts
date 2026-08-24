import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозная проверка отправки заявки боту.
 *
 * Это единственный канал между Mini App и ботом, и ломается он молча: страница
 * выглядит рабочей, а `web_app_data` до бота не доходит. Поэтому проверяется
 * ровно то, что уйдёт в Telegram.
 */

const APP_PATH = "/";

async function openForm(page: Page, query: string) {
  await page.route("**/telegram-web-app.js", (route) => route.abort());
  await page.addInitScript(() => {
    const sent: string[] = [];
    const asked: string[] = [];
    const probe = window as unknown as {
      __sent: string[];
      __asked: string[];
      __answer: boolean;
      __closingConfirmation: boolean;
      __back?: () => void;
    };
    probe.__sent = sent;
    probe.__asked = asked;
    probe.__answer = false;
    probe.__closingConfirmation = false;
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
          show() {},
          hide() {},
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
  await expect(page.locator(".origin-value")).toBeVisible();
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

    const button = page.locator(".action-bar button");
    await expect(button).toBeDisabled();
    await expect(page.locator(".action-note")).toContainText("Заполните описание");

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

    await page.locator(".action-bar button").click();

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
    expect(payload.origin).toContain("IND Solar");
    expect(payload.origin_path).toContain("CompDesign_Projects");
  });

  test("вне Telegram отправка объясняет себя, а не молчит", async ({ page }) => {
    // Без заглушки SDK: ровно то, что видит человек, открывший ссылку в браузере.
    await page.route("**/telegram-web-app.js", (route) => route.abort());
    await page.goto(`${APP_PATH}request/?topic=revit&t=Revit`);

    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад в Revit");
    await page.locator(".action-bar button").click();

    await expect(page.locator(".banner")).toContainText("только внутри Telegram");
  });
  test("«назад» с заполненной формы спрашивает, а пустую отпускает", async ({
    page,
  }) => {
    // Форма живёт только в состоянии React: возврат монтирует её заново и
    // пустой, поэтому случайный тап по «назад» стирает набранное без следа.
    await openForm(page, "topic=revit&t=Revit");

    await page.locator(".back").click();
    expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toEqual([]);
    await expect(page.locator(".origin-value")).not.toBeVisible();

    await openForm(page, "topic=revit&t=Revit");
    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад");

    // Отказ: остаёмся на форме, текст на месте.
    await page.locator(".back").click();
    expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toHaveLength(1);
    await expect(page.locator(".origin-value")).toBeVisible();
    await expect(
      page.getByPlaceholder("Что нужно сделать и что хотите получить на выходе"),
    ).toHaveValue("Передать фасад");

    // Согласие: уходим.
    await page.evaluate(() => {
      (window as unknown as { __answer: boolean }).__answer = true;
    });
    await page.locator(".back").click();
    await expect(page.locator(".origin-value")).not.toBeVisible();
  });

  test("кнопка «назад» самого Telegram проходит через тот же вопрос", async ({
    page,
  }) => {
    // В Telegram «назад» рисует клиент, и она стоит рядом с закрытием —
    // промахнуться легче, чем по своей кнопке в вёрстке.
    await openForm(page, "topic=revit&t=Revit");
    await type(page, "Что нужно сделать и что хотите получить на выходе", "Передать фасад");

    await page.evaluate(() => (window as unknown as { __back?: () => void }).__back?.());
    expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toHaveLength(1);
    await expect(page.locator(".origin-value")).toBeVisible();
  });

  test("подтверждение закрытия включается вместе с первым введённым словом", async ({
    page,
  }) => {
    // Свайп вниз и крест в шапке идут мимо «назад» — там спросить может
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
