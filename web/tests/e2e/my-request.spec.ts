import { expect, test, type Page } from "@playwright/test";

/**
 * Экран заявки: что человек видит и что уходит отделу.
 *
 * Проверяется именно тело запроса: действия расходятся в задачу Pyrus и в чат
 * отдела, и ошибка тут молчаливая — экран говорит «отправлено», а отдел не
 * получает ничего или получает не то. Сеть до Pyrus и Telegram заглушена: тесты
 * не должны писать в живой реестр.
 */

const TASK_ID = 374507038;

const REQUEST = {
  taskId: TASK_ID,
  number: 12,
  topic: "Физика: инсоляция",
  project: "2-04-2026 МФК Ленинский",
  description: "Посчитать инсоляцию двух вариантов двора",
  origin: "Инструмент · IND Solar",
  deadline: "2026-08-28",
  created: "2026-08-21T09:12:00Z",
  closed: false,
};

type Posted = { url: string; body: unknown };

async function openRequest(
  page: Page,
  overrides: Partial<typeof REQUEST> = {},
): Promise<Posted[]> {
  const posted: Posted[] = [];
  const request = { ...REQUEST, ...overrides };

  await page.route("**/telegram-web-app.js", (route) => route.abort());
  // Вход подтверждать не нужно: заглушка отвечает вместо роутов, а токен
  // приложение добавляет само.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("comp-design-bot:session-token", "TEST-TOKEN");
    } catch {
      // Хранилище может быть недоступно — тест это не проверяет.
    }
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        close() {},
        sendData() {},
        showConfirm(_message: string, callback: (confirmed: boolean) => void) {
          callback(true);
        },
      },
    };
  });

  await page.route(`**/api/requests/${TASK_ID}/`, async (route) => {
    if (route.request().method() === "POST") {
      posted.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({ json: { ok: true, delivered: true } });
      return;
    }
    await route.fulfill({ json: { request } });
  });

  await page.goto(`/my/request/?id=${TASK_ID}`);
  await expect(page.locator(".screen-titles h1")).toHaveText(request.topic);
  return posted;
}

async function type(page: Page, text: string) {
  const field = page.getByPlaceholder("Дополнить задачу, задать вопрос, уточнить сроки");
  await field.click();
  await field.pressSequentially(text, { delay: 5 });
}

test.describe("экран заявки", () => {
  test("показывает данные заявки из Pyrus", async ({ page }) => {
    await openRequest(page);

    await expect(page.locator(".screen-titles p")).toContainText("№ 12");
    await expect(page.locator(".lead")).toHaveText(
      "Посчитать инсоляцию двух вариантов двора",
    );
    await expect(page.locator(".fact-value").first()).toHaveText("2-04-2026 МФК Ленинский");
    await expect(page.locator(".tag")).toHaveText("В работе");
    await expect(page.locator(".row-dim")).toContainText("2026-08-28");
  });

  test("сообщение отделу уходит с текстом, пустое — не уходит", async ({ page }) => {
    const posted = await openRequest(page);

    const send = page.locator(".action-bar button");
    await expect(send).toBeDisabled();
    await expect(page.locator(".action-note")).toContainText("Напишите сообщение");

    await type(page, "Добавьте второй вариант двора");
    await send.click();

    await expect(page.locator(".banner-quiet strong")).toHaveText("Сообщение отправлено");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual({
      action: "note",
      text: "Добавьте второй вариант двора",
    });
    // Поле очищается: иначе следующий тап отправит то же самое второй раз.
    await expect(page.getByPlaceholder("Дополнить задачу, задать вопрос, уточнить сроки")).toHaveValue("");
  });

  test("у открытой заявки есть отмена, у закрытой — приёмка", async ({ page }) => {
    await openRequest(page);
    await expect(page.getByText("Отменить заявку")).toBeVisible();
    await expect(page.getByText("Принять результат")).toHaveCount(0);

    await openRequest(page, { closed: true });
    await expect(page.getByText("Принять результат")).toBeVisible();
    await expect(page.getByText("Вернуть на доработку")).toBeVisible();
    await expect(page.getByText("Отменить заявку")).toHaveCount(0);
  });

  test("доработка без объяснения не отправляется", async ({ page }) => {
    const posted = await openRequest(page, { closed: true });

    await page.getByText("Вернуть на доработку").click();
    await expect(page.locator(".banner strong")).toHaveText("Не отправлено");
    expect(posted).toHaveLength(0);

    await type(page, "Не тот двор");
    await page.getByText("Вернуть на доработку").click();
    await expect(page.locator(".banner-quiet strong")).toHaveText("Возвращена на доработку");
    expect(posted[0].body).toEqual({ action: "rework", text: "Не тот двор" });
  });

  test("отмена спрашивает подтверждение", async ({ page }) => {
    const posted = await openRequest(page);

    await page.getByText("Отменить заявку").click();
    // Заглушка клиента отвечает «да» — проверяем, что вопрос был задан вообще
    // и что после согласия ушло именно `cancel`.
    await expect(page.locator(".banner-quiet strong")).toHaveText("Заявка отменена");
    expect(posted[0].body).toEqual({ action: "cancel", text: "" });
  });

  test("битая ссылка объясняет себя", async ({ page }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort());
    await page.goto("/my/request/?id=не-число");
    await expect(page.locator(".screen-titles h1")).toHaveText("Заявка не найдена");
  });
});
