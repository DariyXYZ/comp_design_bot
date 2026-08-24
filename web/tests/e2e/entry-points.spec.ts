import { expect, test, type Page } from "@playwright/test";

/**
 * Два входа в заявку должны читаться как два разных действия.
 *
 * Это не косметика: пока на обеих кнопках стояло «Создать заявку», люди не
 * понимали модель приложения — тема это «попросите нас», материал это «вот
 * готовое, можно повторить или забрать себе». Проверка держит формулировки,
 * потому что ломаются они молча: интерфейс работает, а смысл теряется.
 */

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function stubApp(page: Page) {
  await page.route("**/telegram-web-app.js", (route) => route.abort());
  await page.route("**/api/topics/**", (route) =>
    route.fulfill({
      // Роут отдаёт `{ rows }` — так же, как Supabase.
      json: {
        // Первой в колоде идёт «физика»: под ней лежит инструмент, а нам
        // нужен список материалов. Тем три — дека рисует три слоя.
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
}

test.describe("входы в заявку", () => {
  test("на теме кнопка просит помощь, на материале — предлагает повторить", async ({
    page,
  }) => {
    await stubApp(page);

    await page.goto("/");
    const topicCta = page.locator(".action-bar .btn");
    await expect(topicCta).toHaveText("Попросить помощь по теме");
    await expect(page.locator(".action-note")).toContainText("ответит отдел");

    // Кейс: главное действие — «хочу так же», отдел повторит сделанное.
    await page.goto("/item/?id=case-vereyskaya");
    await expect(page.locator(".action-bar .btn")).toHaveText("Хочу так же");

    // Инструмент: сначала предлагаем сделать самому, заявка — выход на случай
    // «не справлюсь». Поэтому подпись говорит про файлы.
    await page.goto("/item/?id=tool-insolation");
    await expect(page.locator(".action-bar .btn")).toHaveText("Настроить под мой проект");
    await expect(page.locator(".action-note")).toContainText("заберите файлы");
  });

  test("тип материала подписан на языке заявителя, а в заявку уходит слово отдела", async ({
    page,
  }) => {
    await stubApp(page);

    await page.goto("/");
    // В списке под темой — «Готовый инструмент», а не «Инструмент».
    await expect(page.locator(".rows .tag").first()).toHaveText("Готовый инструмент");

    // А в основе заявки, которую читает отдел, остаётся внутреннее слово:
    // по нему исполнители ищут в реестре Pyrus.
    await page.goto("/request/?item=tool-insolation");
    await expect(page.locator(".origin-value")).toHaveText("Инструмент · IND Solar — инсоляция и КЕО");
  });
});
