"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Chevron } from "@/components/ui/chevron";
import { routes } from "@/config/navigation";
import { askMyRequests } from "@/features/requests/submit";
import { useViewer } from "@/hooks/use-viewer";
import {
  exchangeSession,
  fetchMyRequests,
  loginTrace,
  type LoginTrace,
} from "@/lib/client/api";
import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Профиль: кто ты для отдела и что у тебя открыто.
 *
 * Имя может прийти из адреса кнопки (см. `readViewer`), а заявки — только по
 * подтверждённой сессии. Отсюда неочевидное состояние: имя показано, а список
 * пуст. Экран его не скрывает: разница между «вход не подтверждён» и «заявок
 * нет» решается по-разному, и человек должен видеть, какая из двух ситуаций.
 *
 * Заявки идут через своё API, которое проверяет подпись и читает реестр формы
 * Pyrus по Telegram-id: без проверки любой запросил бы чужие заявки, а ключ
 * Pyrus в браузере жить не может.
 */
type State =
  | { kind: "loading" }
  | { kind: "ready"; requests: PyrusRequest[] }
  | { kind: "unavailable" };

type SessionUser = { name: string; handle: string | null };

/**
 * Что сказать человеку, когда вход не подтвердился.
 *
 * Причины разные, а действия — тоже разные, поэтому одна фраза «ошибка входа»
 * здесь бесполезна.
 */
function loginProblem(trace: LoginTrace | null): { title: string; hint: string } | null {
  if (!trace) return null;
  if (trace.hadCode && trace.redeemStatus === 401) {
    return {
      title: "Кнопка в чате устарела",
      hint: "Отправьте боту /start и откройте приложение свежей кнопкой — вход обновится.",
    };
  }
  if (!trace.hadCode && trace.initDataLength === 0) {
    return {
      title: "Открыто вне Telegram",
      hint: "Заявки и загрузка картинок работают только при запуске кнопкой из бота @comp_design_bot.",
    };
  }
  return {
    title: "Вход не подтверждён",
    hint: "Попробуйте закрыть приложение и открыть его кнопкой из чата бота.",
  };
}

export function ProfileScreen() {
  const viewer = useViewer();
  const [state, setState] = useState<State>({ kind: "loading" });
  // Имя из подтверждённой сессии — самое достоверное: его подписал бот или
  // Telegram, а не подставил адрес кнопки.
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [trace, setTrace] = useState<LoginTrace | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Обмен данных запуска на токен: он и подтверждает вход, и переживает
      // то, что клиент в следующий раз отдаст пустой initData.
      const session = await exchangeSession();
      if (alive && session?.user) {
        setSessionUser({ name: session.user.name, handle: session.user.handle });
      }
      const requests = await fetchMyRequests();
      if (!alive) return;
      setState(requests ? { kind: "ready", requests } : { kind: "unavailable" });
      setTrace(loginTrace());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const problem = sessionUser ? null : loginProblem(trace);

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
          <h1>{sessionUser?.name ?? viewer?.name ?? " "}</h1>
          <p>
            {sessionUser?.handle ??
              viewer?.handle ??
              "Отдел вычислительного проектирования"}
          </p>
        </div>
      </section>

      {problem ? (
        <div className="banner">
          <strong>{problem.title}</strong>
          <span>{problem.hint}</span>
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
                  {/* Статус заявки ведётся в чате отдела, в Pyrus уходит
                      только закрытие — поэтому здесь ровно два состояния. */}
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
            <Chevron />
          </button>
          <Link href={routes.feed} className="row-action">
            <span>Посмотреть, что делает отдел</span>
            <Chevron />
          </Link>
        </div>

        {/* Диагностика входа. Свёрнута и показывается только когда что-то не
            сошлось: без этих фактов «приложение меня не видит» неотличимо от
            «истёк код», «пустой initData» и «заблокировано хранилище», а
            спрашивать человека об этом словами бессмысленно. */}
        {trace && (problem || state.kind === "unavailable") ? (
          <details className="diag">
            <summary>Почему вход не сработал</summary>
            <dl>
              <div>
                <dt>Код из кнопки</dt>
                <dd>{trace.hadCode ? "есть" : "нет"}</dd>
              </div>
              <div>
                <dt>Обмен кода</dt>
                <dd>{trace.redeemStatus ?? "не выполнялся"}</dd>
              </div>
              <div>
                <dt>Данные запуска</dt>
                <dd>
                  {trace.initDataLength > 0
                    ? `${trace.initDataLength} символов`
                    : "клиент не отдал"}
                </dd>
              </div>
              <div>
                <dt>Обмен данных запуска</dt>
                <dd>{trace.exchangeStatus ?? "не выполнялся"}</dd>
              </div>
              <div>
                <dt>Токен</dt>
                <dd>{trace.tokenPresent ? "получен" : "нет"}</dd>
              </div>
              <div>
                <dt>Хранилище браузера</dt>
                <dd>
                  {trace.storageAvailable === null
                    ? "не проверялось"
                    : trace.storageAvailable
                      ? "доступно"
                      : "заблокировано"}
                </dd>
              </div>
              {trace.error ? (
                <div>
                  <dt>Сообщение</dt>
                  <dd>{trace.error}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        ) : null}
      </section>
    </div>
  );
}
