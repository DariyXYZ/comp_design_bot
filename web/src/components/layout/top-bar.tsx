"use client";

import Link from "next/link";
import { routes } from "@/config/navigation";

/**
 * Два входа поверх колоды: задачи отдела слева, профиль справа.
 *
 * Раньше это были два из трёх сегментов нижней панели. Панель ушла целиком —
 * низ экрана занят шторкой заявки, и делить его между навигацией и главным
 * действием значит отнимать место у обоих.
 *
 * Плашки лежат поверх содержимого, а не в потоке: колода — это «карта»
 * приложения, она должна занимать весь экран между шапкой клиента Telegram и
 * шторкой. Углы экрана над картой при этом свободны, и разделы, в которые
 * заходят изредка, живут именно там.
 *
 * Слева — то, что рассказывает о состоянии отдела (как индикатор загруженности
 * в такси), справа — про себя. Порядок не декоративный: левый угол ближе к
 * началу чтения, и раздел «чем занят отдел» отвечает на вопрос, который
 * возникает до вопроса «а что у меня».
 */
export function TopBar() {
  return (
    <nav className="topbar" aria-label="Разделы">
      <Link href={routes.feed} className="pill">
        <PulseIcon />
        <span>Задачи</span>
      </Link>
      <Link href={routes.myRequests} className="pill">
        <PersonIcon />
        <span>Профиль</span>
      </Link>
    </nav>
  );
}

function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 13h4l2.5-6 3.5 12 2.5-6H21"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.5" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M4.8 20c.6-3.6 3.6-5.5 7.2-5.5s6.6 1.9 7.2 5.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
