/**
 * Минимальные типы Telegram WebApp SDK.
 *
 * SDK подключается тегом `<script>` с telegram.org (npm-пакета у него нет),
 * поэтому типы объявляем сами — только те методы, которые реально вызываем.
 * Полный API — https://core.telegram.org/bots/webapps
 */
interface TelegramWebApp {
  ready(): void;
  expand(): void;
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
}

interface TelegramNamespace {
  WebApp: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramNamespace;
  }
}

export {};
