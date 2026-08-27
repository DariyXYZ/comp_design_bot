"use client";

import { useEffect } from "react";
import { RESTART_HINT } from "@/config/copy";

/**
 * Ловит падение рендера оболочки. Сбой загрузки карточек сюда НЕ попадает —
 * его дека обрабатывает сама и показывает свой текст внутри колоды, не теряя
 * экран целиком.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Внутри Telegram WebView консоль недоступна, но при отладке через
    // браузер это единственный способ увидеть причину.
    console.error(error);
  }, [error]);

  return (
    <div className="fallback">
      <h1>Что-то сломалось</h1>
      <p>
        Экран не открылся. Попробуйте ещё раз. {RESTART_HINT} Если повторится
        — напишите в отдел вычислительного проектирования.
      </p>
      <button className="cta" onClick={reset}>
        <span className="cta-label">Попробовать снова</span>
      </button>
    </div>
  );
}
