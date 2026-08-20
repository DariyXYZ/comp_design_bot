"use client";

import Link from "next/link";
import { myRequestHref } from "@/config/navigation";
import { MY_REQUESTS, StageTrack } from "@/features/requests";
import { useViewer } from "@/hooks/use-viewer";

/**
 * Профиль: кто ты для отдела и что у тебя открыто.
 *
 * Имя приходит из Telegram только в браузере (см. `useViewer`), поэтому до
 * гидратации его нет — заголовок держит высоту заранее, чтобы не дёргать
 * вёрстку.
 *
 * Отслеживаемые задачи отдела вынесены в отдельную секцию: это не свои заявки,
 * и мешать их со своими в одном списке — врать про принадлежность.
 */
export function ProfileScreen() {
  const viewer = useViewer();

  const own = MY_REQUESTS.filter((r) => !r.watching);
  const watched = MY_REQUESTS.filter((r) => r.watching);
  const needsAnswer = own.filter((r) => r.flag === "Требуется уточнение").length;

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
          {/* До эффекта имени ещё нет — пустая строка держит высоту, чтобы
              заголовок не прыгал после гидратации. */}
          <h1>{viewer ? viewer.name : " "}</h1>
          <p>{viewer?.handle ?? "Отдел вычислительного проектирования"}</p>
        </div>
      </section>

      {viewer && !viewer.inTelegram ? (
        <div className="banner banner-quiet">
          <strong>Открыто вне Telegram</strong>
          <span>Имя и свои заявки видны только при запуске из бота</span>
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <strong>{own.length}</strong>
          <span>мои заявки</span>
        </div>
        {/* Единственная цифра, за которой стоит действие пользователя, — она и
            единственная цветная. */}
        <div className={needsAnswer > 0 ? "stat stat-attention" : "stat"}>
          <strong>{needsAnswer}</strong>
          <span>ждут ответа</span>
        </div>
        <div className="stat">
          <strong>{watched.length}</strong>
          <span>отслеживаю</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Мои заявки</h2>
          <span className="count">{own.length}</span>
        </div>
        <div className="rows">
          {own.map((request) => (
            <Link key={request.id} href={myRequestHref(request.id)} className="card">
              <div className="row-meta">
                <span className="row-dim">№ {request.id.replace("r-", "")}</span>
                {request.flag ? <span className="tag tag-flag">{request.flag}</span> : null}
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

      {watched.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2>Отслеживаю</h2>
            <span className="count">{watched.length}</span>
          </div>
          <div className="rows">
            {watched.map((request) => (
              <Link key={request.id} href={myRequestHref(request.id)} className="card">
                <div className="row-meta">
                  <span className="tag tag-watch">Задача отдела</span>
                </div>
                <h3>{request.title}</h3>
                <p className="row-dim">{request.project}</p>
                <StageTrack stage={request.stage} />
                <p className="row-dim">{request.when}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
