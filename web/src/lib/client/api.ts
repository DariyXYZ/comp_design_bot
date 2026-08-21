import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Обращения к своему API и вход.
 *
 * Вход устроен двумя путями, и оба нужны:
 *
 * 1. **Код входа из адреса кнопки** — его подписывает бот, поэтому он работает
 *    даже когда клиент Telegram не отдал данные запуска (после восстановления
 *    вебвью из кеша он приходит пустым — известное поведение).
 * 2. **`initData`** — работает, когда клиент его отдал.
 *
 * Токен держим и в памяти, и в `localStorage`. Память обязательна: в вебвью
 * хранилище бывает недоступно, и тогда вход жил бы ровно один запрос.
 * Хранилище — чтобы вход переживал перезагрузку экрана.
 *
 * Пути со слэшем на конце: в конфиге включён `trailingSlash`, и без него Next
 * отвечает 308-редиректом.
 *
 * Пустой `NEXT_PUBLIC_API_BASE` означает «API на этом же домене» — так на
 * Vercel, где роуты лежат рядом с экранами, и CORS не нужен вовсе.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const TOKEN_KEY = "comp-design-bot:session-token";

export type Session = {
  token: string;
  user: { id: number; name: string; handle: string | null };
};

/**
 * Что произошло при последней попытке входа.
 *
 * Нужен экрану диагностики: «приложение меня не видит» — симптом с десятком
 * причин (нет кода, пустой initData, недоступное хранилище, отказ сервера), и
 * без фактов их не отличить.
 */
export type LoginTrace = {
  hadCode: boolean;
  initDataLength: number;
  storageAvailable: boolean | null;
  redeemStatus: number | null;
  exchangeStatus: number | null;
  tokenPresent: boolean;
  error: string | null;
};

const trace: LoginTrace = {
  hadCode: false,
  initDataLength: 0,
  storageAvailable: null,
  redeemStatus: null,
  exchangeStatus: null,
  tokenPresent: false,
  error: null,
};

export function loginTrace(): LoginTrace {
  return { ...trace, tokenPresent: Boolean(memoryToken) };
}

let memoryToken: string | null = null;
/** Код из адреса: держим в памяти, чтобы переобменять после истечения токена. */
let memoryCode: string | null = null;
/** Готовая сессия и незавершённый обмен — чтобы не менять код дважды. */
let memorySession: Session | null = null;
let inflight: Promise<Session | null> | null = null;

function readStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY);
    trace.storageAvailable = true;
  } catch {
    // Хранилище недоступно — работаем на памяти.
    trace.storageAvailable = false;
  }
  return memoryToken;
}

function storeToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    trace.storageAvailable = true;
  } catch {
    trace.storageAvailable = false;
  }
}

/**
 * Забирает код входа из адреса и убирает его оттуда.
 *
 * Код остаётся в памяти: если токен истечёт, обменяем его снова, не заставляя
 * человека идти в чат за свежей кнопкой.
 */
function takeLoginCode(): string | null {
  if (memoryCode) return memoryCode;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("c");
    if (!code) return null;
    memoryCode = code;
    trace.hadCode = true;
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

async function postSession(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ session: Session | null; status: number | null }> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers:
        body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      if (detail?.error) trace.error = detail.error;
      return { session: null, status: response.status };
    }
    const session = (await response.json()) as Session;
    if (session.token) storeToken(session.token);
    return { session, status: response.status };
  } catch (error) {
    trace.error = error instanceof Error ? error.message : "сеть недоступна";
    return { session: null, status: null };
  }
}

async function runExchange(): Promise<Session | null> {
  const code = takeLoginCode();
  if (code) {
    const { session, status } = await postSession("/api/auth/redeem/", { code });
    trace.redeemStatus = status;
    if (session) return session;
  }

  const initData = window.Telegram?.WebApp?.initData ?? "";
  trace.initDataLength = initData.length;
  if (!initData) return null;
  const { session, status } = await postSession("/api/auth/exchange/", undefined, {
    "X-Telegram-Init-Data": initData,
  });
  trace.exchangeStatus = status;
  return session;
}

/**
 * Получает сессию: сначала кодом из кнопки, затем через `initData`.
 *
 * Результат кэшируется, а параллельные вызовы делят один обмен: приложение
 * зовёт эту функцию и при старте, и на экране профиля, а обменивать один код
 * дважды незачем. `force` нужен после 401 — токен истёк, код в памяти остался.
 */
export async function exchangeSession(
  options: { force?: boolean } = {},
): Promise<Session | null> {
  if (options.force) {
    memorySession = null;
    inflight = null;
  } else if (memorySession) {
    return memorySession;
  }
  if (!inflight) {
    inflight = runExchange().then((session) => {
      memorySession = session;
      inflight = null;
      return session;
    });
  }
  return inflight;
}

/** Токен для запросов, требующих подтверждённого входа. */
export async function sessionToken(): Promise<string | null> {
  const stored = readStoredToken();
  if (stored) return stored;
  return (await exchangeSession())?.token ?? null;
}

/** Заявки этого человека. `null` — вход не подтверждён или API недоступен. */
export async function fetchMyRequests(): Promise<PyrusRequest[] | null> {
  let token = await sessionToken();
  for (const attempt of [1, 2]) {
    if (!token) return null;
    try {
      const response = await fetch(`${API_BASE}/api/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 401 && attempt === 1) {
        // Токен истёк — обменяем ещё раз (код из кнопки остался в памяти).
        memoryToken = null;
        token = (await exchangeSession({ force: true }))?.token ?? null;
        continue;
      }
      if (!response.ok) {
        trace.error = `заявки: HTTP ${response.status}`;
        return null;
      }
      const body = (await response.json()) as { requests?: PyrusRequest[] };
      return body.requests ?? [];
    } catch (error) {
      trace.error = error instanceof Error ? error.message : "сеть недоступна";
      return null;
    }
  }
  return null;
}
