"use client";

import { useSyncExternalStore } from "react";
import { readViewer, type Viewer } from "@/lib/telegram";

/**
 * Кто смотрит приложение — доступно только в браузере.
 *
 * Через `useSyncExternalStore`, а не `useState` + `useEffect`: страницы
 * пререндерятся в статику, где никакого Telegram нет, и хук честно отдаёт
 * серверный снимок `null`, а после гидратации — реального пользователя. Тот же
 * результат «записать состояние в эффекте» дал бы лишний рендер и ругань
 * правила `react-hooks/set-state-in-effect`.
 */

// Значение не меняется за жизнь фрейма, поэтому подписка пустая.
const subscribe = () => () => {};

// Снимок обязан быть стабильным по ссылке — иначе бесконечный ререндер.
let cached: Viewer | null = null;
const clientSnapshot = () => (cached ??= readViewer());
const serverSnapshot = () => null;

export function useViewer(): Viewer | null {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
