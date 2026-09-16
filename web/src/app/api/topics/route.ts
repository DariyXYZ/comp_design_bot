import { NextResponse } from "next/server";
import { CASES } from "@/features/topics/data";

/**
 * Карточки тем. Лежат в коде (`features/topics/data.ts`), роут оставлен,
 * чтобы клиент не менялся: он всегда читал `/api/topics`.
 */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ rows: CASES });
}
