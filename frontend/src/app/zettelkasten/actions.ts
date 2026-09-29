"use server";

import { revalidatePath } from "next/cache";
import * as permanentNotes from "@/lib/permanentNotes";
import type { PermanentNoteDetail } from "@/lib/permanentNotes";
import * as indexEntries from "@/lib/indexEntries";
import * as promotion from "@/lib/promotion";
import type { CompletePromotionInput, CompletePromotionResult } from "@/lib/promotion";
import type { LiteratureSelection } from "@/lib/literatureMemos";
import { requireOwnerSub } from "@/lib/session";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";

export async function getGlobalOrderAction() {
  const ownerSub = await requireOwnerSub();
  return permanentNotes.getGlobalOrder(ownerSub);
}

export async function getPermanentNoteDetailAction(id: string) {
  const ownerSub = await requireOwnerSub();
  return permanentNotes.getDetail(ownerSub, id);
}

export async function updatePermanentNoteAction(
  id: string,
  title: string,
  content: string,
): Promise<{ note: PermanentNoteDetail } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    const note = await permanentNotes.updateTitleAndContent(ownerSub, id, title, content);
    revalidatePath("/zettelkasten");
    return { note };
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ValidationError) {
      return { error: translateDomainError(await getLocale(), e) };
    }
    throw e;
  }
}

export async function getPermanentNoteDeletionImpactAction(id: string) {
  const ownerSub = await requireOwnerSub();
  return permanentNotes.deletionImpact(ownerSub, id);
}

export async function deletePermanentNoteAction(id: string) {
  const ownerSub = await requireOwnerSub();
  await permanentNotes.remove(ownerSub, id);
  revalidatePath("/zettelkasten");
}

export async function addPermanentNoteLinkAction(
  sourceNoteId: string,
  target: { type: "PERMANENT_NOTE"; noteId: string } | { type: "INDEX_ENTRY"; indexEntryId: string },
  relationLabel: string,
) {
  const ownerSub = await requireOwnerSub();
  await permanentNotes.addLink(ownerSub, sourceNoteId, target, relationLabel);
  revalidatePath("/zettelkasten");
}

export async function removePermanentNoteLinkAction(sourceNoteId: string, linkId: string) {
  const ownerSub = await requireOwnerSub();
  await permanentNotes.removeLink(ownerSub, sourceNoteId, linkId);
  revalidatePath("/zettelkasten");
}

export async function addPermanentNoteLiteratureAction(
  id: string,
  selection: LiteratureSelection,
): Promise<PermanentNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await permanentNotes.addLiteratureMemo(ownerSub, id, selection);
  revalidatePath("/zettelkasten");
  return note;
}

export async function removePermanentNoteLiteratureAction(
  id: string,
  literatureMemoId: string,
): Promise<PermanentNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await permanentNotes.removeLiteratureMemo(ownerSub, id, literatureMemoId);
  revalidatePath("/zettelkasten");
  return note;
}

export async function computeInsertRankAction(beforeId: string | null, afterId: string | null) {
  const ownerSub = await requireOwnerSub();
  return permanentNotes.insertRank(ownerSub, beforeId, afterId);
}

export async function createIndexEntryAction(
  keyword: string,
  noteId: string,
): Promise<{ entry: indexEntries.IndexEntrySummary } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    const entry = await indexEntries.create(ownerSub, keyword, noteId);
    revalidatePath("/zettelkasten");
    return { entry };
  } catch (e) {
    if (e instanceof ConflictError || e instanceof NotFoundError) {
      return { error: translateDomainError(await getLocale(), e) };
    }
    throw e;
  }
}

export async function removeIndexEntryAction(id: string) {
  const ownerSub = await requireOwnerSub();
  await indexEntries.remove(ownerSub, id);
  revalidatePath("/zettelkasten");
}

export async function listIndexEntriesAction() {
  const ownerSub = await requireOwnerSub();
  return indexEntries.list(ownerSub);
}

export async function completePromotionAction(
  input: CompletePromotionInput,
): Promise<{ result: CompletePromotionResult } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const result = await promotion.completePromotion(ownerSub, input, locale);
    revalidatePath("/dash-off");
    revalidatePath("/zettelkasten");
    return { result };
  } catch (e) {
    if (e instanceof ConflictError || e instanceof NotFoundError || e instanceof ValidationError) {
      return { error: translateDomainError(locale, e) };
    }
    throw e;
  }
}
