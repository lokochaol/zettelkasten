"use server";

import { revalidatePath } from "next/cache";
import * as literatureMemos from "@/lib/literatureMemos";
import type { LiteratureMemoDetail, LiteratureMemoSummary } from "@/lib/literatureMemos";
import { requireOwnerSub } from "@/lib/session";

export async function listLiteratureMemosAction(): Promise<LiteratureMemoSummary[]> {
  const ownerSub = await requireOwnerSub();
  return literatureMemos.list(ownerSub);
}

export async function getLiteratureMemoDetailAction(id: string): Promise<LiteratureMemoDetail> {
  const ownerSub = await requireOwnerSub();
  return literatureMemos.getDetail(ownerSub, id);
}

export async function updateLiteratureMemoSummaryAction(id: string, summary: string | null): Promise<LiteratureMemoDetail> {
  const ownerSub = await requireOwnerSub();
  const detail = await literatureMemos.updateSummary(ownerSub, id, summary);
  revalidatePath("/literature");
  return detail;
}

export async function updateLiteratureMemoDetailsAction(
  id: string,
  input: { citation: string; url: string | null; summary: string | null },
): Promise<LiteratureMemoDetail> {
  const ownerSub = await requireOwnerSub();
  const detail = await literatureMemos.updateDetails(ownerSub, id, input);
  revalidatePath("/literature");
  revalidatePath(`/literature/${id}`);
  return detail;
}

/** The "＋文献メモ" quick-add — creates a blank memo and hands back its id
 * so the caller can navigate straight to /literature/[id] to fill it in. */
export async function createLiteratureMemoAction(): Promise<LiteratureMemoDetail> {
  const ownerSub = await requireOwnerSub();
  const detail = await literatureMemos.create(ownerSub);
  revalidatePath("/literature");
  return detail;
}

export async function removeLiteratureMemoAction(id: string): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await literatureMemos.remove(ownerSub, id);
  revalidatePath("/literature");
  revalidatePath("/dash-off");
  revalidatePath("/zettelkasten");
}
