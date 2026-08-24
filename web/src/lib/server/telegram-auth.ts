import crypto from "node:crypto";

import { SESSION_TOKEN_HEADER } from "@/lib/session-token-header";

/**
 * Проверка данных запуска Mini App и свои токены сессии. **Только сервер.**
 *
 * Почему нужны оба механизма:
 *
 * * `initData` подписан Telegram — по подписи видно, что запрос действительно
 *   от этого человека. Без проверки любой прислал бы чужой Telegram-id и
 *   прочитал чужие заявки.
 * * Постоянным ключом `initData` быть не может: клиенты Telegram (особенно
 *   Desktop) отдают его пустым или обрезанным после восстановления вебвью из
 *   кеша — известное поведение без официального фикса. Поэтому подпись
 *   проверяется один раз и обменивается на свой токен.
 *
 * Токен — подписанный HMAC payload без состояния на сервере: проверить подпись
 * дешевле, чем хранить сессии, а отзывать их пока незачем.
 */

/** Месяц: человек не логинится каждый день, но потерянный токен не вечен. */
const TOKEN_TTL_SECONDS = 30 * 24 * 3600;
/**
 * За сколько до конца срока выдавать новый токен.
 *
 * Иначе месяц — жёсткая стена: у того, кто не заходил, токен умирает, а взять
 * новый негде, если клиент Telegram отдаёт пустой `initData` и кнопка в чате
 * тоже успела остыть. Пока человек пользуется приложением, вход не кончается.
 */
const TOKEN_RENEW_BEFORE_SECONDS = 7 * 24 * 3600;
/** Насколько свежими считаем данные запуска при обмене. */
const INIT_DATA_MAX_AGE_SECONDS = 24 * 3600;

export type Viewer = {
  id: number;
  name: string;
  handle: string | null;
};

export class AuthError extends Error {}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * Проверяет подпись `initData` и возвращает пользователя.
 *
 * Алгоритм задан Telegram: строка проверки — пары `key=value`, отсортированные
 * по ключу и склеенные переводом строки, без самого `hash`; ключ подписи —
 * HMAC от токена бота с константой `WebAppData`.
 */
export function verifyInitData(initData: string, botToken: string): Viewer {
  if (!initData) throw new AuthError("данные запуска пусты");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new AuthError("в данных запуска нет подписи");
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");
  // timingSafeEqual, а не ===: сравнение подписей должно быть постоянного времени.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AuthError("подпись не совпала");
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (authDate && Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    throw new AuthError("данные запуска устарели");
  }

  const rawUser = params.get("user");
  if (!rawUser) throw new AuthError("в данных запуска нет пользователя");
  const user = JSON.parse(rawUser) as {
    id?: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  if (!user.id) throw new AuthError("у пользователя нет id");

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return {
    id: user.id,
    name: name || "Без имени",
    handle: user.username ? `@${user.username}` : null,
  };
}

export function issueToken(viewer: Viewer, secret: string): string {
  const payload = { ...viewer, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = crypto.createHmac("sha256", secret).update(body).digest();
  return `${body}.${base64url(signature)}`;
}

function parseToken(token: string, secret: string): Viewer & { exp: number } {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new AuthError("токен повреждён");
  const expected = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AuthError("подпись токена не совпала");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Viewer & {
    exp: number;
  };
  if (payload.exp < Date.now() / 1000) throw new AuthError("токен истёк");
  return { id: payload.id, name: payload.name, handle: payload.handle, exp: payload.exp };
}

export function readToken(token: string, secret: string): Viewer {
  const { id, name, handle } = parseToken(token, secret);
  return { id, name, handle };
}

/**
 * Заголовки ответа для токена, которому недолго осталось: в них лежит свежий.
 *
 * Продление молчаливое и попутное — отдельного запроса «обнови мне вход» нет,
 * потому что просить его пришлось бы именно в тот момент, когда вход уже не
 * работает. Пустой объект означает «продлевать нечего»: токен свежий, или
 * подпись не сошлась, или срок уже вышел (тогда это забота обмена, а не
 * продления).
 */
export function renewalHeaders(token: string, secret: string): Record<string, string> {
  let payload: Viewer & { exp: number };
  try {
    payload = parseToken(token, secret);
  } catch {
    return {};
  }
  if (payload.exp - Date.now() / 1000 > TOKEN_RENEW_BEFORE_SECONDS) return {};
  return {
    [SESSION_TOKEN_HEADER]: issueToken(
      { id: payload.id, name: payload.name, handle: payload.handle },
      secret,
    ),
    // На Vercel приложение и его роуты живут на одном домене, и заголовок виден
    // скрипту без разрешения. Разрешение всё равно ставим: стоит `API_BASE`
    // указать на другой домен — и без него браузер спрячет продлённый токен.
    "Access-Control-Expose-Headers": SESSION_TOKEN_HEADER,
  };
}

/**
 * Проверяет код входа, который бот положил в адрес кнопки Mini App.
 *
 * Тот же формат и тот же секрет, что у токена сессии (`payload.signature`,
 * HMAC от токена бота) — код отличается полем `kind` и коротким сроком жизни.
 * Нужен потому, что клиенты Telegram отдают `initData` непредсказуемо: кнопку
 * формирует бот, и в этот момент он точно знает, кто перед ним.
 */
export function readLoginCode(code: string, secret: string): Viewer {
  const [body, signature] = code.split(".");
  if (!body || !signature) throw new AuthError("код входа повреждён");
  const expected = base64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AuthError("подпись кода не совпала");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    uid?: number;
    name?: string;
    handle?: string | null;
    exp?: number;
    kind?: string;
  };
  // Разделение видов обязательно: иначе долгий токен сессии сошёл бы за код
  // входа и наоборот, и срок жизни перестал бы что-либо значить.
  if (payload.kind !== "code") throw new AuthError("это не код входа");
  if (!payload.uid) throw new AuthError("в коде нет пользователя");
  if ((payload.exp ?? 0) < Date.now() / 1000) throw new AuthError("код входа истёк");
  return {
    id: payload.uid,
    name: payload.name || "Без имени",
    handle: payload.handle ?? null,
  };
}

/** Достаёт токен из заголовка `Authorization: Bearer …`. */
export function bearer(header: string | null): string {
  const value = header?.trim() ?? "";
  if (!value.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("нужен токен сессии");
  }
  return value.slice(7).trim();
}
