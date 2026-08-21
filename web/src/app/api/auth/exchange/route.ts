import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { AuthError, issueToken, verifyInitData } from "@/lib/server/telegram-auth";

/**
 * Обмен подписанных данных запуска на свой токен сессии.
 *
 * Один раз проверяем подпись Telegram, дальше приложение живёт со своим
 * токеном: клиенты отдают `initData` непредсказуемо (после восстановления
 * вебвью из кеша он приходит пустым), и держаться за него нельзя.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const initData = request.headers.get("x-telegram-init-data") ?? "";
  try {
    const env = serverEnv();
    const viewer = verifyInitData(initData, env.botToken);
    return NextResponse.json({ token: issueToken(viewer, env.botToken), user: viewer });
  } catch (error) {
    if (error instanceof AuthError) {
      // 401, а не 400: для приложения это именно «вход не подтверждён».
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("exchange: неожиданная ошибка", error);
    return NextResponse.json({ error: "Сервис недоступен" }, { status: 500 });
  }
}
