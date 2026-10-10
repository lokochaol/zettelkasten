import type { NextRequest } from "next/server";
import * as mealChat from "@/lib/mealChat";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

/** A whole week of meals can take the model a few minutes to write. */
export const maxDuration = 300;

/**
 * Sends one message to the meal planner and streams back what it's doing —
 * reading the week, thinking, the reply as it's written, each proposed meal
 * as it lands — then the stored conversation. A route rather than a server
 * action because a server action can't stream progress to the page.
 * Behind the session gate in proxy.ts like every page.
 *
 *   POST /api/meals/chat  { weekStartDateKey, text, todayKey }
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
    (await mealChat.sendMessage(ownerSub, weekStartDateKey, text, todayKey, onProgress)).map(mealChat.toMessageView),
  );
}
