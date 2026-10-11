import type { NextRequest } from "next/server";
import * as goals from "@/lib/goals";
import { chatStreamResponse } from "@/lib/chatStream";
import { getLocale } from "@/lib/i18n/locale";
import { requireOwnerSub } from "@/lib/session";

export const maxDuration = 300;

/**
 * Reads a pasted page of goals and streams back progress, then the draft
 * (as the one "message" of the stream) — nothing is written here; the
 * owner looks the draft over and applies it with applyImportAction.
 *
 *   POST /api/goals/import  { text, todayKey }
 *   → application/x-ndjson, one ChatStreamEvent<ImportDraft> per line
 */
export async function POST(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; todayKey?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  const todayKey = typeof body.todayKey === "string" ? body.todayKey : "";
  return chatStreamResponse(locale, async (onProgress) => [await goals.draftImport(ownerSub, text, todayKey, onProgress)]);
}
