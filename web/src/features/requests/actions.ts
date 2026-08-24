/**
 * Действия по существующей заявке.
 *
 * Все они — одно и то же по механике: запись в разговор по заявке. Она уходит
 * двумя адресами сразу: комментарием в задачу Pyrus (там реестр и история) и
 * сообщением в ветку заявок чата отдела (там работают люди). Отличаются
 * действия только формулировкой и тем, меняют ли состояние задачи.
 *
 * Поэтому здесь чистая функция, а не четыре роута: разные кнопки не должны
 * означать разные пути в коде — иначе одно из них однажды забудут довести до
 * Pyrus или до чата.
 */
export const REQUEST_ACTIONS = ["note", "accept", "rework", "cancel"] as const;

export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/** Ограничение на длину сообщения: и Pyrus, и Telegram примут больше, но
 *  простыня в реестре бесполезна — детали дописываются в чате. */
export const MESSAGE_LIMIT = 1500;

export type ActionPlan = {
  /** Текст комментария в задаче Pyrus. */
  comment: string;
  /** Сообщение в чат отдела. */
  chat: string;
  /** Меняется ли состояние задачи. */
  action?: "finished" | "reopened";
};

export function isRequestAction(value: unknown): value is RequestAction {
  return typeof value === "string" && REQUEST_ACTIONS.includes(value as RequestAction);
}

/** Нужен ли этому действию текст от человека. */
export function needsText(action: RequestAction): boolean {
  return action === "note" || action === "rework";
}

export type RequestRef = {
  /** Номер заявки в боте — по нему заявку узнаёт отдел. */
  number: number | null;
  topic: string | null;
  /** Кто пишет: имя и ник, как в профиле. */
  author: string;
};

/**
 * Что именно записать при этом действии.
 *
 * `null` — действию нужен текст, а его не дали: молча отправлять пустое
 * «вернул на доработку» нельзя, отдел не поймёт, что переделывать.
 */
export function planAction(
  action: RequestAction,
  request: RequestRef,
  text: string,
): ActionPlan | null {
  const message = text.trim().slice(0, MESSAGE_LIMIT);
  if (needsText(action) && !message) return null;

  const head = `Заявка №${request.number ?? "—"}${request.topic ? ` · ${request.topic}` : ""}`;
  const from = `от заявителя (${request.author})`;

  switch (action) {
    case "note":
      return {
        comment: `Сообщение ${from}:\n${message}`,
        chat: `${head}\nСообщение ${from}:\n${message}`,
      };
    case "accept":
      // Задача уже закрыта переходом в «Готово» — состояние не меняем, но
      // приёмку фиксируем: без неё непонятно, дошёл ли результат.
      return {
        comment: `Результат принят ${from}`,
        chat: `${head}\nРезультат принят ${from}`,
      };
    case "rework":
      return {
        comment: `Возвращена на доработку ${from}:\n${message}`,
        chat: `${head}\nВозвращена на доработку ${from}:\n${message}`,
        action: "reopened",
      };
    case "cancel":
      return {
        comment: message
          ? `Отменена ${from}:\n${message}`
          : `Отменена ${from}`,
        chat: message
          ? `${head}\nОтменена ${from}:\n${message}`
          : `${head}\nОтменена ${from}`,
        action: "finished",
      };
  }
}
