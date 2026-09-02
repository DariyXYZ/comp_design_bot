"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { routes } from "@/config/navigation";
import { useRequestDraft } from "@/features/requests/draft-store";

/**
 * Вход в заявку по прямой ссылке.
 *
 * Экрана формы больше нет — заявка живёт шторкой над колодой. Но адрес
 * `/request/?item=…` или `/request/?topic=…` остаётся законным входом снаружи:
 * ссылка в тексте, сообщение бота, закладка. Здесь он превращается в то, чем
 * стал внутри приложения: контекст кладётся в черновик, человек оказывается на
 * главном экране, шторка открыта на всю высоту.
 *
 * `replace`, а не `push`: этот адрес — не место, куда можно вернуться кнопкой
 * «назад». Вернуться из него значило бы снова разложить тот же контекст.
 */
export function RequestEntry() {
  const params = useSearchParams();
  const router = useRouter();
  const { pinMaterial, requestTopic, setSnap } = useRequestDraft();

  useEffect(() => {
    const item = params.get("item");
    const topic = params.get("topic");
    if (item) pinMaterial(item);
    else if (topic) requestTopic(topic, params.get("t") ?? undefined);
    setSnap("full");
    router.replace(routes.topics);
  }, [params, pinMaterial, requestTopic, setSnap, router]);

  return <div className="scroll" />;
}
