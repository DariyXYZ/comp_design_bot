"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { TAB_ROUTES, isSameRoute } from "@/config/navigation";
import { initTelegramViewport } from "@/lib/client/telegram";
import { TabBar } from "./tab-bar";

/**
 * Оболочка приложения: настройка фрейма Telegram, кнопка «назад» клиента и
 * нижняя навигация.
 *
 * Клиентский компонент — `layout.tsx` остаётся серверным и не тянет за собой
 * ничего лишнего.
 */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const onTabScreen = TAB_ROUTES.some((route) => isSameRoute(pathname, route));

  useEffect(() => {
    initTelegramViewport();
  }, []);

  // На вложенных экранах «назад» рисует сам Telegram в своей шапке — это
  // привычное место, и оно не отнимает высоту у контента. Своя кнопка в
  // вёрстке остаётся для браузера, где BackButton не существует.
  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    if (!back) return;
    if (onTabScreen) {
      back.hide();
      return;
    }
    const goBack = () => router.back();
    back.onClick(goBack);
    back.show();
    return () => {
      back.offClick(goBack);
      back.hide();
    };
  }, [onTabScreen, router]);

  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
