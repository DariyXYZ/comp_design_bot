import { env } from "@/config/env";
import type { Case } from "./deck-math";

/**
 * Кейсы читаются из Supabase (таблица `cases`) — единый источник с ботом
 * (bot/texts.py), чтобы не редактировать одно и то же в двух местах.
 * Контент правится в дашборде Supabase, не в коде.
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

const QUERY =
  "cases?select=key,title,hint,eta,image_front,image_back&order=sort_order";

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
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${QUERY}`, {
    signal,
    cache: "no-store",
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${env.supabaseAnonKey}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const rows = (await res.json()) as CaseRow[];
  if (!rows.length) throw new Error("Таблица cases пуста");

  return toCases(rows);
}
