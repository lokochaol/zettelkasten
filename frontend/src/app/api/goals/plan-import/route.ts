import type { NextRequest } from "next/server";
import * as planImport from "@/lib/goalPlanImport";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

export const maxDuration = 300;

/**
 * Reads a goals document into a draft plan and streams progress, then the
 * draft as the stream's one message. Nothing is written here — the owner
 * looks the draft over and applies it (applyPlanImportAction).
 *
 *   POST /api/goals/plan-import  { text, todayKey }
 */
export async function POST(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; todayKey?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  const todayKey = typeof body.todayKey === "string" ? body.todayKey : "";
  return chatStreamResponse(locale, async (onProgress) => [await planImport.draftPlanImport(ownerSub, text, todayKey, onProgress)]);
}
