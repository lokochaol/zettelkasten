import type { NextRequest } from "next/server";
import * as advisor from "@/lib/goalAdvisor";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

export const maxDuration = 300;

/**
 * One message to the goal advisor, streamed like the meal and training
 * chats: progress, then the stored conversation.
 *
 *   POST /api/goals/advisor  { text, todayKey }
 */
export async function POST(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; todayKey?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  const todayKey = typeof body.todayKey === "string" ? body.todayKey : "";
  return chatStreamResponse(locale, async (onProgress) => (await advisor.sendMessage(ownerSub, text, todayKey, onProgress)).map(advisor.toMessageView));
}
