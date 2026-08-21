import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { AuthError, issueToken, readLoginCode } from "@/lib/server/telegram-auth";

/**
 * Обмен кода входа из адреса кнопки на токен сессии.
 *
 * Второй путь входа рядом с `initData`, и на практике более надёжный: клиенты
 * Telegram отдают данные запуска пустыми после восстановления вебвью из кеша, а
 * код в адресе кнопки формирует сам бот — он всегда знает, кто перед ним.
 *
 * Код живёт минуты и обменивается сразу при открытии: адрес попадает в историю
 * и в логи, поэтому долго действующий секрет там держать нельзя.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { code } = (await request.json()) as { code?: string };
    if (!code) {
      return NextResponse.json({ error: "Код не передан" }, { status: 400 });
    }
    const env = serverEnv();
    const viewer = readLoginCode(code, env.botToken);
    return NextResponse.json({ token: issueToken(viewer, env.botToken), user: viewer });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("redeem: неожиданная ошибка", error);
    return NextResponse.json({ error: "Сервис недоступен" }, { status: 500 });
  }
}
