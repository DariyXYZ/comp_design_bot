import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Обращения к своему API.
 *
 * Токен сессии получаем один раз в обмен на подписанные данные запуска и
 * храним в браузере: клиенты Telegram отдают `initData` непредсказуемо, и
 * зависеть от него в каждом запросе нельзя.
 *
 * Пути со слэшем на конце: в конфиге включён `trailingSlash`, и без него
 * Next отвечает 308-редиректом.
 *
 * Пустой `NEXT_PUBLIC_API_BASE` означает «API на этом же домене» — так на
 * Vercel, где роуты лежат рядом с экранами, и CORS не нужен вовсе. В
 * статической сборке под GitHub Pages роутов нет, и здесь это не ошибка:
 * функции честно возвращают `null`, а экран показывает пояснение.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const TOKEN_KEY = "comp-design-bot:session-token";

export type Session = {
  token: string;
  user: { id: number; name: string; handle: string | null };
};

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Приватный режим или заблокированное хранилище.
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // См. выше: работать без хранилища можно, просто обмен пойдёт заново.
  }
}

/**
 * Меняет данные запуска на токен сессии.
 *
 * Возвращает `null`, если API недоступен (статическая сборка) или Telegram не
 * дал данных запуска — вызывающий показывает это состояние словами.
 */
export async function exchangeSession(): Promise<Session | null> {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return null;
  try {
    const response = await fetch(`${API_BASE}/api/auth/exchange/`, {
      method: "POST",
      headers: { "X-Telegram-Init-Data": initData },
    });
    if (!response.ok) return null;
    const session = (await response.json()) as Session;
    if (session.token) storeToken(session.token);
    return session;
  } catch {
    return null;
  }
}

/** Заявки этого человека. `null` — API недоступен или сессии нет. */
export async function fetchMyRequests(): Promise<PyrusRequest[] | null> {
  let token = readStoredToken();
  for (const attempt of [1, 2]) {
    if (!token) {
      const session = await exchangeSession();
      token = session?.token ?? null;
      if (!token) return null;
    }
    try {
      const response = await fetch(`${API_BASE}/api/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 1) {
        // Токен истёк или подпись сменилась — обменяем ещё раз, но только раз.
        token = null;
        continue;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { requests?: PyrusRequest[] };
      return body.requests ?? [];
    } catch {
      return null;
    }
  }
  return null;
}
