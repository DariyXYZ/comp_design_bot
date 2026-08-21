import type { Case } from "./deck-math";

/**
 * Кейсы читаются через свой роут `/api/topics`, а тот — из Supabase (таблица
 * `cases`, единый источник с ботом `bot/texts.py`). Контент правится в
 * дашборде Supabase, не в коде.
 *
 * Через сервер, а не напрямую: ключ Supabase остаётся на сервере и не едет в
 * бандл. Заодно исчезает необходимость в публичных копиях переменных —
 * `NEXT_PUBLIC_*` подставляются на этапе сборки, и любая опечатка в имени
 * оставляла приложение без данных.
 */

/** Строка таблицы `cases` как её отдаёт Supabase REST. */
type CaseRow = {
  key: string;
  title: string;
  hint: string;
  eta: string;
  image_front: string;
  image_back: string | null;
};

export function toCases(rows: readonly CaseRow[]): Case[] {
  return rows.map((r) => ({
    key: r.key,
    title: r.title,
    hint: r.hint,
    eta: `⏱ ${r.eta}`,
    frontImg: r.image_front,
    backImg: r.image_back || null,
  }));
}

/**
 * Забирает карточки кейсов.
 *
 * Кеширование намеренно отключено (`no-store`): контент правят в дашборде
 * Supabase и ждут, что Mini App покажет правку при следующем открытии.
 * Запрос уходит из браузера на каждое открытие — данных мало (8 строк).
 *
 * Бросает исключение, если сети нет, Supabase ответил не 2xx или таблица
 * пуста — вызывающий показывает запасной экран.
 */
export async function fetchCases(
  { signal }: { signal?: AbortSignal } = {},
): Promise<Case[]> {
  const res = await fetch("/api/topics/", { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as { rows?: CaseRow[] };
  const rows = body.rows ?? [];
  if (!rows.length) throw new Error("Карточки не пришли");

  return toCases(rows);
}
