"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSameRoute, routes } from "@/config/navigation";
import { RequestSheet } from "@/features/requests/components/request-sheet";
import { RequestDraftProvider } from "@/features/requests/draft-store";
import { exchangeSession } from "@/lib/client/api";
import { cacheViewer, initTelegramViewport, readViewer } from "@/lib/client/telegram";

/**
 * Оболочка приложения: настройка фрейма Telegram, черновик заявки и кнопка
 * «назад» клиента.
 *
 * Черновик держится здесь, а не на экране формы, потому что формы-экрана
 * больше нет: заявка живёт в шторке над главным экраном, а её содержимое
 * обязано пережить и листание колоды, и поход в поток или профиль. Провайдер
 * выше маршрутов — единственное место, где это возможно без хранилища.
 *
 * Нижней панели разделов тоже больше нет: низ экрана занят шторкой, а «Задачи»
 * и «Профиль» уехали плашками в верхние углы главного экрана (см. `TopBar`).
 * Значит, все экраны кроме главного — вложенные, и у каждого есть «назад».
 *
 * Шторка стоит внизу на обоих экранах выбора — на колоде и на открытом
 * решении, — и рисуется здесь, а не внутри них: так она не перемонтируется на
 * переходе между ними и не теряет ни высоту, ни прокрутку формы. В разделах
 * «Задачи» и «Профиль» её нет: там ничего не выбирают.
 *
 * Клиентский компонент — `layout.tsx` остаётся серверным и не тянет за собой
 * ничего лишнего.
 */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const onHome = isSameRoute(pathname, routes.topics);
  const withSheet = onHome || isSameRoute(pathname, routes.item);

  useEffect(() => {
    initTelegramViewport();
    // Вход подтверждается здесь, на старте приложения, а не на экране профиля.
    // Причина: код входа лежит в адресе кнопки (`?c=`), а бот открывает
    // приложение на первом экране. Переход между экранами — клиентская
    // навигация, и адрес меняется целиком: и код, и имя из адреса до профиля
    // не доживали. Отсюда и был симптом «открыто вне Telegram» при живой
    // кнопке. `readViewer` сам запоминает найденное имя — здесь важен сам
    // вызов, сделанный на экране, куда пришёл адрес с параметрами.
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
  //
  // Вопроса «выйти?» здесь больше нет: уходить некуда — черновик заявки живёт
  // в провайдере выше и переживает любой переход. Спрашивать осталось только
  // при закрытии приложения, и это делает сама шторка.
  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    if (!back) return;
    if (onHome) {
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
  }, [onHome, router]);

  return (
    <RequestDraftProvider>
      {/* Обёртка нужна флексбоксу: экран занимает всё, что осталось от body, а
          шторка стоит поверх и в поток не входит. Класс говорит содержимому,
          сколько места снизу занято. */}
      <div className={withSheet ? "app app-with-sheet" : "app"}>{children}</div>
      {withSheet ? <RequestSheet /> : null}
    </RequestDraftProvider>
  );
}
