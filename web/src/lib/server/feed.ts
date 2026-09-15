import { BOARD_STATUS } from "@/lib/board-status";
import { serverEnv } from "@/config/server-env";
import { FIELD, Pyrus } from "@/lib/server/pyrus";

/**
 * Поток отдела — доска Pyrus в виде ленты.
 *
 * Источник один: реестр формы доски. Строка ленты — то, что видно на карточке
 * канбана: тема, проект, суть, колонка, дата; плюс обложка — первая картинка
 * из вложений задачи — и путь к исходникам. Автор намеренно не отдаётся:
 * ленту видит весь отдел и любой, у кого есть приложение, а чьи это заявки —
 * знает доска.
 *
 * Реестр не отдаёт вложений и комментариев, поэтому для активных задач и
 * последних закрытых задача читается целиком. Это ~25 запросов к Pyrus —
 * поэтому результат живёт в памяти две минуты, и у обложек свой кэш.
 */

export type FeedTask = {
  taskId: number;
  topic: string | null;
  project: string | null;
  /** Первая содержательная строка описания — без шапки «Проект: …». */
  excerpt: string;
  status: string | null;
  closed: boolean;
  created: string | null;
  closedAt: string | null;
  source: string | null;
  /** Есть ли картинка — обложку отдаёт /api/feed/{id}/cover/. */
  hasCover: boolean;
  /** Telegram ID тех, кто подписался на задачу из приложения. */
  watchers: number[];
};

type Attachment = { id: number; name?: string; url?: string; mime_type?: string; size?: number };
type Comment = { text?: string; attachments?: Attachment[] };
type Task = {
  id: number;
  create_date?: string;
  close_date?: string | null;
  is_closed?: boolean;
  fields?: Field[];
  attachments?: Attachment[];
  comments?: Comment[];
};
type Field = {
  id: number;
  name?: string;
  value?: string | number | null | { choice_names?: string[]; fields?: Field[] };
};

const TTL_MS = 2 * 60 * 1000;
const CLOSED_LIMIT = 15;
/** Договорённость с ботом и кабинетом: подписка — комментарий с этим началом. */
export const WATCH_PREFIX = "Подписка:";
export const UNWATCH_PREFIX = "Отписка:";
const HEADER_KEYS = ["Проект:", "Основа:", "Срок:", "Картинки:"];

let cache: { at: number; tasks: FeedTask[]; details: Map<number, Task> } | null = null;

function flatten(fields: Field[]): Field[] {
  return fields.flatMap((field) => {
    const nested =
      field.value && typeof field.value === "object" && "fields" in field.value
        ? (field.value.fields ?? [])
        : [];
    return [field, ...flatten(nested)];
  });
}

function plain(value: Field["value"]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value.choice_names?.[0] ?? null;
  return String(value);
}

export function excerptOf(description: string | null): string {
  const lines = (description ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !HEADER_KEYS.some((key) => line.startsWith(key)));
  const first = lines[0] ?? "";
  return first.length > 140 ? first.slice(0, 139).trimEnd() + "…" : first;
}

/** Подписчики по истории комментариев: подписка минус последующая отписка. */
export function watchersOf(comments: Comment[]): number[] {
  const set = new Set<number>();
  for (const comment of comments) {
    const text = comment.text?.trim() ?? "";
    const match = /^(Подписка|Отписка):\s*tg:(\d+)/.exec(text);
    if (!match) continue;
    const id = Number(match[2]);
    if (match[1] === "Подписка") set.add(id);
    else set.delete(id);
  }
  return [...set];
}

export function firstImage(task: Task): Attachment | null {
  const all = [
    ...(task.attachments ?? []),
    ...(task.comments ?? []).flatMap((comment) => comment.attachments ?? []),
  ];
  return all.find((att) => (att.mime_type ?? "").startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(att.name ?? "")) ?? null;
}

function toFeedTask(task: Task): FeedTask {
  const byName = new Map<string, string | null>();
  for (const field of flatten(task.fields ?? [])) {
    if (field.name) byName.set(field.name.trim(), plain(field.value));
  }
  return {
    taskId: task.id,
    topic: byName.get(FIELD.topic) ?? null,
    project: byName.get(FIELD.project) ?? null,
    excerpt: excerptOf(byName.get(FIELD.description) ?? null),
    status: byName.get(FIELD.status) ?? null,
    closed: task.is_closed ?? Boolean(task.close_date),
    created: task.create_date ?? null,
    closedAt: task.close_date ?? null,
    source: byName.get(FIELD.source) ?? null,
    hasCover: firstImage(task) !== null,
    watchers: watchersOf(task.comments ?? []),
  };
}

function pyrusClient(): Pyrus {
  const env = serverEnv();
  return new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId);
}

/** Лента: активные задачи и последние закрытые, свежие сверху. */
export async function loadFeed(): Promise<FeedTask[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.tasks;
  const pyrus = pyrusClient();
  const register = await pyrus.register();
  const closed = register
    .filter((task) => task.is_closed || task.close_date)
    .sort((a, b) => (b.close_date ?? "").localeCompare(a.close_date ?? ""))
    .slice(0, CLOSED_LIMIT);
  const active = register.filter((task) => !(task.is_closed || task.close_date));
  const picked = [...active, ...closed];
  const details = new Map<number, Task>();
  await Promise.all(
    picked.map(async (task) => {
      const full = await pyrus.task<Task>(task.id);
      if (full) details.set(task.id, full);
    }),
  );
  const tasks = picked
    .map((task) => toFeedTask(details.get(task.id) ?? (task as Task)))
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
  cache = { at: Date.now(), tasks, details };
  return tasks;
}

/** Задача из кэша ленты или напрямую — для обложки и подписки. */
export async function feedTask(taskId: number): Promise<Task | null> {
  const cached = cache?.details.get(taskId);
  if (cached) return cached;
  return pyrusClient().task<Task>(taskId);
}

/** Сбросить кэш после записи — подписка должна быть видна сразу. */
export function invalidateFeed(): void {
  cache = null;
}

export function isActiveStatus(status: string | null): boolean {
  return status !== BOARD_STATUS.done && status !== BOARD_STATUS.rejected;
}
