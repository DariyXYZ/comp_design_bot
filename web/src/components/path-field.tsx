"use client";

import { useState } from "react";

/**
 * Путь к файлам на сетевом диске.
 *
 * Это не ссылка: `X:\...` браузер открыть не может, а Telegram тем более.
 * Поэтому единственное осмысленное действие — скопировать путь и вставить его
 * в проводник, и кнопка говорит ровно это. Ссылкой такое рисовать нельзя —
 * тап по «ссылке», который ничего не открывает, читается как поломка.
 */
export function PathField({ path }: Readonly<{ path: string }>) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Буфер закрыт политикой окружения — путь всё равно виден и его можно
      // переписать глазами, поэтому молча ничего не делаем.
    }
  }

  return (
    <div className="path-field">
      <code>{path}</code>
      <button
        type="button"
        onClick={copy}
        className={copied ? "path-copy done" : "path-copy"}
        aria-label={copied ? "Путь скопирован" : "Копировать путь"}
        title={copied ? "Скопировано" : "Копировать путь"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
