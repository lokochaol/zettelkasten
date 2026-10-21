"use server";

import { revalidatePath } from "next/cache";
import * as goals from "@/lib/goals";
import { requireOwnerSub } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";

export type GoalView = goals.GoalView;
export type MilestoneView = goals.MilestoneView;
export type FocusPeriodView = goals.FocusPeriodView;
export type GoalsOverview = goals.GoalsOverview;
export type ImportDraft = goals.ImportDraft;

type Result<T> = T | { error: string };

/** Runs a change and turns a domain error into text the screen can show.
 * The calendar's 今日 reads the goals too, so it's refreshed with them. */
async function run<T>(work: (ownerSub: string) => Promise<T>): Promise<Result<T>> {
  const ownerSub = await requireOwnerSub();
  try {
    const result = await work(ownerSub);
    revalidatePath("/goals");
    revalidatePath("/calendar");
    return result;
  } catch (e) {
    if (e instanceof DomainError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function getGoalsOverviewAction(): Promise<GoalsOverview> {
  return goals.getOverview(await requireOwnerSub());
}

export async function saveCompassFieldAction(field: goals.CompassField, content: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.saveCompassField(ownerSub, field, content);
    return { ok: true as const };
  });
}

export async function createGoalAction(title: string, todayKey: string): Promise<Result<{ goal: GoalView }>> {
  return run(async (ownerSub) => ({ goal: await goals.createGoal(ownerSub, title, todayKey) }));
}

export async function updateGoalAction(goalId: string, patch: goals.GoalPatch): Promise<Result<{ goal: GoalView }>> {
  return run(async (ownerSub) => ({ goal: await goals.updateGoal(ownerSub, goalId, patch) }));
}

export async function deleteGoalAction(goalId: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.deleteGoal(ownerSub, goalId);
    return { ok: true as const };
  });
}

export async function reorderGoalsAction(goalIds: string[]): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.reorderGoals(ownerSub, goalIds);
    return { ok: true as const };
  });
}

export async function reviewGoalAction(goalId: string, todayKey: string): Promise<Result<{ goal: GoalView }>> {
  return run(async (ownerSub) => ({ goal: await goals.reviewGoal(ownerSub, goalId, todayKey) }));
}

export async function deleteRevisionAction(revisionId: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.deleteRevision(ownerSub, revisionId);
    return { ok: true as const };
  });
}

export async function addMilestoneAction(
  goalId: string,
  label: string,
  dueDateKey: string | null,
  extra: { startDateKey?: string | null; condition?: string } = {},
): Promise<Result<{ milestone: MilestoneView }>> {
  return run(async (ownerSub) => ({ milestone: await goals.addMilestone(ownerSub, goalId, label, dueDateKey, extra) }));
}

export async function updateMilestoneAction(milestoneId: string, patch: goals.MilestonePatch): Promise<Result<{ milestone: MilestoneView }>> {
  return run(async (ownerSub) => ({ milestone: await goals.updateMilestone(ownerSub, milestoneId, patch) }));
}

export async function deleteMilestoneAction(milestoneId: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.deleteMilestone(ownerSub, milestoneId);
    return { ok: true as const };
  });
}

export async function moveMilestoneAction(milestoneId: string, direction: -1 | 1): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.moveMilestone(ownerSub, milestoneId, direction);
    return { ok: true as const };
  });
}

export async function createFocusPeriodAction(input: goals.FocusPeriodInput): Promise<Result<{ period: FocusPeriodView }>> {
  return run(async (ownerSub) => ({ period: await goals.createFocusPeriod(ownerSub, input) }));
}

export async function saveFocusPeriodAction(periodId: string, input: goals.FocusPeriodInput): Promise<Result<{ period: FocusPeriodView }>> {
  return run(async (ownerSub) => ({ period: await goals.saveFocusPeriod(ownerSub, periodId, input) }));
}

export async function deleteFocusPeriodAction(periodId: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await goals.deleteFocusPeriod(ownerSub, periodId);
    return { ok: true as const };
  });
}

/** Writes in an import the owner has looked over (see goals.applyImport),
 * and hands back the page as it now stands. */
export async function applyImportAction(draft: ImportDraft): Promise<Result<{ overview: GoalsOverview; goals: number; periods: number }>> {
  return run(async (ownerSub) => {
    const counts = await goals.applyImport(ownerSub, draft);
    return { overview: await goals.getOverview(ownerSub), ...counts };
  });
}
