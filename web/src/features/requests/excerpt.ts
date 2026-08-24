/**
 * Короткая суть заявки для списка.
 *
 * Зачем: в списке строка показывала только тему, а тем восемь. Две разные
 * заявки по «Геометрию нужно передать в Revit» выглядели одной и той же — и
 * человек решил, что видит чужие заявки, хотя фильтр по Telegram-id работал
 * правильно. Отличает заявки друг от друга именно описание.
 *
 * Заявка из Mini App дописывает в описание шапку (проект, основа, срок,
 * картинки) — в списке она бесполезна, там нужна сама задача. Ту же логику
 * повторяет бот в `bot/handlers/start.py::request_excerpt`: список приходит и
 * сообщением в чат, и здесь, и выглядеть они должны одинаково.
 */
const HEADER_KEYS = ["Проект:", "Основа:", "Срок:", "Картинки:"];

export const EXCERPT_LIMIT = 70;

export function requestExcerpt(description: string | null | undefined): string {
  const text = (description ?? "").trim();
  if (!text) return "";
  const body = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !HEADER_KEYS.some((key) => line.startsWith(key)));
  const first = body[0] ?? "";
  return first.length > EXCERPT_LIMIT
    ? `${first.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…`
    : first;
}
