import { prisma } from "@/lib/db";
import { Prisma, QuickNoteSource, QuickNoteStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/errors";
import * as literatureMemos from "@/lib/literatureMemos";
import type { LiteratureMemoRef, LiteratureSelection } from "@/lib/literatureMemos";

export type { LiteratureMemoRef } from "@/lib/literatureMemos";

export interface QuickNoteSummary {
  id: string;
  source: QuickNoteSource;
  encounteredAt: Date;
  /** First non-blank line of content, for a one-line summary in timelines/pickers. */
  preview: string;
  hasLiterature: boolean;
  /** Linked LiteratureMemo's citation, if any — shown inline on the /dash-off timeline card. */
  literatureCitation: string | null;
}

export interface QuickNoteProjectRef {
  id: string;
  name: string;
}

export interface QuickNoteDetail {
  id: string;
  source: QuickNoteSource;
  status: QuickNoteStatus;
  content: string;
  literatureMemo: LiteratureMemoRef | null;
  project: QuickNoteProjectRef | null;
  encounteredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const quickNoteInclude = {
  literatureMemo: true,
  project: true,
} satisfies Prisma.QuickNoteInclude;

type QuickNoteWithDetail = Prisma.QuickNoteGetPayload<{ include: typeof quickNoteInclude }>;

function toLiteratureMemoRef(memo: QuickNoteWithDetail["literatureMemo"]): LiteratureMemoRef | null {
  if (!memo) return null;
  return { id: memo.id, zoteroKey: memo.zoteroKey, citation: memo.citation, url: memo.url, summary: memo.summary };
}

function previewFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? "";
}

function toDetail(note: QuickNoteWithDetail): QuickNoteDetail {
  return {
    id: note.id,
    source: note.source,
    status: note.status,
    content: note.content,
    literatureMemo: toLiteratureMemoRef(note.literatureMemo),
    project: note.project ? { id: note.project.id, name: note.project.name } : null,
    encounteredAt: note.encounteredAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toSummary(note: QuickNoteWithDetail): QuickNoteSummary {
  return {
    id: note.id,
    source: note.source,
    encounteredAt: note.encounteredAt,
    preview: previewFrom(note.content),
    hasLiterature: !!note.literatureMemo,
    literatureCitation: note.literatureMemo?.citation ?? null,
  };
}

/** Internal ownership gate — every mutation and detail read goes through this first. */
export async function requireOwnedQuickNote(ownerSub: string, id: string): Promise<QuickNoteWithDetail> {
  const note = await prisma.quickNote.findFirst({
    where: { id, ownerSub },
    include: quickNoteInclude,
  });
  if (!note) throw new NotFoundError("quickNoteNotFound", `QuickNote not found: ${id}`);
  return note;
}

export async function listActive(ownerSub: string): Promise<QuickNoteSummary[]> {
  const notes = await prisma.quickNote.findMany({
    where: { ownerSub, status: "ACTIVE" },
    orderBy: [{ encounteredAt: "asc" }, { createdAt: "asc" }],
    include: quickNoteInclude,
  });
  return notes.map(toSummary);
}

export async function getDetail(ownerSub: string, id: string): Promise<QuickNoteDetail> {
  const note = await requireOwnedQuickNote(ownerSub, id);
  return toDetail(note);
}

export async function create(
  ownerSub: string,
  source: QuickNoteSource = "SCRATCH",
  literatureMemoId?: string,
  projectId?: string,
): Promise<QuickNoteDetail> {
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerSub } });
    if (!project) throw new NotFoundError("projectNotFound", `Project not found: ${projectId}`);
  }
  const note = await prisma.quickNote.create({
    data: { ownerSub, source, literatureMemoId, projectId },
    include: quickNoteInclude,
  });
  return toDetail(note);
}

export async function updateContent(ownerSub: string, id: string, content: string): Promise<QuickNoteDetail> {
  await requireOwnedQuickNote(ownerSub, id);
  const note = await prisma.quickNote.update({
    where: { id },
    data: { content },
    include: quickNoteInclude,
  });
  return toDetail(note);
}

export async function setLiteratureMemo(
  ownerSub: string,
  id: string,
  selection: LiteratureSelection,
): Promise<QuickNoteDetail> {
  await requireOwnedQuickNote(ownerSub, id);

  const literatureMemoId = await literatureMemos.resolveSelection(prisma, ownerSub, selection);
  await prisma.quickNote.update({
    where: { id },
    data: { literatureMemoId },
  });

  return toDetail(await requireOwnedQuickNote(ownerSub, id));
}

/** Links (or unlinks, with `projectId: null`) a QuickNote to a Project —
 * exempts it from the 1-week stale-archive sweep until that Project closes
 * (see archiveStaleQuickNotes in src/lib/quickNoteArchiving.ts). */
export async function setProject(ownerSub: string, id: string, projectId: string | null): Promise<QuickNoteDetail> {
  await requireOwnedQuickNote(ownerSub, id);
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerSub } });
    if (!project) throw new NotFoundError("projectNotFound", `Project not found: ${projectId}`);
  }
  await prisma.quickNote.update({ where: { id }, data: { projectId } });
  return toDetail(await requireOwnedQuickNote(ownerSub, id));
}

/** Hard-deletes a still-active QuickNote. Once a note is ARCHIVED
 * (promoted), it's part of a PromotionBatch's history and this isn't
 * exposed for it — deletion is only meant for the active timeline. */
export async function remove(ownerSub: string, id: string): Promise<void> {
  await requireOwnedQuickNote(ownerSub, id);
  await prisma.quickNote.delete({ where: { id } });
}

/** Internal only — called exclusively from the promotion transaction (src/lib/promotion.ts). */
export async function archiveMany(
  tx: Prisma.TransactionClient,
  ownerSub: string,
  ids: string[],
): Promise<void> {
  await tx.quickNote.updateMany({
    where: { id: { in: ids }, ownerSub },
    data: { status: "ARCHIVED" },
  });
}

/** Full-text-ish search across a quick note's content, scoped to the owner, active notes only. */
export async function search(ownerSub: string, query: string, limit = 20): Promise<QuickNoteSummary[]> {
  const q = query.trim();
  if (!q) return [];

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT qn.id
    FROM quick_note qn
    WHERE qn.owner_sub = ${ownerSub} AND qn.status = 'ACTIVE'
      AND (qn.content % ${q} OR qn.content ILIKE ${"%" + q + "%"})
    ORDER BY GREATEST(
      similarity(qn.content, ${q}),
      CASE WHEN qn.content ILIKE ${"%" + q + "%"} THEN 0.9 ELSE 0 END
    ) DESC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return [];

  const notes = await prisma.quickNote.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: quickNoteInclude,
  });
  const byId = new Map(notes.map((n) => [n.id, n]));
  return rows.map((r) => toSummary(byId.get(r.id)!)).filter(Boolean);
}
