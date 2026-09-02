import { expect, test, type Page } from "@playwright/test";

/**
 * Из чего заявка — и как это видно человеку.
 *
 * У основы два слоя. Верхний идёт следом за колодой, нижний появляется вместе
 * с открытым решением и исчезает вместе с ним. Проверки держат именно это:
 * лишняя строка «решение не выбрано» на колоде когда-то съедала половину
 * свёрнутой шторки, а внутреннее слово отдела в основе заявки — то, по чему
 * исполнители ищут в реестре Pyrus.
 */

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Строка основы: первая — карточка колоды, вторая — открытое решение. */
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

test.describe("из чего заявка", () => {
  test("на колоде шторка называет карточку и больше ничего", async ({ page }) => {
    await stubApp(page);
    await page.goto("/");

    // Одна строка основы, не две: пока решение не открыто, писать «решение не
    // выбрано» незачем — это высота, отнятая у карточки под шторкой.
    await expect(page.locator(".origin-row")).toHaveCount(1);
    await expect(originTitle(page, 0)).toHaveText("Тема physics");

    // Шторка стоит на среднем положении: описание уже видно, поэтому кнопка
    // предлагает отправку — и объясняет, чего для неё не хватает.
    const send = page.locator(".sheet-foot .btn");
    await expect(send).toHaveText("Отправить заявку");
    await expect(send).toBeDisabled();
    await expect(page.locator(".sheet-foot .action-note")).toContainText(
      "Опишите задачу",
    );
  });

  test("открытое решение становится основой заявки и перестаёт ею быть на возврате", async ({
    page,
  }) => {
    await stubApp(page);
    await page.goto("/");

    // Решение выбирают, открыв его: отдельной кнопки «взять это решение» нет,
    // иначе человека просили бы подтвердить то, что он уже сделал.
    await page.locator(".rows .row").first().click();
    await expect(page).toHaveURL(/\/item\/\?id=tool-insolation$/);

    await expect(page.locator(".origin-row")).toHaveCount(2);
    await expect(originTitle(page, 0)).toHaveText("Тема physics");
    await expect(originTitle(page, 1)).toHaveText("IND Solar — инсоляция и КЕО");
    // Шторка та же самая и на том же месте — это один предмет на обоих экранах.
    await expect(page.locator(".sheet-foot .btn")).toHaveText("Отправить заявку");

    await page.locator(".back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".origin-row")).toHaveCount(1);
  });

  test("экран решения предлагает сделать самому, а не только заказать", async ({
    page,
  }) => {
    await stubApp(page);

    // Инструмент: сначала забрать файлы и применить самому — ради этого
    // материалы и оформляют. Подпись стоит у файлов, о которых говорит.
    await page.goto("/item/?id=tool-insolation");
    await expect(page.locator(".section-note")).toContainText("Заберите файлы");

    // Кейс повторить самому нельзя — там подпись про саму заявку.
    await page.goto("/item/?id=case-vereyskaya");
    await expect(page.locator(".section-note")).toContainText("привязана к этому кейсу");
  });

  test("тип материала подписан на языке заявителя", async ({ page }) => {
    await stubApp(page);

    await page.goto("/");
    // В списке под колодой — «Готовый инструмент», а не «Инструмент».
    // Внутреннее слово отдела уходит только в основу заявки (см. request.spec).
    await expect(page.locator(".rows .tag").first()).toHaveText("Готовый инструмент");
  });

  test("прямая ссылка на заявку по решению открывает его экран", async ({ page }) => {
    await stubApp(page);

    // Адрес остаётся законным входом снаружи — ссылка в тексте, сообщение
    // бота, закладка, — но экрана формы за ним больше нет: заявка оформляется
    // там, где открыто решение.
    await page.goto("/request/?item=tool-insolation");
    await expect(page).toHaveURL(/\/item\/\?id=tool-insolation$/);
    await expect(originTitle(page, 0)).toHaveText("IND Solar — инсоляция и КЕО");
  });
});
