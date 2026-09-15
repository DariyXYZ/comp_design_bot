import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";
import { Pyrus } from "@/lib/server/pyrus";

/**
 * Список проектов бюро для подсказки в поле «Проект».
 *
 * Источник — общий справочник Pyrus «Проект» (≈900 позиций вида
 * `1-19-2026 MR Group АГК БЦ Верейская`): его ведёт компания, и именно эти
 * названия видят остальные формы. Свой список из папок на диске X: дал бы
 * второе написание того же проекта — ровно то, от чего подсказка должна
 * спасать.
 *
 * Отдаётся целиком: ~40 КБ один раз за сессию, фильтр — в браузере, чтобы
 * подсказка не ждала сервера на каждую букву. Кэш десять минут: новые проекты
 * заводят в справочнике не каждый час.
 */
export const runtime = "nodejs";
// Не статика: клиент Pyrus ходит с `cache: no-store`, и попытка Next
// пререндерить роут на сборке падала бы. Кэш — свой, в памяти инстанса.
export const dynamic = "force-dynamic";

export type ProjectOption = { id: number; name: string };

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; projects: ProjectOption[] } | null = null;

export async function GET() {
  try {
    const env = serverEnv();
    const pyrus = new Pyrus(env.pyrusLogin, env.pyrusSecurityKey, env.pyrusFormId);
    if (!pyrus.enabled) {
      return NextResponse.json({ error: "Pyrus не подключён" }, { status: 503 });
    }
    if (!cached || Date.now() - cached.at > TTL_MS) {
      cached = { at: Date.now(), projects: await pyrus.catalogItems(env.pyrusProjectCatalogId) };
    }
    const { projects } = cached;
    return NextResponse.json(
      { projects },
      { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    console.error("projects: не удалось прочитать справочник", error);
    return NextResponse.json({ error: "Pyrus не ответил" }, { status: 502 });
  }
}
