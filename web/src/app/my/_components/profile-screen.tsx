"use client";

import Link from "next/link";
import { routes } from "@/config/navigation";
import { MY_REQUESTS, StageTrack } from "@/features/requests";
import { useViewer } from "@/hooks/use-viewer";
import { askMyRequests } from "@/features/requests/submit";
import { myRequestHref } from "@/config/navigation";

/**
 * Профиль: кто ты для отдела и что у тебя открыто.
 *
 * Имя приходит из Telegram только в браузере (см. `useViewer`), поэтому до
 * гидратации его нет — заголовок держит высоту заранее.
 *
 * Списка заявок здесь пока нет по честной причине: чтобы показать заявки
 * конкретного человека, нужно проверить подпись `initData`, а это серверный
 * код, которого у статического Mini App не бывает. Пока список живёт в чате
 * бота, и экран ведёт туда, а не показывает выдуманные карточки.
 */
export function ProfileScreen() {
  const viewer = useViewer();

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

      {MY_REQUESTS.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>Мои заявки</h2>
            <span className="count">{MY_REQUESTS.length}</span>
          </div>
          <div className="rows">
            {MY_REQUESTS.map((request) => (
              <Link key={request.id} href={myRequestHref(request.id)} className="card">
                <div className="row-meta">
                  <span className="row-dim">№ {request.id.replace("r-", "")}</span>
                  {request.flag ? (
                    <span className="tag tag-flag">{request.flag}</span>
                  ) : null}
                </div>
                <h3>{request.title}</h3>
                <p className="row-dim">{request.originLabel}</p>
                <p className="row-dim">{request.project}</p>
                <StageTrack stage={request.stage} />
                <p className="row-dim">{request.when}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="section-head">
            <h2>Мои заявки</h2>
          </div>
          <div className="empty">
            <p>
              Список заявок и статусы присылает бот в чат — здесь их пока нет:
              чтобы показать заявки именно ваши, нужна проверка подписи
              запуска, то есть серверная часть.
            </p>
          </div>
          <div className="rows" style={{ marginTop: "var(--s3)" }}>
            {/* Приложение закроется, и список придёт сообщением в чат — там же,
                где человек и так общается с ботом. */}
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
      )}
    </div>
  );
}
