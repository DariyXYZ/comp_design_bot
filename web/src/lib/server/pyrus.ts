/**
 * Клиент Pyrus для серверных роутов. **Только сервер:** секретный ключ даёт
 * доступ ко всем задачам аккаунта, в браузер он попасть не должен.
 *
 * Повторяет решения питоновского клиента бота (`bot/pyrus.py`), потому что они
 * вытекают из самого API, а не из языка:
 *
 * * поля формы ищутся **по названию** — коды Pyrus через API не отдаёт
 *   (`code: null` у всех), а id меняется при пересоздании поля;
 * * удалённые варианты выбора приходят с флагом `deleted` и их нельзя брать —
 *   `choice_id` не переиспользуются;
 * * заявки человека отбираются на нашей стороне: `filters` в
 *   `forms/{id}/register` Pyrus молча игнорирует (проверено — фильтр по
 *   несуществующему id возвращает весь реестр).
 */
import { BOARD_STATUS, type BoardStatus } from "@/lib/board-status";

const AUTH_URL = "https://api.pyrus.com/v4/auth";
const DEFAULT_API = "https://api.pyrus.com/v4";

/** Поля формы канбан-доски отдела «Вычислительное Проектирование задачи». */
export const FIELD = {
  topic: "Тема",
  project: "Проект",
  description: "Описание задачи",
  expected: "Ожидаемый результат",
  origin: "Основа заявки",
  source: "Путь к проекту",
  originPath: "Путь к решению-источнику",
  deadline: "Дата",
  author: "Telegram",
  telegramId: "Telegram ID",
  requestNo: "Номер заявки в боте",
  status: "Статус",
} as const;

export type PyrusRequest = {
  taskId: number;
  number: number | null;
  topic: string | null;
  project: string | null;
  description: string | null;
  expected: string | null;
  origin: string | null;
  deadline: string | null;
  created: string | null;
  closed: boolean;
  /** Колонка доски отдела. */
  status: string | null;
  /** Последний вопрос отдела, пока задача в колонке «Требуется уточнение». */
  question: string | null;
};

type FieldValue =
  | string
  | number
  | null
  | { choice_names?: string[]; choice_value?: string; fields?: PyrusField[] };

type PyrusField = { id: number; name?: string; value?: FieldValue };

type SchemaOption = { choice_id: number; choice_value?: string; deleted?: boolean };
type SchemaField = {
  id: number;
  name?: string;
  info?: { fields?: SchemaField[]; options?: SchemaOption[] };
};

/**
 * Поля формы одним списком, включая вложенные в разделы: на доске отдела
 * поля лежат внутри разделов («Инфо», «Задача»), и плоский обход их не видит.
 */
function flattenSchema(fields: SchemaField[]): SchemaField[] {
  return fields.flatMap((field) => [field, ...flattenSchema(field.info?.fields ?? [])]);
}

/** Поля задачи одним списком: у поля-раздела значение — `{ fields: [...] }`. */
function flattenTask(fields: PyrusField[]): PyrusField[] {
  return fields.flatMap((field) => {
    const nested =
      field.value && typeof field.value === "object" ? (field.value.fields ?? []) : [];
    return [field, ...flattenTask(nested)];
  });
}

type PyrusTask = {
  id: number;
  create_date?: string;
  close_date?: string | null;
  is_closed?: boolean;
  fields?: PyrusField[];
  comments?: { text?: string }[];
};

/**
 * Договорённость с ботом: вопрос отдела уходит в задачу комментарием с этим
 * началом. Кабинет показывает последний такой комментарий как вопрос.
 */
const QUESTION_PREFIX = "Вопрос заявителю:";

function lastQuestion(task: PyrusTask): string | null {
  for (const comment of [...(task.comments ?? [])].reverse()) {
    const text = comment.text?.trim() ?? "";
    if (text.startsWith(QUESTION_PREFIX)) return text.slice(QUESTION_PREFIX.length).trim();
  }
  return null;
}

export class Pyrus {
  private token: string | null = null;
  private api = DEFAULT_API;
  private schema: Map<string, number> | null = null;
  /** «название поля» → «подпись варианта» → choice_id — для полей выбора. */
  private choices = new Map<string, Map<string, number>>();

  constructor(
    private readonly login: string,
    private readonly securityKey: string,
    private readonly formId: number,
  ) {}

  get enabled(): boolean {
    return Boolean(this.login && this.securityKey && this.formId);
  }

  private async authorize(): Promise<string> {
    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: this.login, security_key: this.securityKey }),
      cache: "no-store",
    });
    const body = (await response.json()) as { access_token?: string; api_url?: string };
    if (!response.ok || !body.access_token) {
      throw new Error(`Pyrus: авторизация не удалась (${response.status})`);
    }
    this.token = body.access_token;
    // Pyrus может вернуть свой адрес API — уважаем его, а не зашитый.
    this.api = (body.api_url ?? DEFAULT_API).replace(/\/$/, "");
    return this.token;
  }

  /** Запрос с одной повторной попыткой после переавторизации по 401. */
  private async call<T>(path: string, payload?: unknown): Promise<T> {
    for (const attempt of [1, 2]) {
      const token = this.token ?? (await this.authorize());
      const response = await fetch(this.api + path, {
        method: payload === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: "no-store",
      });
      if (response.ok) return (await response.json()) as T;
      if (response.status === 401 && attempt === 1) {
        this.token = null;
        continue;
      }
      throw new Error(`Pyrus: ${path} ответил ${response.status}`);
    }
    throw new Error(`Pyrus: ${path} недоступен`);
  }

  private async fields(): Promise<Map<string, number>> {
    if (this.schema) return this.schema;
    const body = await this.call<{ fields?: SchemaField[] }>(`/forms/${this.formId}`);
    const map = new Map<string, number>();
    for (const field of flattenSchema(body.fields ?? [])) {
      const name = field.name?.trim();
      if (!name) continue;
      map.set(name, field.id);
      // Удалённые варианты приходят с флагом deleted — их брать нельзя.
      const options = (field.info?.options ?? []).filter((o) => !o.deleted);
      if (options.length) {
        this.choices.set(
          name,
          new Map(options.map((o) => [o.choice_value?.trim() ?? "", o.choice_id])),
        );
      }
    }
    this.schema = map;
    return map;
  }

  private static plain(value: FieldValue | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") {
      return value.choice_names?.[0] ?? value.choice_value ?? null;
    }
    return String(value);
  }

  /**
   * Разбирает поля задачи в заявку. `null` — задача не этого человека.
   *
   * Проверка владельца живёт здесь, а не в роутах: id заявителя лежит в поле
   * формы, и знание о том, в каком именно, не должно расползаться. Забыть её
   * в одном из роутов означало бы дать читать и комментировать чужие заявки.
   */
  private toRequest(
    task: PyrusTask,
    tgFieldId: number,
    telegramId: number,
  ): PyrusRequest | null {
    const byName = new Map<string, string | null>();
    let telegram: string | null = null;
    for (const field of flattenTask(task.fields ?? [])) {
      const value = Pyrus.plain(field.value);
      if (field.name) byName.set(field.name.trim(), value);
      if (field.id === tgFieldId) telegram = value;
    }
    if (telegram !== String(telegramId)) return null;
    // Номер заявки — id задачи Pyrus; поле «Номер заявки в боте» осталось
    // у старых задач.
    const number = byName.get(FIELD.requestNo);
    return {
      taskId: task.id,
      number: number ? Number(number) : task.id,
      topic: byName.get(FIELD.topic) ?? null,
      project: byName.get(FIELD.project) ?? null,
      description: byName.get(FIELD.description) ?? null,
      expected: byName.get(FIELD.expected) ?? null,
      origin: byName.get(FIELD.origin) ?? null,
      deadline: byName.get(FIELD.deadline) ?? null,
      created: task.create_date ?? null,
      closed: task.is_closed ?? Boolean(task.close_date),
      status: byName.get(FIELD.status) ?? null,
      question: byName.get(FIELD.status) === BOARD_STATUS.clarify ? lastQuestion(task) : null,
    };
  }

  private async telegramFieldId(): Promise<number> {
    const fields = await this.fields();
    const id = fields.get(FIELD.telegramId);
    if (!id) throw new Error(`Pyrus: в форме нет поля «${FIELD.telegramId}»`);
    return id;
  }

  /** Заявки одного человека из реестра формы, свежие сверху. */
  async listUserRequests(telegramId: number): Promise<PyrusRequest[]> {
    const tgFieldId = await this.telegramFieldId();
    const body = await this.call<{ tasks?: PyrusTask[] }>(
      `/forms/${this.formId}/register`,
      { include_archived: true },
    );
    const mine: PyrusRequest[] = [];
    for (const task of body.tasks ?? []) {
      const request = this.toRequest(task, tgFieldId, telegramId);
      if (request) mine.push(request);
    }
    // Свежие сверху: человек ищет последнюю заявку, а не первую.
    mine.sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
    return mine;
  }

  /** Одна заявка. `null` — задачи нет или она не этого человека. */
  async userRequest(taskId: number, telegramId: number): Promise<PyrusRequest | null> {
    const tgFieldId = await this.telegramFieldId();
    const body = await this.call<{ task?: PyrusTask }>(`/tasks/${taskId}`);
    if (!body.task) return null;
    return this.toRequest(body.task, tgFieldId, telegramId);
  }

  /**
   * Позиции справочника: id + первая колонка как название.
   *
   * У справочника «Проект» одна колонка; если колонок больше, название — в
   * первой, остальные здесь не нужны.
   */
  async catalogItems(catalogId: number): Promise<{ id: number; name: string }[]> {
    const body = await this.call<{
      items?: { item_id: number; values?: string[] }[];
    }>(`/catalogs/${catalogId}`);
    const items: { id: number; name: string }[] = [];
    for (const item of body.items ?? []) {
      const name = item.values?.[0]?.trim();
      if (name) items.push({ id: item.item_id, name });
    }
    return items;
  }

  /**
   * Пишет комментарий к задаче и, если попросили, меняет её состояние.
   *
   * Комментарий — единственный способ что-либо сделать с существующей
   * задачей: отдельных методов «закрыть» и «переоткрыть» у Pyrus нет,
   * состояние меняется полем `action` того же комментария.
   */
  async comment(
    taskId: number,
    text: string,
    action?: "finished" | "reopened",
    status?: BoardStatus,
  ): Promise<boolean> {
    const payload: Record<string, unknown> = { text };
    if (action) payload.action = action;
    if (status) {
      // Колонка доски — поле выбора: принимает не текст, а choice_id.
      const fields = await this.fields();
      const fieldId = fields.get(FIELD.status);
      const choiceId = this.choices.get(FIELD.status)?.get(status);
      if (fieldId && choiceId !== undefined) {
        payload.field_updates = [{ id: fieldId, value: { choice_id: choiceId } }];
      }
    }
    await this.call(`/tasks/${taskId}/comments`, payload);
    return true;
  }
}
