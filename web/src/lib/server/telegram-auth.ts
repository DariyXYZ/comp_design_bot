import crypto from "node:crypto";

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

export function readToken(token: string, secret: string): Viewer {
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
  return { id: payload.id, name: payload.name, handle: payload.handle };
}

/** Достаёт токен из заголовка `Authorization: Bearer …`. */
export function bearer(header: string | null): string {
  const value = header?.trim() ?? "";
  if (!value.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("нужен токен сессии");
  }
  return value.slice(7).trim();
}
