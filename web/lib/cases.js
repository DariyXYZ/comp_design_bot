// Кейсы читаются из Supabase (таблица `cases`) — единый источник с ботом
// (bot/texts.py), чтобы не редактировать одно и то же в двух местах.
// anon-ключ публичный по дизайну (read-only по Row Level Security на
// таблице) — его нормально держать прямо в клиентском коде.
const SUPABASE_URL = "https://ehpokxcxxpatxdrljasc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0pBtURLi2hnoBSjFfs2-PA_sNISxVfL";

const CASES_QUERY =
  "cases?select=key,title,hint,eta,image_front,image_back&order=sort_order";

/**
 * Забирает карточки кейсов. Бросает исключение, если сеть недоступна,
 * Supabase ответил не 2xx или таблица пуста — вызывающий показывает
 * запасной экран.
 */
export async function fetchCases({ signal } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${CASES_QUERY}`, {
    signal,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const rows = await res.json();
  if (!rows.length) throw new Error("empty");

  return rows.map((r) => ({
    key: r.key,
    title: r.title,
    hint: r.hint,
    eta: `⏱ ${r.eta}`,
    frontImg: r.image_front,
    backImg: r.image_back || null,
  }));
}
