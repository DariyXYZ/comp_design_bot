"use client";

import { useSyncExternalStore } from "react";
import { readViewer, type Viewer } from "@/lib/client/telegram";

/**
 * Кто смотрит приложение — доступно только в браузере.
 *
 * Через `useSyncExternalStore`, а не `useState` + `useEffect`: страницы
 * пререндерятся в статику, где никакого Telegram нет, и хук честно отдаёт
 * серверный снимок `null`, а после гидратации — реального пользователя.
 *
 * Снимок **перечитывается**, пока Telegram не отдаст пользователя. Первая
 * версия кэшировала результат навсегда, и если SDK на момент первого рендера
 * ещё не успел разобрать данные запуска, профиль на всю сессию застревал на
 * «Гость. Открыто вне Telegram» — ровно этот баг и был. Опрос короткий и
 * прекращается, как только пользователь появился (или через `GIVE_UP_MS`,
 * чтобы в обычном браузере не тикать вечно).
 */

const POLL_MS = 250;
const GIVE_UP_MS = 5000;

let snapshot: Viewer | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let waitedMs = 0;

function stopPolling() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function refresh() {
  const next = readViewer();
  // Сравниваем по полям: getSnapshot обязан возвращать стабильную ссылку,
  // иначе React перерисовывает бесконечно.
  if (
    !snapshot ||
    snapshot.inTelegram !== next.inTelegram ||
    snapshot.name !== next.name ||
    snapshot.handle !== next.handle
  ) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  if (next.inTelegram) stopPolling();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null && !snapshot?.inTelegram) {
    waitedMs = 0;
    timer = setInterval(() => {
      waitedMs += POLL_MS;
      refresh();
      if (waitedMs >= GIVE_UP_MS) stopPolling();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

function clientSnapshot(): Viewer {
  if (!snapshot) snapshot = readViewer();
  return snapshot;
}

const serverSnapshot = () => null;

export function useViewer(): Viewer | null {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
