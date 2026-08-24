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
const AUTH_URL = "https://api.pyrus.com/v4/auth";
const DEFAULT_API = "https://api.pyrus.com/v4";

export const FIELD = {
  topic: "Тема",
  project: "Проект",
  description: "Описание и ожидаемый результат",
  origin: "Основа заявки",
  source: "Путь к исходникам",
  originPath: "Путь к решению-источнику",
  deadline: "Дата",
  author: "Автор в Telegram",
  telegramId: "Telegram ID",
  requestNo: "Номер заявки в боте",
} as const;

export type PyrusRequest = {
  taskId: number;
  number: number | null;
  topic: string | null;
  project: string | null;
  description: string | null;
  origin: string | null;
  deadline: string | null;
  created: string | null;
  closed: boolean;
};

type FieldValue = string | number | null | { choice_names?: string[]; choice_value?: string };

type PyrusField = { id: number; name?: string; value?: FieldValue };

type PyrusTask = {
  id: number;
  create_date?: string;
  close_date?: string | null;
  is_closed?: boolean;
  fields?: PyrusField[];
};

export class Pyrus {
  private token: string | null = null;
  private api = DEFAULT_API;
  private schema: Map<string, number> | null = null;

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
    const body = await this.call<{ fields?: { id: number; name?: string }[] }>(
      `/forms/${this.formId}`,
    );
    const map = new Map<string, number>();
    for (const field of body.fields ?? []) {
      const name = field.name?.trim();
      if (name) map.set(name, field.id);
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
    for (const field of task.fields ?? []) {
      const value = Pyrus.plain(field.value);
      if (field.name) byName.set(field.name.trim(), value);
      if (field.id === tgFieldId) telegram = value;
    }
    if (telegram !== String(telegramId)) return null;
    const number = byName.get(FIELD.requestNo);
    return {
      taskId: task.id,
      number: number ? Number(number) : null,
      topic: byName.get(FIELD.topic) ?? null,
      project: byName.get(FIELD.project) ?? null,
      description: byName.get(FIELD.description) ?? null,
      origin: byName.get(FIELD.origin) ?? null,
      deadline: byName.get(FIELD.deadline) ?? null,
      created: task.create_date ?? null,
      closed: task.is_closed ?? Boolean(task.close_date),
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
  ): Promise<boolean> {
    const payload: Record<string, unknown> = { text };
    if (action) payload.action = action;
    await this.call(`/tasks/${taskId}/comments`, payload);
    return true;
  }
}
