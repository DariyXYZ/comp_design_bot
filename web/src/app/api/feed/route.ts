import { NextResponse } from "next/server";
import { loadFeed } from "@/lib/server/feed";
import { AuthError, bearer, readToken } from "@/lib/server/telegram-auth";
import { serverEnv } from "@/config/server-env";

/**
 * Лента задач отдела. Открыта всем, у кого есть приложение: это доска
 * отдела, а не личные данные. С токеном сессии каждая строка помечается,
 * следит ли за ней этот человек.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tasks = await loadFeed();
    let viewerId: number | null = null;
    const header = request.headers.get("authorization");
    if (header) {
      try {
        viewerId = readToken(bearer(header), serverEnv().botToken).id;
      } catch (error) {
        // Просроченный токен не повод прятать ленту — просто без пометок.
        if (!(error instanceof AuthError)) throw error;
      }
    }
    return NextResponse.json({
      tasks: tasks.map(({ watchers, ...task }) => ({
        ...task,
        watching: viewerId !== null && watchers.includes(viewerId),
      })),
    });
  } catch (error) {
    console.error("feed: не удалось прочитать доску", error);
    return NextResponse.json({ error: "Pyrus не ответил" }, { status: 502 });
  }
}
