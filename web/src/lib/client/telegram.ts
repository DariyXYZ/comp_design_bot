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
