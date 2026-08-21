import { NextResponse } from "next/server";
import { serverEnv } from "@/config/server-env";

/**
 * Карточки тем из Supabase (таблица `cases`) — единый источник с ботом.
 *
 * Через сервер, а не напрямую из браузера: тогда ключ Supabase остаётся на
 * сервере и не попадает в бандл. Раньше он ехал в клиент через
 * `NEXT_PUBLIC_*`, что требовало публичной копии каждой переменной — лишняя
 * сущность и лишний способ ошибиться.
 *
 * Кеширования нет намеренно: контент правят в дашборде Supabase и ждут увидеть
 * правку при следующем открытии приложения.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUERY = "cases?select=key,title,hint,eta,image_front,image_back&order=sort_order";

export async function GET() {
  try {
    const env = serverEnv();
    const response = await fetch(`${env.supabaseUrl}/rest/v1/${QUERY}`, {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Supabase ответил ${response.status}` },
        { status: 502 },
      );
    }
    const rows = (await response.json()) as unknown[];
    if (!rows.length) {
      return NextResponse.json({ error: "Таблица cases пуста" }, { status: 502 });
    }
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("topics: не удалось прочитать карточки", error);
    return NextResponse.json({ error: "Карточки недоступны" }, { status: 502 });
  }
}
