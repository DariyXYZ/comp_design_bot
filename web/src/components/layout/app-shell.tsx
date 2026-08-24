"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { TAB_ROUTES, isSameRoute } from "@/config/navigation";
import { exchangeSession } from "@/lib/client/api";
import { askLeave } from "@/lib/client/leave-guard";
import { cacheViewer, initTelegramViewport, readViewer } from "@/lib/client/telegram";
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
    // Вход подтверждается здесь, на старте приложения, а не на экране профиля.
    // Причина: код входа лежит в адресе кнопки (`?c=`), а бот открывает
    // приложение на первом экране. Переход по табам — клиентская навигация, и
    // адрес меняется целиком: и код, и имя из адреса до профиля не доживали.
    // Отсюда и был симптом «открыто вне Telegram» при живой кнопке.
    // `readViewer` сам запоминает найденное имя — здесь важен сам вызов,
    // сделанный на экране, куда пришёл адрес с параметрами.
    readViewer();
    void exchangeSession().then((session) => {
      if (!session) return;
      cacheViewer({
        name: session.user.name,
        handle: session.user.handle,
        inTelegram: true,
      });
    });
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
    // Кнопку рисует клиент, и она стоит рядом с закрытием приложения —
    // промахнуться легко. С заполненной формы уходим только после вопроса.
    const goBack = () => {
      void askLeave().then((leave) => {
        if (leave) router.back();
      });
    };
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
