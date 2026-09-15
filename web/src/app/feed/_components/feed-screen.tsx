"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Screen } from "@/components/layout/screen";
import { PathField } from "@/components/ui/path-field";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { requestHref, routes } from "@/config/navigation";
import { StatusTag } from "@/features/requests/components/status-tag";
import { BOARD_STATUS } from "@/lib/board-status";
import { fetchFeed, toggleWatch, type FeedTask } from "@/lib/client/api";
import { haptic } from "@/lib/client/telegram";
import { plural } from "@/lib/plural";

/**
 * Поток отдела: доска Pyrus в виде ленты.
 *
 * Строки приходят из задач и никем не оформляются: тема, проект, суть,
 * колонка доски, дата, обложка из вложений и путь к файлам. Порядок — как на
 * доске: сначала то, что ждёт (новые и уточнение), потом в работе, потом
 * сделанное и отклонённое.
 *
 * «Следить» — подписка на чужую задачу: уведомления о смене статуса приходят
 * в чат с ботом. Подписка живёт в самой задаче Pyrus комментарием.
 */

const ORDER = [
  BOARD_STATUS.new,
  BOARD_STATUS.clarify,
  BOARD_STATUS.work,
  BOARD_STATUS.done,
  BOARD_STATUS.rejected,
] as const;

const TITLE: Record<string, string> = {
  [BOARD_STATUS.new]: "Ждут очереди",
  [BOARD_STATUS.clarify]: "Ждут уточнения",
  [BOARD_STATUS.work]: "Сейчас в работе",
  [BOARD_STATUS.done]: "Сделано",
  [BOARD_STATUS.rejected]: "Отклонено",
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; tasks: FeedTask[] }
  | { kind: "failed" };

export function FeedScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (force = false) => {
    const tasks = await fetchFeed(force);
    setState(tasks ? { kind: "ready", tasks } : { kind: "failed" });
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const tasks = state.kind === "ready" ? state.tasks : [];
  const inWork = tasks.filter((task) => task.status === BOARD_STATUS.work).length;
  const waiting = tasks.filter(
    (task) => task.status === BOARD_STATUS.new || task.status === BOARD_STATUS.clarify,
  ).length;

  return (
    <Screen
      title="Задачи отдела"
      subtitle="Доска отдела: что ждёт, что в работе, что сделано"
      backHref={routes.topics}
    >
      {state.kind === "ready" ? (
        <div className="load-line">
          <strong>{inWork + waiting > 6 ? "Очередь есть" : "Берём новые задачи"}</strong>
          <span>
            {inWork} {plural(inWork, ["задача", "задачи", "задач"])} в работе
            {waiting ? ` · ${waiting} ${plural(waiting, ["ждёт", "ждут", "ждут"])}` : ""}
          </span>
        </div>
      ) : null}

      {state.kind === "loading" ? (
        <p className="section-note">Читаем доску отдела…</p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="section-note">Доска не ответила. Потяните экран или откройте позже.</p>
      ) : null}

      {state.kind === "ready"
        ? ORDER.map((status) => {
            const rows = tasks.filter((task) => task.status === status);
            if (!rows.length) return null;
            return (
              <section className="section" key={status}>
                <div className="section-head">
                  <h2>{TITLE[status]}</h2>
                  <span className="count">{rows.length}</span>
                </div>
                <div className="rows">
                  {rows.map((task) => (
                    <FeedRow
                      key={task.taskId}
                      task={task}
                      onWatched={(watching) =>
                        setState((current) =>
                          current.kind === "ready"
                            ? {
                                kind: "ready",
                                tasks: current.tasks.map((t) =>
                                  t.taskId === task.taskId ? { ...t, watching } : t,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })
        : null}

      <p className="feed-foot">
        Заявка создаётся из темы или из готового материала — так у неё сразу
        есть контекст. Если задача ни на что не похожа:{" "}
        <Link
          href={requestHref({
            topic: "custom",
            topicTitle: "Нетиповая или разовая задача",
          })}
        >
          нетиповая задача
        </Link>
        .
      </p>
    </Screen>
  );
}

function when(task: FeedTask): string {
  const iso = task.closed ? (task.closedAt ?? task.created) : task.created;
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function FeedRow({
  task,
  onWatched,
}: Readonly<{ task: FeedTask; onWatched: (watching: boolean) => void }>) {
  const [busy, setBusy] = useState(false);

  async function watch() {
    if (busy) return;
    setBusy(true);
    const result = await toggleWatch(task.taskId);
    setBusy(false);
    if (result === null) {
      haptic("error");
      return;
    }
    haptic("success");
    onWatched(result);
  }

  return (
    <article className="feed-card">
      {task.hasCover ? (
        // Обложка — во всю ширину строки: это вид проекта, в узком превью от
        // него оставалась бы вертикальная полоска. Файл идёт через наш сервер
        // (ключ Pyrus в браузер не попадает).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="feed-cover"
          src={`/api/feed/${task.taskId}/cover/`}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <div className="feed-top">
        {task.hasCover ? null : (
          <div className="row-thumb">
            <ScriptGlyph className="glyph" />
          </div>
        )}
        <div className="row-text">
          <div className="row-meta">
            <StatusTag request={task} />
            {task.watching ? <span className="tag tag-watch">Вы следите</span> : null}
            {when(task) ? <span className="row-dim">{when(task)}</span> : null}
          </div>
          {/* Задачи, заведённые отделом прямо на доске, темы не имеют — у них
              название и есть суть. */}
          <h3>{task.topic ?? task.excerpt ?? "Задача"}</h3>
          {task.project ? <p className="row-project">{task.project}</p> : null}
          {task.topic && task.excerpt ? <p>{task.excerpt}</p> : null}
        </div>
      </div>
      {task.source ? <PathField path={task.source} /> : null}
      {task.closed ? null : (
        <button
          type="button"
          className={`feed-watch${task.watching ? " on" : ""}`}
          disabled={busy}
          onClick={() => void watch()}
        >
          {task.watching ? "Не следить" : "Следить за задачей"}
        </button>
      )}
    </article>
  );
}
