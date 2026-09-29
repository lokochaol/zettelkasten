"use server";

import { revalidatePath } from "next/cache";
import * as projects from "@/lib/projects";
import type { ProjectDetail, ProjectSummary, LinkedQuickNoteRef, LinkedPermanentNoteRef } from "@/lib/projects";
import * as projectTaskNotes from "@/lib/projectTaskNotes";
import type { ProjectTaskNoteView, DayStripEntry } from "@/lib/projectTaskNotes";
import type { ProjectGoals } from "@/lib/projectValidation";
import { requireOwnerSub, requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { ValidationError } from "@/lib/errors";
import { translateDomainError } from "@/lib/i18n/errors";

/** Lazily creates (or fetches) the owner's single default "自分" project —
 * called once from /projects's page load so a brand-new owner always has at
 * least one project to see. */
export async function ensureDefaultProjectAction(): Promise<ProjectSummary> {
  const session = await requireSession();
  return projects.ensureDefaultProject(session.ownerSub, session.user?.name ?? "自分");
}

export async function listActiveProjectsAction(): Promise<ProjectSummary[]> {
  const ownerSub = await requireOwnerSub();
  return projects.listActive(ownerSub);
}

export async function createProjectAction(name: string): Promise<ProjectSummary> {
  const ownerSub = await requireOwnerSub();
  const project = await projects.create(ownerSub, name);
  revalidatePath("/projects");
  return project;
}

export async function getProjectDetailAction(id: string): Promise<ProjectDetail> {
  const ownerSub = await requireOwnerSub();
  return projects.getDetail(ownerSub, id);
}

export async function renameProjectAction(id: string, name: string): Promise<ProjectSummary> {
  const ownerSub = await requireOwnerSub();
  const project = await projects.rename(ownerSub, id, name);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  return project;
}

export async function updateProjectGoalsAction(
  id: string,
  goals: ProjectGoals,
): Promise<{ detail: ProjectDetail } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const detail = await projects.updateGoals(ownerSub, id, goals, locale);
    revalidatePath(`/projects/${id}`);
    return { detail };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { error: translateDomainError(locale, e) };
    }
    throw e;
  }
}

export async function closeProjectAction(id: string): Promise<ProjectDetail> {
  const ownerSub = await requireOwnerSub();
  const detail = await projects.close(ownerSub, id);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  revalidatePath("/dash-off");
  revalidatePath("/calendar");
  return detail;
}

export async function listLinkedNotesAction(
  id: string,
): Promise<{ quickNotes: LinkedQuickNoteRef[]; permanentNotes: LinkedPermanentNoteRef[] }> {
  const ownerSub = await requireOwnerSub();
  return projects.listLinkedNotes(ownerSub, id);
}

export async function listRecentDaysAction(
  id: string,
  daysBack: number,
  todayKey: string,
): Promise<DayStripEntry[]> {
  const ownerSub = await requireOwnerSub();
  return projectTaskNotes.listRecentDays(ownerSub, id, daysBack, todayKey);
}

export async function getProjectTaskNoteAction(id: string, dateKey: string): Promise<ProjectTaskNoteView> {
  const ownerSub = await requireOwnerSub();
  return projectTaskNotes.getOrEmpty(ownerSub, id, dateKey);
}

export async function upsertProjectTaskNoteAction(
  id: string,
  dateKey: string,
  content: string,
): Promise<ProjectTaskNoteView> {
  const ownerSub = await requireOwnerSub();
  const note = await projectTaskNotes.upsertContent(ownerSub, id, dateKey, content);
  revalidatePath(`/projects/${id}`);
  revalidatePath("/calendar");
  return note;
}
