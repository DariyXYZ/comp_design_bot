"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_ROUTES, isSameRoute, routes } from "@/lib/routes";

type Tab = {
  href: string;
  label: string;
  icon: () => React.ReactElement;
};

/**
 * Порядок неслучаен: колода тем — центральный экран и главный вход, поток
 * задач слева, профиль справа. Центр в нижней навигации ближе всего к большому
 * пальцу, и именно там должно лежать то, ради чего приложение открывают.
 */
const TABS: readonly Tab[] = [
  { href: routes.feed, label: "Поток", icon: PulseIcon },
  { href: routes.topics, label: "Темы", icon: DeckIcon },
  { href: routes.myRequests, label: "Профиль", icon: PersonIcon },
];

/**
 * Нижняя навигация трёх разделов.
 *
 * Материал, форма заявки и карточка заявки — вложенные экраны: там навигации
 * нет, а есть «назад». Иначе на вложенном экране два конкурирующих способа
 * уйти назад, и пользователь теряет место в потоке.
 *
 * Панель живёт в обычном потоке, а не `position:fixed`, специально: колода
 * считает свободную высоту замером `.deck-wrap` (см. `sizeCard`), и панель,
 * вынутая из потока, съела бы карточку, не изменив замер.
 */
export function TabBar() {
  const pathname = usePathname();
  const onTabScreen = TAB_ROUTES.some((route) => isSameRoute(pathname, route));
  if (!onTabScreen) return null;

  return (
    <nav className="tabbar" aria-label="Разделы">
      {TABS.map((tab) => {
        const active = isSameRoute(pathname, tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "tab on" : "tab"}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function DeckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="6.5"
        y="3.5"
        width="11"
        height="17"
        rx="2.6"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M3.5 7.5v9M20.5 7.5v9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 13h4l2.5-6 3.5 12 2.5-6H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4.8 20c.6-3.6 3.6-5.5 7.2-5.5s6.6 1.9 7.2 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
