"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { routes } from "@/config/navigation";
import { askMyRequests } from "@/features/requests/submit";
import { useViewer } from "@/hooks/use-viewer";
import { exchangeSession, fetchMyRequests } from "@/lib/client/api";
import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Профиль: кто ты для отдела и что у тебя открыто.
 *
 * Имя приходит из нескольких мест (см. `readViewer`), потому что клиенты
 * Telegram отдают данные запуска непредсказуемо. Заявки — из своего API,
 * который проверяет подпись запуска и читает реестр формы Pyrus по
 * Telegram-id: без проверки любой запросил бы чужие заявки, а ключ Pyrus в
 * браузере жить не может.
 *
 * Если API недоступен (статическая сборка под GitHub Pages, нет сети, клиент
 * не дал данных запуска), экран не ломается: объясняет это словами и оставляет
 * рабочий путь — попросить список у бота в чат.
 */
type State =
  | { kind: "loading" }
  | { kind: "ready"; requests: PyrusRequest[] }
  | { kind: "unavailable" };

export function ProfileScreen() {
  const viewer = useViewer();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Обмен данных запуска на токен: он и подтверждает вход, и переживает
      // то, что клиент в следующий раз отдаст пустой initData.
      await exchangeSession();
      const requests = await fetchMyRequests();
      if (!alive) return;
      setState(requests ? { kind: "ready", requests } : { kind: "unavailable" });
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="scroll">
      <section className="profile">
        <div className="avatar" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M4.5 20c.6-3.7 3.7-5.6 7.5-5.6s6.9 1.9 7.5 5.6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="profile-who">
          {/* Пустая строка держит высоту, чтобы заголовок не прыгал после
              гидратации. */}
          <h1>{viewer ? viewer.name : " "}</h1>
          <p>{viewer?.handle ?? "Отдел вычислительного проектирования"}</p>
        </div>
      </section>

      {viewer && !viewer.inTelegram ? (
        <div className="banner banner-quiet">
          <strong>Открыто вне Telegram</strong>
          <span>Имя и отправка заявок работают только при запуске из бота</span>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>Мои заявки</h2>
          {state.kind === "ready" && state.requests.length > 0 ? (
            <span className="count">{state.requests.length}</span>
          ) : null}
        </div>

        {state.kind === "loading" ? (
          <p className="section-note">Загружаем заявки из Pyrus…</p>
        ) : null}

        {state.kind === "ready" && state.requests.length > 0 ? (
          <div className="rows">
            {state.requests.map((request) => (
              <article key={request.taskId} className="card">
                <div className="row-meta">
                  {request.number ? (
                    <span className="row-dim">№ {request.number}</span>
                  ) : null}
                  <span className={request.closed ? "tag" : "tag tag-work"}>
                    {request.closed ? "Завершена" : "В работе"}
                  </span>
                  {request.deadline ? (
                    <span className="row-dim">срок {request.deadline}</span>
                  ) : null}
                </div>
                <h3>{request.topic ?? "Заявка"}</h3>
                {request.project ? <p className="row-dim">{request.project}</p> : null}
                {request.origin ? <p className="row-dim">{request.origin}</p> : null}
              </article>
            ))}
          </div>
        ) : null}

        {state.kind === "ready" && state.requests.length === 0 ? (
          <div className="empty">
            <p>
              Заявок пока нет. Создайте её из темы или из готового решения — так
              у отдела сразу будет контекст.
            </p>
          </div>
        ) : null}

        {state.kind === "unavailable" ? (
          <div className="empty">
            <p>
              Список заявок сейчас недоступен: приложение не смогло подтвердить
              вход. Бот покажет заявки в чате — там та же выборка.
            </p>
          </div>
        ) : null}

        <div className="rows" style={{ marginTop: "var(--s3)" }}>
          {/* Запасной путь, он же самый надёжный: приложение закроется, и
              список придёт сообщением в чат. */}
          <button type="button" className="row-action" onClick={askMyRequests}>
            <span>Показать мои заявки в чате</span>
            <span aria-hidden="true">→</span>
          </button>
          <Link href={routes.feed} className="row-action">
            <span>Посмотреть, что делает отдел</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
