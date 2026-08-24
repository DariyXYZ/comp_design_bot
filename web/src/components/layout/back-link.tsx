"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { askLeave } from "@/lib/client/leave-guard";

/**
 * Кнопка «назад» в вёрстке экрана.
 *
 * Клиентский компонент нужен ради одного: с заполненной формы уходить только
 * после подтверждения (см. `leave-guard`). Обычная ссылка ушла бы мгновенно и
 * унесла с собой набранный текст.
 *
 * Ссылка, а не `router.back()`: экран открывается и по прямой ссылке, и тогда
 * истории за спиной нет.
 */
export function BackLink({ href }: Readonly<{ href: string }>) {
  const router = useRouter();

  return (
    <Link
      href={href}
      className="back"
      aria-label="Назад"
      onClick={(event) => {
        // Модификаторы и средняя кнопка — «открыть в новой вкладке»: перехват
        // сломал бы привычное поведение браузера.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void askLeave().then((leave) => {
          if (leave) router.push(href);
        });
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M19 12H5.5M11 6l-6 6 6 6"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
