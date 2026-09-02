import { expect, test, type Page } from "@playwright/test";

/**
 * Два входа в заявку должны читаться как два разных действия.
 *
 * Это не косметика: пока на обеих кнопках стояло «Создать заявку», люди не
 * понимали модель приложения — тема это «попросите нас», материал это «вот
 * готовое, можно повторить или забрать себе». Проверка держит формулировки,
 * потому что ломаются они молча: интерфейс работает, а смысл теряется.
 *
 * Со шторкой к этому добавилось второе: у заявки два слоя основы. Верхний идёт
 * следом за колодой, нижний закрепляется руками с экрана решения. Проверяем,
 * что закрепление доезжает до шторки и переживает переход между экранами.
 */

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Строка основы: первая — карточка колоды, вторая — закреплённое решение. */
const originTitle = (page: Page, index: number) =>
  page.locator(".origin-row").nth(index).locator(".origin-title");

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
  test("кнопка называет действие, а шторка — карточку, из которой заявка", async ({
    page,
  }) => {
    await stubApp(page);

    await page.goto("/");
    // Шторка стоит на среднем положении: описание уже видно, поэтому кнопка
    // предлагает отправку — и объясняет, чего для неё не хватает.
    const send = page.locator(".sheet-foot .btn");
    await expect(send).toHaveText("Отправить заявку");
    await expect(send).toBeDisabled();
    await expect(originTitle(page, 0)).toHaveText("Тема physics");
    await expect(originTitle(page, 1)).toHaveText("по теме карточки");

    // Кейс: главное действие — «хочу так же», отдел повторит сделанное.
    await page.goto("/item/?id=case-vereyskaya");
    await expect(page.locator(".action-bar .btn")).toHaveText("Хочу так же");
    await expect(page.locator(".action-context-kind")).toHaveText("Уже делали");

    // Инструмент: сначала предлагаем сделать самому, заявка — выход на случай
    // «не справлюсь». Поэтому подпись говорит про файлы.
    await page.goto("/item/?id=tool-insolation");
    await expect(page.locator(".action-bar .btn")).toHaveText("Настроить под мой проект");
    await expect(page.locator(".action-note")).toContainText("заберите файлы");
  });

  test("решение с экрана материала закрепляется в шторке и снимается оттуда же", async ({
    page,
  }) => {
    await stubApp(page);

    await page.goto("/item/?id=tool-insolation");
    await page.locator(".action-bar .btn").click();

    // Отдельного экрана формы больше нет: кнопка возвращает на главный, где
    // шторка уже развёрнута и знает, о чём заявка.
    await expect(page).toHaveURL(/\/$/);
    await expect(originTitle(page, 1)).toHaveText("IND Solar — инсоляция и КЕО");
    // Колода едет следом: решение лежит под своей темой, и карточка под
    // шторкой должна быть той же.
    await expect(originTitle(page, 0)).toHaveText("Тема physics");

    await page.locator(".origin-clear").click();
    await expect(originTitle(page, 1)).toHaveText("по теме карточки");
  });

  test("тип материала подписан на языке заявителя", async ({ page }) => {
    await stubApp(page);

    await page.goto("/");
    // В списке под колодой — «Готовый инструмент», а не «Инструмент».
    // Внутреннее слово отдела уходит только в основу заявки (см. request.spec).
    await expect(page.locator(".rows .tag").first()).toHaveText("Готовый инструмент");
  });

  test("прямая ссылка на заявку раскладывает основу и уводит на главный", async ({
    page,
  }) => {
    await stubApp(page);

    // Адрес остаётся законным входом снаружи — ссылка в тексте, сообщение
    // бота, закладка, — но экрана за ним больше нет.
    await page.goto("/request/?item=tool-insolation");
    await expect(page).toHaveURL(/\/$/);
    await expect(originTitle(page, 1)).toHaveText("IND Solar — инсоляция и КЕО");
  });
});
