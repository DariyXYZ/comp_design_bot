"use client";

import { useEffect } from "react";
import { initTelegramViewport } from "@/lib/client/telegram";
import { TabBar } from "./tab-bar";

/**
 * Оболочка приложения: настройка фрейма Telegram один раз на всё приложение
 * плюс нижняя навигация. Клиентский компонент — `layout.tsx` остаётся
 * серверным и не тянет за собой ничего лишнего.
 */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    initTelegramViewport();
  }, []);

  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
