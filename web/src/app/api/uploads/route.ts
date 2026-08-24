import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { AuthError, bearer, readToken, renewalHeaders } from "@/lib/server/telegram-auth";

/**
 * Загрузка картинки заявки в Pyrus. Возвращает `guid`, которым файл потом
 * прикладывается к задаче.
 *
 * Зачем отдельный шаг: `sendData` файлы не передаёт вовсе — это единственный
 * способ приложить картинку прямо из формы, не гоняя человека в чат. А сам
 * Pyrus принимает файлы только по guid из `files/upload`, поэтому путь всегда
 * двухшаговый: сначала загрузка, потом привязка к задаче.
 *
 * Требует токен сессии: без него любой мог бы наполнять хранилище Pyrus
 * чужими файлами.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Лимит на файл. Serverless-функция принимает запрос целиком в память, и на
 * Hobby-плане потолок около 4.5 МБ — поэтому браузер ещё и сжимает картинку
 * перед отправкой (см. `compressImage`), а здесь стоит страховка.
 */
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export async function POST(request: Request) {
  try {
    const env = serverEnv();
    const token = bearer(request.headers.get("authorization"));
    readToken(token, env.botToken);
    const headers = renewalHeaders(token, env.botToken);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не пришёл" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Картинка больше 4 МБ — уменьшите её" },
        { status: 413 },
      );
    }
    if (file.type && !ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Это не картинка" }, { status: 415 });
    }

    // Своя авторизация в Pyrus: клиент из `lib/server/pyrus` умеет только
    // JSON-запросы, а загрузка идёт multipart.
    const auth = await fetch("https://api.pyrus.com/v4/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: env.pyrusLogin,
        security_key: env.pyrusSecurityKey,
      }),
      cache: "no-store",
    });
    const session = (await auth.json()) as { access_token?: string; api_url?: string };
    if (!auth.ok || !session.access_token) {
      return NextResponse.json({ error: "Pyrus не авторизовал" }, { status: 502 });
    }
    const api = (session.api_url ?? "https://api.pyrus.com/v4").replace(/\/$/, "");

    const upload = new FormData();
    upload.append("file", file, file.name || "photo.jpg");
    const response = await fetch(`${api}/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: upload,
      cache: "no-store",
    });
    const body = (await response.json()) as { guid?: string };
    if (!response.ok || !body.guid) {
      return NextResponse.json({ error: "Pyrus не принял файл" }, { status: 502 });
    }
    return NextResponse.json({ guid: body.guid }, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("uploads: не удалось загрузить файл", error);
    return NextResponse.json({ error: "Загрузка не удалась" }, { status: 500 });
  }
}
