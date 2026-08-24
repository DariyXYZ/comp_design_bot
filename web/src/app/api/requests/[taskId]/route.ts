import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { isRequestAction, planAction } from "@/features/requests/actions";
import { Pyrus } from "@/lib/server/pyrus";
import { notifyDept } from "@/lib/server/telegram-bot";
import { AuthError, bearer, readToken } from "@/lib/server/telegram-auth";

/**
 * Одна заявка: читать (`GET`) и писать по ней (`POST`).
 *
 * Оба метода требуют токен и оба проверяют, что заявка **этого** человека:
 * `userRequest` сверяет Telegram-id из поля формы и возвращает `null` для
 * чужой задачи. Без этого по номеру задачи читались бы и комментировались
 * чужие заявки — номера идут подряд, подобрать их несложно.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

async function viewerAndPyrus(request: Request) {
  const env = serverEnv();
  const viewer = readToken(bearer(request.headers.get("authorization")), env.botToken);
  return { env, viewer, pyrus: new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId) };
}

export async function GET(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Неверный номер задачи" }, { status: 400 });
    }
    const { viewer, pyrus } = await viewerAndPyrus(request);
    if (!pyrus.enabled) {
      return NextResponse.json({ error: "Pyrus не подключён" }, { status: 503 });
    }
    const found = await pyrus.userRequest(id, viewer.id);
    if (!found) {
      // Одинаковый ответ для «нет такой задачи» и «задача чужая»: иначе по
      // разнице ответов можно было бы перебором узнать, какие заявки есть.
      return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    }
    return NextResponse.json({ request: found });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("requests/[taskId]: не удалось получить заявку", error);
    return NextResponse.json({ error: "Pyrus не ответил" }, { status: 502 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    const id = Number(taskId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Неверный номер задачи" }, { status: 400 });
    }
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      text?: unknown;
    } | null;
    if (!isRequestAction(body?.action)) {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    const text = typeof body?.text === "string" ? body.text : "";

    const { env, viewer, pyrus } = await viewerAndPyrus(request);
    if (!pyrus.enabled) {
      return NextResponse.json({ error: "Pyrus не подключён" }, { status: 503 });
    }
    const found = await pyrus.userRequest(id, viewer.id);
    if (!found) {
      return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    }

    const plan = planAction(body.action, {
      number: found.number,
      topic: found.topic,
      author: viewer.handle ? `${viewer.name} ${viewer.handle}` : viewer.name,
    }, text);
    if (!plan) {
      return NextResponse.json({ error: "Нужен текст сообщения" }, { status: 400 });
    }

    // Порядок важен: сначала Pyrus. Если он откажет, отдел не получит
    // сообщение о том, чего нет в реестре.
    await pyrus.comment(id, plan.comment, plan.action);
    const delivered = await notifyDept(plan.chat, env);

    return NextResponse.json({ ok: true, delivered });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("requests/[taskId]: действие не выполнено", error);
    return NextResponse.json({ error: "Не удалось выполнить" }, { status: 502 });
  }
}
