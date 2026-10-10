import type { NextRequest } from "next/server";
import * as trainingChat from "@/lib/trainingChat";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

export const maxDuration = 300;

/**
 * Sends one message to the trainer and streams back its progress, then the
 * stored conversation — the same shape as /api/meals/chat.
 *
 *   POST /api/training/chat  { weekStartDateKey, text, todayKey }
 *   → application/x-ndjson, one ChatStreamEvent per line
 */
export async function POST(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const body = (await request.json().catch(() => ({}))) as { weekStartDateKey?: unknown; text?: unknown; todayKey?: unknown };
  const weekStartDateKey = typeof body.weekStartDateKey === "string" ? body.weekStartDateKey : "";
  const todayKey = typeof body.todayKey === "string" ? body.todayKey : "";
  const text = typeof body.text === "string" ? body.text : "";
  return chatStreamResponse(locale, async (onProgress) =>
    (await trainingChat.sendMessage(ownerSub, weekStartDateKey, text, todayKey, onProgress)).map(trainingChat.toMessageView),
  );
}
