import { sendToBot, haptic, type SendResult } from "@/lib/client/telegram";

/**
 * Отправка заявки боту.
 *
 * Контракт с ботом (`bot/handlers/create.py`, обработчик `from_webapp`):
 *
 * - `case` — ключ темы из таблицы `cases`, единственное обязательное поле.
 *   Без описания бот ведёт себя как раньше: спрашивает всё в чате.
 * - `description` — если пришло, бот считает заявку заполненной и переходит
 *   сразу к картинкам, минуя вопросы.
 * - `project`, `origin`, `deadline` бот дописывает в шапку описания: отдельных
 *   колонок под них в базе нет, а в тексте описания они переживают смену
 *   статусов, потому что карточка рендерится из него.
 * - `source` — путь к исходникам пользователя, `origin_path` — путь к файлам
 *   решения, из которого заявка родилась.
 *
 * Ключи в snake_case: их читает Python, и переименовывать их на его стороне
 * ради вкусов JS бессмысленно.
 */
export type RequestDraft = {
  topic: string;
  origin?: string;
  originPath?: string;
  project?: string;
  description?: string;
  source?: string;
  deadline?: string;
};

/** Лимиты бота (`MAX_DESCRIPTION`, `MAX_SOURCE`) — обрезаем до отправки. */
const LIMITS = { description: 3000, source: 500, short: 200 } as const;

function clean(value: string | undefined, limit: number): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > limit ? text.slice(0, limit) : text;
}

export function buildRequestPayload(draft: RequestDraft): Record<string, string> {
  const payload: Record<string, string> = { case: draft.topic };
  const fields: ReadonlyArray<[string, string | undefined, number]> = [
    ["description", draft.description, LIMITS.description],
    ["project", draft.project, LIMITS.short],
    ["deadline", draft.deadline, LIMITS.short],
    ["origin", draft.origin, LIMITS.short],
    ["origin_path", draft.originPath, LIMITS.source],
    ["source", draft.source, LIMITS.source],
  ];
  for (const [key, value, limit] of fields) {
    const text = clean(value, limit);
    if (text) payload[key] = text;
  }
  return payload;
}

/** Отправляет заявку и отзывается тактильно: успех и отказ различимы на ощупь. */
export function submitRequest(draft: RequestDraft): SendResult {
  const result = sendToBot(buildRequestPayload(draft));
  haptic(result === "sent" ? "success" : "error");
  return result;
}

/**
 * Просит бота показать заявки этого человека.
 *
 * Своего списка у Mini App нет: чтобы отобрать заявки конкретного человека,
 * нужно проверить подпись запуска, а это серверный код, которого у статического
 * экспорта не бывает. Бот такую выборку умеет (`/my`), поэтому приложение
 * просит его ответить в чате — `sendData` закрывает Mini App, и человек
 * оказывается ровно там, где придёт список.
 */
export function askMyRequests(): SendResult {
  const result = sendToBot({ action: "my_requests" });
  haptic(result === "sent" ? "success" : "error");
  return result;
}
