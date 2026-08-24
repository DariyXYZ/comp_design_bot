import { describe, expect, it } from "vitest";
import { EXCERPT_LIMIT, requestExcerpt } from "@/features/requests/excerpt";

/**
 * Суть заявки в списке. Проверяется потому, что ошибка тут выглядит не как
 * ошибка: список рисуется, но строки в нём одинаковые — именно так начальник
 * решил, что видит чужие заявки.
 */
describe("суть заявки", () => {
  it("шапка заявки из Mini App отбрасывается", () => {
    const description = [
      "Проект: 1-23-45 ЖК Бабаевский",
      "Основа: Тема · Нужно перебрать много вариантов",
      "Срок: 2026-08-20",
      "Картинки: 1 — приложены в задаче Pyrus",
      "",
      "Нужно расставить колонны по золотому сечению",
    ].join("\n");
    expect(requestExcerpt(description)).toBe("Нужно расставить колонны по золотому сечению");
  });

  it("заявка из чата отдаёт первую строку как есть", () => {
    expect(requestExcerpt("Хочу здание в виде котика 🦁")).toBe("Хочу здание в виде котика 🦁");
  });

  it("длинное описание обрезается по слову-границе строки", () => {
    const long = "я".repeat(EXCERPT_LIMIT + 20);
    const excerpt = requestExcerpt(long);
    expect(excerpt).toHaveLength(EXCERPT_LIMIT);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("пустое описание не ломает список", () => {
    expect(requestExcerpt(null)).toBe("");
    expect(requestExcerpt("   \n  ")).toBe("");
    // Только шапка без текста — тоже пусто, а не «Проект: …».
    expect(requestExcerpt("Проект: X\nСрок: 2026-01-01")).toBe("");
  });
});
