import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { feedTask, invalidateFeed, UNWATCH_PREFIX, WATCH_PREFIX, watchersOf } from "@/lib/server/feed";
import { Pyrus } from "@/lib/server/pyrus";
import { AuthError, bearer, readToken, renewalHeaders } from "@/lib/server/telegram-auth";

/**
 * Подписка на чужую задачу: комментарий «Подписка: tg:<id> Имя» в задаче.
 * Хранилище — сама задача Pyrus (у бота своей базы нет): бот при смене
 * статуса читает такие комментарии и шлёт уведомления подписчикам. Повторный
 * вызов снимает подписку комментарием «Отписка: …».
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Неверный номер задачи" }, { status: 400 });
    }
    const env = serverEnv();
    const token = bearer(request.headers.get("authorization"));
    const viewer = readToken(token, env.botToken);
    const task = await feedTask(id);
    if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });

    const watching = watchersOf(task.comments ?? []).includes(viewer.id);
    const who = viewer.handle ? `${viewer.name} ${viewer.handle}` : viewer.name;
    const pyrus = new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId);
    await pyrus.comment(id, `${watching ? UNWATCH_PREFIX : WATCH_PREFIX} tg:${viewer.id} ${who}`);
    invalidateFeed();
    return NextResponse.json({ watching: !watching }, { headers: renewalHeaders(token, env.botToken) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("feed/watch: не удалось", error);
    return NextResponse.json({ error: "Не удалось" }, { status: 502 });
  }
}
