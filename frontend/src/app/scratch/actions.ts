"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import * as quickNotes from "@/lib/quickNotes";
import type { QuickNoteDetail } from "@/lib/quickNotes";
import * as zotero from "@/lib/zotero";
import type { ZoteroSearchResult } from "@/lib/zotero";
import * as zoteroCredentials from "@/lib/zoteroCredentials";
import * as literatureMemos from "@/lib/literatureMemos";
import type { LiteratureMemoSummary, LiteratureSelection } from "@/lib/literatureMemos";
import * as discovery from "@/lib/discovery";
import type { DiscoveryCandidateSummary } from "@/lib/discovery";
import { requireOwnerSub } from "@/lib/session";
import { QuickNoteSource } from "@/generated/prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateZoteroError } from "@/lib/i18n/errors";

export async function createQuickNoteAction(source: QuickNoteSource = "SCRATCH"): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await quickNotes.create(ownerSub, source);
  revalidatePath("/scratch");
  return note;
}

/** Creates a note and saves its content in one call — what
 * NewQuickNoteOverlay uses so the whole "add a 走り書き" operation is a
 * single Server Action. With experimental.useOffline (next.config.ts) that
 * single call is what sits pending and retries automatically once the
 * connection returns, rather than the composer needing to track a
 * create-then-save pair across a network drop.
 *
 * `literatureSelection` lets the same compose step link a 文献メモ, the
 * way the /scratch/[id] detail page's LiteratureMemoField does — but that
 * one always operates on an already-created note (setLiteratureMemoAction),
 * so here the selection is resolved to a memo id up front and passed
 * straight into quickNotes.create instead of a separate follow-up call. */
export async function createQuickNoteWithContentAction(
  content: string,
  literatureSelection?: LiteratureSelection | null,
): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const literatureMemoId = await literatureMemos.resolveSelection(prisma, ownerSub, literatureSelection);
  const note = await quickNotes.create(ownerSub, "SCRATCH", literatureMemoId ?? undefined);
  const detail = await quickNotes.updateContent(ownerSub, note.id, content);
  revalidatePath("/scratch");
  return detail;
}

export async function updateQuickNoteContentAction(id: string, content: string): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await quickNotes.updateContent(ownerSub, id, content);
  revalidatePath(`/scratch/${id}`);
  revalidatePath("/scratch");
  revalidatePath("/zettelkasten");
  return note;
}

export async function deleteQuickNoteAction(id: string): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await quickNotes.remove(ownerSub, id);
  revalidatePath("/scratch");
  revalidatePath("/zettelkasten");
}

export async function setLiteratureMemoAction(id: string, selection: LiteratureSelection): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await quickNotes.setLiteratureMemo(ownerSub, id, selection);
  revalidatePath(`/scratch/${id}`);
  revalidatePath("/scratch");
  return note;
}

/** Links (or, with `projectId: null`, unlinks) this note to a Project — see
 * quickNotes.setProject for the stale-archive exemption this grants. */
export async function setQuickNoteProjectAction(id: string, projectId: string | null): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await quickNotes.setProject(ownerSub, id, projectId);
  revalidatePath(`/scratch/${id}`);
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return note;
}

/** Owner's existing literature memos, matched by citation substring — backs the
 * "既存の文献メモから選ぶ" reuse picker so a memo created once doesn't need a
 * fresh Zotero search to be reused on another note. */
export async function searchLiteratureMemosAction(query: string): Promise<LiteratureMemoSummary[]> {
  const ownerSub = await requireOwnerSub();
  return literatureMemos.search(ownerSub, query);
}

export type ZoteroSearchResponse =
  | { status: "ok"; results: ZoteroSearchResult[] }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function zoteroSearchAction(query: string): Promise<ZoteroSearchResponse> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const credential = await zoteroCredentials.get(ownerSub);
    if (!credential) {
      return { status: "unconfigured" };
    }
    const results = await zotero.searchItems(credential, query, 10, getDictionary(locale).literaturePicker.untitled);
    return { status: "ok", results };
  } catch (e) {
    if (e instanceof zotero.ZoteroApiError) {
      return { status: "error", message: translateZoteroError(locale, e) };
    }
    // Anything else (e.g. decryption failing because CREDENTIAL_ENCRYPTION_KEY
    // was rotated after the credential was saved) must still resolve to a
    // visible state — never let this reject and leave the UI stuck "searching".
    return {
      status: "error",
      message: getDictionary(locale).errors.zoteroLoadFailed,
    };
  }
}

export type ZoteroCreateResponse =
  | { status: "ok"; result: ZoteroSearchResult }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

export async function zoteroCreateItemAction(
  input: zotero.CreateItemInput,
): Promise<ZoteroCreateResponse> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const credential = await zoteroCredentials.get(ownerSub);
    if (!credential) {
      return { status: "unconfigured" };
    }
    const result = await zotero.createItem(credential, input);
    return { status: "ok", result };
  } catch (e) {
    if (e instanceof zotero.ZoteroApiError) {
      return { status: "error", message: translateZoteroError(locale, e) };
    }
    return {
      status: "error",
      message: getDictionary(locale).errors.zoteroLoadFailed,
    };
  }
}

export async function searchQuickNotesAction(query: string) {
  const ownerSub = await requireOwnerSub();
  return quickNotes.search(ownerSub, query);
}

export async function listActiveQuickNotesAction() {
  const ownerSub = await requireOwnerSub();
  return quickNotes.listActive(ownerSub);
}

export async function getQuickNoteDetailAction(id: string): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  return quickNotes.getDetail(ownerSub, id);
}

/** Manual "今すぐ探す" trigger — runs the same discovery pass the twice-daily
 * cron runs (src/app/api/cron/discovery), scoped to the signed-in owner.
 * `force: true` bypasses the 12h-per-note cooldown (see DiscoveryConfirmDialog,
 * which gates this behind an explicit confirmation since it can re-spend AI
 * tokens on notes checked moments ago). The cron itself never passes force. */
export async function runDiscoveryAction(force = false): Promise<{ notesChecked: number; candidatesFound: number }> {
  const ownerSub = await requireOwnerSub();
  const result = await discovery.runForEnabledNotes(ownerSub, { force });
  revalidatePath("/scratch");
  return result;
}

export async function listDiscoveryForNotesAction(
  quickNoteIds: string[],
): Promise<Record<string, DiscoveryCandidateSummary[]>> {
  const ownerSub = await requireOwnerSub();
  return discovery.listForQuickNotes(ownerSub, quickNoteIds);
}

/** "📖 文献に追加" — turns a candidate into (or matches it to) a LiteratureMemo
 * without writing a note from it. */
export async function confirmDiscoveryLiteratureAction(
  candidateId: string,
  overrides: { citation: string; url: string | null },
): Promise<{ literatureMemoId: string }> {
  const ownerSub = await requireOwnerSub();
  const literatureMemoId = await discovery.resolveLiteratureForCandidate(ownerSub, candidateId, overrides);
  revalidatePath("/scratch");
  return { literatureMemoId };
}

/** "＋ このメモを書く" — resolves the candidate's literature memo (adding it
 * first if this is the first action taken on it) and creates a new QuickNote
 * already linked to it, ready for the caller to navigate to /scratch/[id]. */
export async function writeNoteFromDiscoveryAction(
  candidateId: string,
  overrides: { citation: string; url: string | null },
): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await discovery.writeNoteFromCandidate(ownerSub, candidateId, overrides);
  revalidatePath("/scratch");
  return note;
}

/* ---------- 探索タブ ---------- */

export async function listDiscoveryNotesAction(): Promise<discovery.DiscoveryNoteRow[]> {
  const ownerSub = await requireOwnerSub();
  return discovery.listNotesForDiscoveryTab(ownerSub);
}

/** Opting a note in or out. Nothing runs here — the note simply joins (or
 * leaves) the set the scheduled and manual runs look at. */
export async function setNoteDiscoveryEnabledAction(quickNoteId: string, enabled: boolean): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await discovery.setNoteDiscoveryEnabled(ownerSub, quickNoteId, enabled);
  revalidatePath("/scratch");
  revalidatePath("/zettelkasten");
}

export async function getDiscoveryScheduleAction(): Promise<discovery.DiscoverySchedule> {
  const ownerSub = await requireOwnerSub();
  return discovery.getSchedule(ownerSub);
}

export async function saveDiscoveryScheduleAction(input: discovery.DiscoverySchedule): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await discovery.saveSchedule(ownerSub, input);
  revalidatePath("/zettelkasten");
}
