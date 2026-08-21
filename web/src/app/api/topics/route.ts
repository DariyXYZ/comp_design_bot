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
 * Ответ кэшируется на пять минут: карточки правят в дашборде Supabase редко, а
 * без кэша каждое открытие приложения ждало похода в Supabase — это было видно
 * глазом. Правка появится в приложении в течение этих пяти минут.
 */
export const runtime = "nodejs";
export const revalidate = 300;

const QUERY = "cases?select=key,title,hint,eta,image_front,image_back&order=sort_order";

export async function GET() {
  try {
    const env = serverEnv();
    const response = await fetch(`${env.supabaseUrl}/rest/v1/${QUERY}`, {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      // Запрос к Supabase тоже кэшируется — иначе revalidate выше не имел бы
      // смысла: функция ходила бы за данными на каждый запрос.
      next: { revalidate: 300 },
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
