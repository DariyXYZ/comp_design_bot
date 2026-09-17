import { createRequest, type CreateRequestResult } from "@/lib/client/api";
import { sendToBot, haptic, type SendResult } from "@/lib/client/telegram";

/**
 * Переключатель на время переезда: `NEXT_PUBLIC_SUBMIT_VIA_API=1` — заявка
 * уходит в `POST /api/requests` C#-сервера, иначе через `sendData` боту (Vercel +
 * Python-бот). После переключения webhook остаётся только путь через API.
 */
export function submitsViaApi(): boolean {
  return process.env.NEXT_PUBLIC_SUBMIT_VIA_API === "1";
}

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
 * - `photos` — guid картинок в Pyrus через запятую. Бот по ним прикладывает
 *   файлы к задаче и не спрашивает картинки в чате.
 *
 * Ключи в snake_case: их читает Python, и переименовывать их на его стороне
 * ради вкусов JS бессмысленно.
 */
export type RequestDraft = {
  topic: string;
  origin?: string;
  originPath?: string;
  project?: string;
  /** id позиции справочника «Проект» — бот пишет его в поле-справочник. */
  projectId?: string;
  description?: string;
  /** Ожидаемый результат — своё поле в Pyrus, не часть описания. */
  expected?: string;
  source?: string;
  deadline?: string;
  /**
   * guid картинок, уже загруженных в Pyrus из формы. Сами файлы через
   * `sendData` не проходят, поэтому едут только их идентификаторы — бот
   * прикладывает их к задаче, ничего не скачивая.
   */
  photoGuids?: readonly string[];
};

/** Лимиты бота (`MAX_DESCRIPTION`, `MAX_SOURCE`) — обрезаем до отправки. */
const LIMITS = { description: 3000, expected: 1500, source: 500, short: 200 } as const;

function clean(value: string | undefined, limit: number): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length > limit ? text.slice(0, limit) : text;
}

export function buildRequestPayload(draft: RequestDraft): Record<string, string> {
  const payload: Record<string, string> = { case: draft.topic };
  const guids = (draft.photoGuids ?? []).filter(Boolean);
  if (guids.length) payload.photos = guids.join(",");
  const fields: ReadonlyArray<[string, string | undefined, number]> = [
    ["description", draft.description, LIMITS.description],
    ["expected", draft.expected, LIMITS.expected],
    ["project", draft.project, LIMITS.short],
    ["project_id", draft.projectId, LIMITS.short],
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

/**
 * Отправка через API C#-сервера. Картинки идут массивом guid, а не строкой:
 * лимита `sendData` тут нет, и серверу проще принять список.
 */
export async function submitRequestViaApi(draft: RequestDraft): Promise<CreateRequestResult> {
  const payload: Record<string, unknown> = buildRequestPayload(draft);
  payload.photos = (draft.photoGuids ?? []).filter(Boolean);
  const result = await createRequest(payload);
  haptic(result.ok ? "success" : "error");
  return result;
}

/** Отправляет заявку боту и отзывается тактильно: успех и отказ различимы на ощупь. */
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
