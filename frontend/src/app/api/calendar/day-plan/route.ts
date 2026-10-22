import type { NextRequest } from "next/server";
import * as dayPlan from "@/lib/dayPlan";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

export const maxDuration = 300;

/**
 * One message about a day's plan, streamed like the other chats: progress,
 * then the day's stored conversation.
 *
 *   POST /api/calendar/day-plan  { dateKey, text, timeZone }
 */
export async function POST(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const body = (await request.json().catch(() => ({}))) as { dateKey?: unknown; text?: unknown; timeZone?: unknown };
  const dateKey = typeof body.dateKey === "string" ? body.dateKey : "";
  const text = typeof body.text === "string" ? body.text : "";
  const timeZone = typeof body.timeZone === "string" && body.timeZone ? body.timeZone : "UTC";
  return chatStreamResponse(locale, (onProgress) => dayPlan.sendDayMessage(ownerSub, dateKey, text, timeZone, onProgress));
}
