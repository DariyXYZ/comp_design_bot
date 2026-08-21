import { expect, test, type Page } from "@playwright/test";

/**
 * Сквозная проверка отправки заявки боту.
 *
 * Это единственный канал между Mini App и ботом, и ломается он молча: страница
 * выглядит рабочей, а `web_app_data` до бота не доходит. Поэтому проверяется
 * ровно то, что уйдёт в Telegram.
 */

const APP_PATH = "/comp_design_bot/";

async function openForm(page: Page, query: string) {
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
  await page.goto(`${APP_PATH}request/?${query}`);
  await expect(page.locator(".origin-value")).toBeVisible();
}

const sentPayloads = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);

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

    await page.getByPlaceholder("1-19-2026 МР Верейская БЦ").fill("2-04-2026 МФК Ленинский");
    await page
      .getByPlaceholder("Что нужно сделать и что хотите получить на выходе")
      .fill("Посчитать инсоляцию двух вариантов двора");
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

    await page
      .getByPlaceholder("Что нужно сделать и что хотите получить на выходе")
      .fill("Передать фасад в Revit");
    await page.locator(".action-bar button").click();

    await expect(page.locator(".banner")).toContainText("только внутри Telegram");
  });
});
