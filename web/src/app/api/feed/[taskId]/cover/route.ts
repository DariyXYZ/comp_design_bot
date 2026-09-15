import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { feedTask, firstImage } from "@/lib/server/feed";
import { Pyrus } from "@/lib/server/pyrus";

/**
 * Обложка задачи — первая картинка из её вложений, отданная через сервер:
 * файлы Pyrus доступны только под ключом, а ключ в браузер не попадает.
 * Картинки заявок не меняются, поэтому кэшируются надолго.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, context: Context) {
  const { taskId } = await context.params;
  const id = Number(taskId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Неверный номер задачи" }, { status: 400 });
  }
  try {
    const task = await feedTask(id);
    const image = task ? firstImage(task) : null;
    if (!image?.url) return new NextResponse(null, { status: 404 });
    const env = serverEnv();
    const pyrus = new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId);
    const upstream = await pyrus.download(image.url);
    if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? image.mime_type ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    console.error("feed/cover: не удалось отдать картинку", error);
    return new NextResponse(null, { status: 502 });
  }
}
