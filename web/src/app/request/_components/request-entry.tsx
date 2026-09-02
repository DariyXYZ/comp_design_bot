"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { itemHref, routes } from "@/config/navigation";
import { useRequestDraft } from "@/features/requests/draft-store";

/**
 * Вход в заявку по прямой ссылке.
 *
 * Экрана формы больше нет — заявка живёт шторкой, и шторка стоит внизу на обоих
 * экранах выбора. Но адрес `/request/?item=…` или `/request/?topic=…` остаётся
 * законным входом снаружи: ссылка в тексте, сообщение бота, закладка. Здесь он
 * превращается в то, чем стал внутри приложения — в экран, на котором эта
 * заявка и оформляется: решение открывается своим экраном, тема кладётся в
 * черновик и человек оказывается у колоды. Шторка в обоих случаях развёрнута.
 *
 * `replace`, а не `push`: этот адрес — не место, куда можно вернуться кнопкой
 * «назад». Вернуться из него значило бы снова разложить тот же контекст.
 */
export function RequestEntry() {
  const params = useSearchParams();
  const router = useRouter();
  const { requestTopic, setSnap } = useRequestDraft();

  useEffect(() => {
    const item = params.get("item");
    const topic = params.get("topic");
    setSnap("full");
    if (item) {
      // Решение — это его экран: там оно и становится основой заявки.
      router.replace(itemHref(item));
      return;
    }
    if (topic) requestTopic(topic, params.get("t") ?? undefined);
    router.replace(routes.topics);
  }, [params, requestTopic, setSnap, router]);

  return <div className="scroll" />;
}
