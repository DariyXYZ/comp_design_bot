"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionBar } from "@/components/layout/action-bar";
import { Screen } from "@/components/layout/screen";
import { routes } from "@/config/navigation";
import { RESTART_HINT } from "@/config/copy";
import { MESSAGE_LIMIT, type RequestAction } from "@/features/requests/actions";
import { actOnRequest, fetchRequest } from "@/lib/client/api";
import { askLeave, setLeaveGuard } from "@/lib/client/leave-guard";
import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Заявка целиком: что в ней написано и что с ней можно сделать.
 *
 * Действий по вайрфрейму было шесть, но пять из них — одно и то же: написать в
 * разговор по заявке. Поэтому здесь одно поле ввода и главная кнопка «отправить
 * отделу», а приёмка результата и отмена — отдельные строки, и появляются они
 * только когда уместны: принимать нечего, пока работа не закрыта, а отменять
 * нечего, когда она уже закрыта.
 *
 * Всё уходит двумя адресами сразу (комментарий в задачу Pyrus и сообщение в
 * ветку чата отдела) — см. `features/requests/actions`.
 */
/**
 * «Не найдена» покрывает и чужую заявку, и отсутствующую, и неподтверждённый
 * вход — роут отвечает на них одинаково специально, чтобы перебором номеров
 * нельзя было узнать, какие заявки существуют.
 */
type State =
  | { kind: "loading" }
  | { kind: "ready"; request: PyrusRequest }
  | { kind: "missing" };

export function RequestCard() {
  const taskId = Number(useSearchParams().get("id") ?? "");
  // Битую ссылку видно сразу, до всякой загрузки — и начальное состояние
  // должно это отражать, иначе экран мигает «загружаем» ни для чего.
  const valid = Number.isInteger(taskId) && taskId > 0;
  const [state, setState] = useState<State>(valid ? { kind: "loading" } : { kind: "missing" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Набранный, но не отправленный текст — то же, что в форме новой заявки:
  // уходить с ним молча нельзя.
  const textRef = useRef("");

  const load = useCallback(async () => {
    if (!valid) return;
    const found = await fetchRequest(taskId);
    setState(found ? { kind: "ready", request: found } : { kind: "missing" });
  }, [taskId, valid]);

  useEffect(() => {
    // Обёртка не для красоты: правило react-hooks считает прямой вызов
    // загрузчика синхронным setState в эффекте, а нам нужно именно
    // «сходить в сеть, потом показать».
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    setLeaveGuard(() => textRef.current.trim().length > 0);
    return () => setLeaveGuard(null);
  }, []);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  async function act(action: RequestAction) {
    if (busy) return;
    setProblem(null);
    setDone(null);
    setBusy(true);
    const ok = await actOnRequest(taskId, action, text);
    setBusy(false);
    if (!ok) {
      setProblem(
        `Не отправилось. Проверьте связь и попробуйте ещё раз. ${RESTART_HINT}`,
      );
      return;
    }
    setText("");
    textRef.current = "";
    setDone(DONE_NOTE[action]);
    // Состояние задачи могло измениться (доработка её переоткрывает, отмена
    // закрывает) — перечитываем, а не догадываемся.
    await load();
  }

  if (state.kind === "loading") {
    return (
      <Screen title="Заявка" backHref={routes.myRequests}>
        <p className="section-note">Загружаем заявку из Pyrus…</p>
      </Screen>
    );
  }

  if (state.kind !== "ready") {
    return (
      <Screen title="Заявка не найдена" backHref={routes.myRequests}>
        <p className="section-note">
          Заявка не открылась: ссылка устарела, заявка чужая или вход не
          подтверждён. Вернитесь к списку и откройте её заново. {RESTART_HINT}
        </p>
      </Screen>
    );
  }

  const request = state.request;
  const ready = text.trim().length > 0;

  return (
    <>
      <Screen
        title={request.topic ?? "Заявка"}
        subtitle={subtitleFor(request)}
        backHref={routes.myRequests}
      >
        <div className="row-meta">
          <span className={request.closed ? "tag" : "tag tag-work"}>
            {request.closed ? "Завершена" : "В работе"}
          </span>
          {request.deadline ? (
            <span className="row-dim">срок {request.deadline}</span>
          ) : null}
        </div>

        {request.description ? <p className="lead">{request.description}</p> : null}

        {request.project ? (
          <div className="fact">
            <span className="fact-key">Проект</span>
            <span className="fact-value">{request.project}</span>
          </div>
        ) : null}
        {request.origin ? (
          <div className="fact">
            <span className="fact-key">Заявка по</span>
            <span className="fact-value">{request.origin}</span>
          </div>
        ) : null}

        {done ? (
          <div className="banner banner-quiet">
            <strong>{done}</strong>
            <span>Отдел увидит это в чате, а запись останется в задаче</span>
          </div>
        ) : null}

        {problem ? (
          <div className="banner">
            <strong>Не отправлено</strong>
            <span>{problem}</span>
          </div>
        ) : null}

        <label className="field">
          <span>Написать по заявке</span>
          <textarea
            rows={4}
            value={text}
            maxLength={MESSAGE_LIMIT}
            onChange={(e) => setText(e.target.value)}
            placeholder="Дополнить задачу, задать вопрос, уточнить сроки"
          />
        </label>

        {request.closed ? (
          <section className="section">
            <div className="section-head">
              <h2>Результат</h2>
            </div>
            <div className="rows">
              <button
                type="button"
                className="row-action"
                disabled={busy}
                onClick={() => void act("accept")}
              >
                <span>Принять результат</span>
                <span aria-hidden="true">✓</span>
              </button>
              <button
                type="button"
                className="row-action"
                disabled={busy}
                onClick={() => {
                  // Доработка без объяснения бесполезна: отдел не поймёт, что
                  // переделывать, и всё равно придёт спрашивать в чат.
                  if (!ready) {
                    setProblem("Напишите, что нужно переделать — иначе отдел спросит сам.");
                    return;
                  }
                  void act("rework");
                }}
              >
                <span>Вернуть на доработку</span>
                <span aria-hidden="true">↺</span>
              </button>
            </div>
          </section>
        ) : (
          <section className="section">
            <div className="rows">
              <button
                type="button"
                className="row-action"
                disabled={busy}
                onClick={() => {
                  void askLeave().then((confirmed) => {
                    // Тот же вопрос, что при уходе с формы: отмена закрывает
                    // задачу, и случайный тап тут дороже всего на экране.
                    if (confirmed) void act("cancel");
                  });
                }}
              >
                <span>Отменить заявку</span>
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </section>
        )}
      </Screen>

      <ActionBar
        label={busy ? "Отправляем…" : "Отправить отделу"}
        note={ready ? undefined : "Напишите сообщение — оно уйдёт в чат отдела"}
        onClick={() => void act("note")}
        disabled={!ready || busy}
      />
    </>
  );
}

const DONE_NOTE: Record<RequestAction, string> = {
  note: "Сообщение отправлено",
  accept: "Результат принят",
  rework: "Возвращена на доработку",
  cancel: "Заявка отменена",
};

function subtitleFor(request: PyrusRequest): string | undefined {
  const parts: string[] = [];
  if (request.number) parts.push(`№ ${request.number}`);
  if (request.created) {
    // Дата из Pyrus приходит в ISO — показываем коротко и по-русски.
    const date = new Date(request.created);
    if (!Number.isNaN(date.valueOf())) {
      parts.push(
        date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
      );
    }
  }
  return parts.length ? parts.join(" · ") : undefined;
}
