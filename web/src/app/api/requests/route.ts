import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { Pyrus } from "@/lib/server/pyrus";
import { AuthError, bearer, readToken, renewalHeaders } from "@/lib/server/telegram-auth";

/**
 * Заявки этого человека из реестра формы Pyrus.
 *
 * Отбор по Telegram-id, который лежит в поле формы. Именно поэтому запрос
 * требует токен: без проверки подписи любой подставил бы чужой id и прочитал
 * чужие заявки.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const env = serverEnv();
    const token = bearer(request.headers.get("authorization"));
    const viewer = readToken(token, env.botToken);
    // Токен на исходе уезжает обратно продлённым — см. renewalHeaders.
    const headers = renewalHeaders(token, env.botToken);
    const pyrus = new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId);
    if (!pyrus.enabled) {
      // Не ошибка: интеграции может не быть, и приложение показывает пустой
      // список с пояснением, а не экран сбоя.
      return NextResponse.json({ requests: [], source: "disabled" }, { headers });
    }
    return NextResponse.json(
      { requests: await pyrus.listUserRequests(viewer.id), source: "pyrus" },
      { headers },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("requests: не удалось получить заявки", error);
    return NextResponse.json({ error: "Pyrus не ответил" }, { status: 502 });
  }
}
