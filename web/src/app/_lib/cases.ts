import type { Case } from "./deck-math";

/**
 * Кейсы читаются через свой роут `/api/topics`; сами карточки лежат в коде
 * (`features/topics/data.ts`), правка — коммит. Роут оставлен, чтобы не менять
 * клиент, и кэширует ответ.
 */

/** Карточка темы — см. `features/topics/data.ts`. */
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
/**
 * Карточки, уже полученные в этой сессии.
 *
 * Экран тем открывают несколько раз за посещение (туда-обратно из профиля и
 * потока), и каждый повторный запрос было видно глазом. Данные меняются
 * редко, поэтому в пределах одной сессии хватает одного похода за ними.
 */
let cached: Case[] | null = null;

export async function fetchCases(
  { signal }: { signal?: AbortSignal } = {},
): Promise<Case[]> {
  if (cached) return cached;

  const res = await fetch("/api/topics/", { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as { rows?: CaseRow[] };
  const rows = body.rows ?? [];
  if (!rows.length) throw new Error("Карточки не пришли");

  cached = toCases(rows);
  return cached;
}

/** Сбрасывает кэш карточек — нужен тестам, чтобы они не влияли друг на друга. */
export function resetCasesCache(): void {
  cached = null;
}
