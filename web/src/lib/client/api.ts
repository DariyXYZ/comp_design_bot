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
 * Забирает код входа из адреса и убирает его оттуда.
 *
 * Код кладёт бот в кнопку Mini App. Он живёт минуты и меняется на токен сразу,
 * поэтому из адреса его лучше вычистить: адрес попадает в историю клиента, а
 * ссылку человек может переслать.
 */
function takeLoginCode(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("c");
    if (!code) return null;
    params.delete("c");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash,
    );
    return code;
  } catch {
    return null;
  }
}

/**
 * Получает токен сессии. Два пути, оба рабочие:
 *
 * 1. **Код входа из адреса кнопки** — надёжнее, потому что его формирует бот.
 * 2. **`initData` от клиента Telegram** — работает, когда клиент его отдал.
 *
 * Возвращает `null`, если ни то, ни другое не доступно (например, приложение
 * открыли прямой ссылкой в браузере) — вызывающий говорит об этом словами.
 */
export async function exchangeSession(): Promise<Session | null> {
  const code = takeLoginCode();
  if (code) {
    const session = await post("/api/auth/redeem/", { code });
    if (session) return session;
  }
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return null;
  return post("/api/auth/exchange/", undefined, {
    "X-Telegram-Init-Data": initData,
  });
}

async function post(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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
