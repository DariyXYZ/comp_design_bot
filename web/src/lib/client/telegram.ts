/**
 * Настройка фрейма Telegram, общая для всех экранов Mini App.
 *
 * Раньше эти три вызова жили внутри деки — она была единственным экраном.
 * Теперь экранов несколько, и `disableVerticalSwipes` нужен каждому: без него
 * вертикальный жест (драг карточки, скролл списка) закрывает Mini App.
 */
export function initTelegramViewport(): void {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  // Появился в Bot API 7.7 — в старых клиентах метода нет.
  tg?.disableVerticalSwipes?.();
}

/** Как обращаться к человеку в профиле. */
export type Viewer = {
  name: string;
  handle: string | null;
  /** Открыто из Telegram или прямой ссылкой в браузере (черновик, отладка). */
  inTelegram: boolean;
};

/**
 * Кто смотрит приложение.
 *
 * Имя берётся из `initDataUnsafe` — без проверки подписи, и это осознанно: оно
 * идёт только в заголовок профиля. Как только «мои заявки» начнут приходить с
 * сервера, фильтровать их по этим данным будет нельзя — там нужна проверка
 * HMAC, то есть серверный код.
 */
export function readViewer(): Viewer {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user) {
    return { name: "Гость", handle: null, inTelegram: false };
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return {
    name: name || "Без имени",
    handle: user.username ? `@${user.username}` : null,
    inTelegram: true,
  };
}

/** Отклик на действие. Отсутствует в браузере и в старых клиентах. */
export function haptic(kind: "tap" | "success" | "error"): void {
  const hf = window.Telegram?.WebApp?.HapticFeedback;
  if (!hf) return;
  if (kind === "tap") hf.impactOccurred("light");
  else hf.notificationOccurred(kind === "success" ? "success" : "error");
}

/** Закрыть Mini App — например чтобы человек оказался в чате с ботом. */
export function closeMiniApp(): void {
  window.Telegram?.WebApp?.close();
}

/**
 * Отправка данных боту.
 *
 * Единственный канал из статического Mini App к боту: `sendData` кладёт строку
 * в сообщение `web_app_data` и закрывает приложение. Ограничения, из которых
 * растёт вся обработка ниже:
 *
 * 1. Работает только внутри Telegram и только для кнопки из reply-клавиатуры.
 * 2. Лимит — 4096 байт, и это байты UTF-8: русский текст занимает по два на
 *    символ, так что «4096 символов» было бы вдвое оптимистичнее правды.
 * 3. Файлы отправить нельзя — фото бот докупает отдельным шагом в чате.
 */
export type SendResult = "sent" | "outside-telegram" | "too-long" | "failed";

export const SEND_DATA_LIMIT_BYTES = 4096;

export function sendToBot(payload: unknown): SendResult {
  const tg = window.Telegram?.WebApp;
  if (!tg?.sendData) return "outside-telegram";

  const data = JSON.stringify(payload);
  if (new TextEncoder().encode(data).length > SEND_DATA_LIMIT_BYTES) {
    return "too-long";
  }
  try {
    tg.sendData(data);
    return "sent";
  } catch {
    // Нестандартное окружение: метод есть, но бросает вместо закрытия.
    return "failed";
  }
}
