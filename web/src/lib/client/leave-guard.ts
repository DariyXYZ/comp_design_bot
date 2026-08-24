"use client";

/**
 * Защита от случайного выхода с заполненного экрана.
 *
 * Заявка живёт только в состоянии React: `sendData` — единственный канал к
 * боту, и до отправки текста нет нигде. Один случайный тап по «назад» (а в
 * Telegram кнопка «назад» стоит в шапке клиента, рядом с закрытием) — и
 * набранное описание потеряно без следа. Возврат на экран открывает пустую
 * форму, потому что монтируется она заново.
 *
 * Поэтому уход с экрана проходит через вопрос. Спрашивает сам Telegram
 * (`showConfirm` — нативный диалог клиента), а в браузере остаётся `confirm`.
 *
 * Экран регистрирует проверку «есть ли что терять» и снимает её при
 * размонтировании: guard хранится в модуле, потому что спрашивать нужно из
 * оболочки приложения и из кнопки «назад», а они живут выше формы по дереву.
 */
type Guard = () => boolean;

let guard: Guard | null = null;

export function setLeaveGuard(next: Guard | null): void {
  guard = next;
}

/** `true` — уходить можно (терять нечего или человек подтвердил). */
export function askLeave(): Promise<boolean> {
  if (!guard?.()) return Promise.resolve(true);
  const message = "Выйти из заявки? Заполненное не сохранится.";
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      // Появился в Bot API 6.2; в старых клиентах метода нет — ниже `confirm`.
      tg.showConfirm?.(message, (confirmed) => resolve(confirmed));
    });
  }
  try {
    return Promise.resolve(window.confirm(message));
  } catch {
    // Нестандартное окружение без диалогов: молча блокировать уход хуже, чем
    // потерять текст, — человек останется в приложении без объяснения.
    return Promise.resolve(true);
  }
}
