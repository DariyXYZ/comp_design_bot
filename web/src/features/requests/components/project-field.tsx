"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { routes } from "@/config/navigation";
import { fetchFeed, type FeedTask } from "@/lib/client/api";
import { BOARD_STATUS } from "@/lib/board-status";

/**
 * Поле «Проект» с подсказкой из справочника проектов бюро.
 *
 * Зачем: один проект в свободном тексте пишут по-разному («1-19-2026 МР
 * Верейская БЦ» / «1-19-2026 мр верейская бц» / «Верейская»), и на доске
 * Pyrus это три разных проекта. Подсказка ведёт к каноническому названию из
 * общего справочника Pyrus, а совпавшее название подтягивает id позиции —
 * бот запишет его в поле-справочник, и задача свяжется с проектом, а не с
 * похожей строкой.
 *
 * Свободный ввод остаётся: проекта может ещё не быть в справочнике. Тогда
 * уходит только текст, id пустой.
 */
export type ProjectOption = { id: number; name: string };

type Props = {
  value: string;
  onChange: (name: string, id: string) => void;
};

const MAX_SHOWN = 6;

/** Ключ сравнения: регистр, ё/е, подчёркивания и лишние пробелы не в счёт. */
export function normalizeProject(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Подходящие позиции: сначала те, что начинаются с ввода, затем содержащие. */
export function matchProjects(options: readonly ProjectOption[], query: string): ProjectOption[] {
  const q = normalizeProject(query);
  if (!q) return [];
  const starts: ProjectOption[] = [];
  const contains: ProjectOption[] = [];
  for (const option of options) {
    const name = normalizeProject(option.name);
    if (name.startsWith(q)) starts.push(option);
    else if (name.includes(q)) contains.push(option);
    if (starts.length >= MAX_SHOWN) break;
  }
  return [...starts, ...contains].slice(0, MAX_SHOWN);
}

/** Позиция, совпадающая с вводом целиком (с точностью до normalizeProject). */
export function exactProject(
  options: readonly ProjectOption[],
  query: string,
): ProjectOption | undefined {
  const q = normalizeProject(query);
  if (!q) return undefined;
  return options.find((option) => normalizeProject(option.name) === q);
}

/** Номер проекта в начале названия — «1-19-2026» — общий для всех написаний. */
export function projectNumber(text: string): string | null {
  const match = /^\s*(\d+)[-_ ](\d+)[-_ ](\d{4})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Задачи отдела по тому же проекту — проверка на дубликат. Сравнение по
 * номеру проекта, если он есть: одно и то же здание пишут по-разному, а номер
 * у него один. Без номера — по нормализованному названию целиком.
 */
export function sameProjectTasks(tasks: readonly FeedTask[], query: string): FeedTask[] {
  const number = projectNumber(query);
  const q = normalizeProject(query);
  if (!number && q.length < 4) return [];
  return tasks.filter((task) => {
    if (!task.project) return false;
    if (number) return projectNumber(task.project) === number;
    return normalizeProject(task.project) === q;
  });
}

let cache: Promise<ProjectOption[]> | null = null;

/** Справочник грузится один раз за сессию — он общий для всех заявок. */
function loadProjects(): Promise<ProjectOption[]> {
  if (!cache) {
    cache = fetch("/api/projects")
      .then((response) => (response.ok ? response.json() : { projects: [] }))
      .then((body: { projects?: ProjectOption[] }) => body.projects ?? [])
      .catch(() => {
        cache = null;
        return [];
      });
  }
  return cache;
}

export function ProjectField({ value, onChange }: Props) {
  const [options, setOptions] = useState<readonly ProjectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [feed, setFeed] = useState<readonly FeedTask[]>([]);
  const listId = useId();
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void loadProjects().then((loaded) => {
      if (alive) setOptions(loaded);
    });
    // Лента нужна проверке на дубликат — читается один раз, как и справочник.
    void fetchFeed().then((tasks) => {
      if (alive && tasks) setFeed(tasks);
    });
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => matchProjects(options, value), [options, value]);
  const shown = open && matches.length > 0;
  const duplicates = useMemo(() => sameProjectTasks(feed, value), [feed, value]);
  const openDuplicates = duplicates.filter(
    (task) => task.status !== BOARD_STATUS.done && task.status !== BOARD_STATUS.rejected,
  );

  function pick(option: ProjectOption) {
    onChange(option.name, String(option.id));
    setOpen(false);
    setActive(-1);
  }

  function commitTyped() {
    // Ушли с поля: точное совпадение подменяется каноническим написанием —
    // человек мог набрать всё строчными, а в Pyrus уйдёт как в справочнике.
    const exact = exactProject(options, value);
    if (exact && (exact.name !== value || !value)) onChange(exact.name, String(exact.id));
    setOpen(false);
    setActive(-1);
  }

  return (
    <label className="field project-field">
      <span>Номер и название проекта</span>
      <input
        type="text"
        value={value}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          const text = e.target.value;
          const exact = exactProject(options, text);
          onChange(text, exact ? String(exact.id) : "");
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Тап по подсказке приходит после blur — даём ему сработать.
          blurTimer.current = window.setTimeout(commitTyped, 150);
        }}
        onKeyDown={(e) => {
          if (!shown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="1-19-2026 MR Group АГК БЦ Верейская"
        enterKeyHint="next"
      />
      {!shown && duplicates.length > 0 ? (
        // Не запрет — подсказка: по этому проекту отдел уже что-то делает или
        // делал. Человек сам решит, дубль это или новая задача.
        <span className="field-note">
          По этому проекту {openDuplicates.length ? "уже в работе" : "уже делали"}:{" "}
          {(openDuplicates.length ? openDuplicates : duplicates)
            .slice(0, 2)
            .map((task) => task.topic ?? "заявка")
            .join(", ")}
          {duplicates.length > 2 ? ` и ещё ${duplicates.length - 2}` : ""} —{" "}
          <Link href={routes.feed}>посмотреть в задачах</Link>
        </span>
      ) : null}
      {shown && (
        <ul className="suggest" id={listId} role="listbox">
          {matches.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? "active" : undefined}
                onMouseDown={(e) => {
                  // mousedown раньше blur у поля: выбор не отменяется закрытием.
                  e.preventDefault();
                  if (blurTimer.current) window.clearTimeout(blurTimer.current);
                  pick(option);
                }}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
