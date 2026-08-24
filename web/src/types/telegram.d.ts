/**
 * Минимальные типы Telegram WebApp SDK.
 *
 * SDK подключается тегом `<script>` с telegram.org (npm-пакета у него нет),
 * поэтому типы объявляем сами — только те методы, которые реально вызываем.
 * Полный API — https://core.telegram.org/bots/webapps
 */
/** Пользователь Telegram — приходит внутри `initDataUnsafe`. */
interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  /**
   * Данные запуска без проверки подписи — годятся только для отображения
   * (имя в профиле). Ничего доверять этому нельзя: подпись `initData`
   * проверяется HMAC на сервере, которого у нас пока нет.
   */
  initDataUnsafe?: { user?: TelegramUser };
  /**
   * Те же данные запуска строкой (`user=...&auth_date=...&hash=...`). Нужны
   * как второй источник: клиенты иногда отдают строку, не заполнив
   * `initDataUnsafe`. Проверять подпись здесь нельзя — только на сервере.
   */
  initData?: string;
  /** Появился в Bot API 7.7 — в старых клиентах метода нет, вызывать через `?.` */
  disableVerticalSwipes?(): void;
  /** Отправляет данные боту и закрывает Mini App. Работает только внутри Telegram. */
  sendData(data: string): void;
  /**
   * Подписка на события клиента. Нужен `viewportChanged`: Telegram открывает
   * Mini App невысоким фреймом, и его высота меняется при разворачивании —
   * размер карточки надо пересчитывать. Событие `resize` при этом не всегда
   * приходит, поэтому одного window-слушателя мало.
   */
  onEvent?(event: string, handler: (...args: unknown[]) => void): void;
  offEvent?(event: string, handler: (...args: unknown[]) => void): void;
  /**
   * Кнопка «назад» в шапке клиента. Рисует её сам Telegram, поэтому своя
   * кнопка в вёрстке нужна только вне Telegram (браузер, отладка).
   */
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  /** Тактильный отклик. В старых клиентах и в браузере отсутствует. */
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  /** Закрывает Mini App. */
  close(): void;
  /**
   * Нативный вопрос клиента (Bot API 6.2). Нужен перед уходом с заполненной
   * формы: `window.confirm` в вебвью Telegram выглядит чужеродно, а на части
   * клиентов его вообще не показывают.
   */
  showConfirm?(message: string, callback: (confirmed: boolean) => void): void;
  /**
   * Спросить перед закрытием приложения (свайп вниз, крест в шапке). Включаем
   * только пока в форме есть незаполненное — иначе вопрос надоедает.
   */
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  /** Версия Bot API клиента — по ней видно, что метод может отсутствовать. */
  version?: string;
}

interface TelegramNamespace {
  WebApp: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramNamespace;
  }
  /**
   * Пользователь Telegram доступен и в модулях: `readViewer` разбирает его из
   * строки `initData`, когда клиент не заполнил `initDataUnsafe`. Без этого
   * псевдонима тип виден только внутри файла объявлений.
   */
  type TelegramWebAppUser = TelegramUser;
}

export {};
