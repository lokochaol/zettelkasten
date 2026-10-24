"use server";

import { revalidatePath } from "next/cache";
import * as plan from "@/lib/goalPlan";
import * as planImport from "@/lib/goalPlanImport";
import * as advisor from "@/lib/goalAdvisor";
import * as subPlan from "@/lib/goalSubPlan";
import { requireOwnerSub } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDomainError } from "@/lib/i18n/errors";

type Result<T> = T | { error: string };

/** A change, with domain errors turned into text for the screen. The
 * calendar's 今日 reads the plan too, so it's refreshed with it. */
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

const ok = { ok: true as const };

export async function getPlanOverviewAction(todayKey: string): Promise<plan.PlanOverview> {
  return plan.getPlanOverview(await requireOwnerSub(), todayKey);
}

export async function savePlanAction(patch: plan.PlanPatch) {
  return run(async (o) => ({ plan: await plan.savePlan(o, patch) }));
}

export async function createCycleAction(input: plan.CycleInput) {
  return run(async (o) => ({ cycle: await plan.createCycle(o, input) }));
}
export async function updateCycleAction(id: string, input: plan.CycleInput) {
  return run(async (o) => ({ cycle: await plan.updateCycle(o, id, input) }));
}
export async function deleteCycleAction(id: string) {
  return run(async (o) => (await plan.deleteCycle(o, id), ok));
}
export async function saveOutcomeAction(cycleId: string, outcomeId: string | null, input: plan.OutcomeInput) {
  return run(async (o) => ({ cycle: await plan.saveOutcome(o, cycleId, outcomeId, input) }));
}
export async function deleteOutcomeAction(id: string) {
  return run(async (o) => (await plan.deleteOutcome(o, id), ok));
}

export async function createSlotAction(input: plan.SlotInput) {
  return run(async (o) => ({ slot: await plan.createSlot(o, input) }));
}
export async function updateSlotAction(id: string, input: plan.SlotInput) {
  return run(async (o) => ({ slot: await plan.updateSlot(o, id, input) }));
}
export async function deleteSlotAction(id: string) {
  return run(async (o) => (await plan.deleteSlot(o, id), ok));
}

export async function createEventAction(input: plan.EventInput) {
  return run(async (o) => ({ event: await plan.createEvent(o, input) }));
}
export async function updateEventAction(id: string, input: plan.EventInput) {
  return run(async (o) => ({ event: await plan.updateEvent(o, id, input) }));
}
export async function deleteEventAction(id: string) {
  return run(async (o) => (await plan.deleteEvent(o, id), ok));
}

export async function createCheckAction(input: plan.CheckInput) {
  return run(async (o) => ({ check: await plan.createCheck(o, input) }));
}
export async function updateCheckAction(id: string, input: plan.CheckInput) {
  return run(async (o) => ({ check: await plan.updateCheck(o, id, input) }));
}
export async function deleteCheckAction(id: string) {
  return run(async (o) => (await plan.deleteCheck(o, id), ok));
}

export async function createTaskAction(input: plan.TaskInput) {
  return run(async (o) => ({ task: await plan.createTask(o, input) }));
}
export async function updateTaskAction(id: string, input: plan.TaskInput) {
  return run(async (o) => ({ task: await plan.updateTask(o, id, input) }));
}
export async function deleteTaskAction(id: string) {
  return run(async (o) => (await plan.deleteTask(o, id), ok));
}

export async function addChangeAction(input: plan.ChangeInput) {
  return run(async (o) => ({ change: await plan.addChange(o, input) }));
}
export async function deleteChangeAction(id: string) {
  return run(async (o) => (await plan.deleteChange(o, id), ok));
}

/* ---------- records ---------- */

export async function weekStartForAction(dateKey: string): Promise<string> {
  const ownerSub = await requireOwnerSub();
  return plan.weekStartOn(dateKey, await plan.weekStartWeekday(ownerSub, dateKey));
}

export async function getWeekRecordsAction(weekStartDateKey: string): Promise<plan.WeekRecords> {
  return plan.getWeekRecords(await requireOwnerSub(), weekStartDateKey);
}

export async function saveDailyLogAction(dateKey: string, input: plan.DailyLogInput) {
  return run(async (o) => ({ log: await plan.saveDailyLog(o, dateKey, input) }));
}

export async function saveReviewAction(kind: plan.ReviewKind, dateKey: string, special: boolean, data: unknown) {
  return run(async (o) => ({ review: await plan.saveReview(o, kind, dateKey, special, data) }));
}
export async function deleteReviewAction(id: string) {
  return run(async (o) => (await plan.deleteReview(o, id), ok));
}

export async function createDeliverableAction(weekStartDateKey: string, input: plan.DeliverableInput) {
  return run(async (o) => ({ deliverable: await plan.createDeliverable(o, weekStartDateKey, input) }));
}
export async function updateDeliverableAction(id: string, input: plan.DeliverableInput) {
  return run(async (o) => ({ deliverable: await plan.updateDeliverable(o, id, input) }));
}
export async function moveDeliverableAction(id: string, weekStartDateKey: string) {
  return run(async (o) => ({ deliverable: await plan.moveDeliverable(o, id, weekStartDateKey) }));
}
export async function deleteDeliverableAction(id: string) {
  return run(async (o) => (await plan.deleteDeliverable(o, id), ok));
}

export async function createExperimentAction(input: plan.ExperimentInput) {
  return run(async (o) => ({ experiment: await plan.createExperiment(o, input) }));
}
export async function updateExperimentAction(id: string, input: plan.ExperimentInput) {
  return run(async (o) => ({ experiment: await plan.updateExperiment(o, id, input) }));
}
export async function deleteExperimentAction(id: string) {
  return run(async (o) => (await plan.deleteExperiment(o, id), ok));
}

export async function observeAction(todayKey: string): Promise<plan.Observation> {
  return plan.observe(await requireOwnerSub(), todayKey);
}

/**
 * Writes in an import the owner has looked over (goalPlanImport.applyPlanImport).
 * `source` is the document it was read from: a file or paste, or a plan the
 * advisor wrote (then its message is marked applied). Either way the
 * document is kept as a version of the 計画書.
 */
export async function applyPlanImportAction(
  draft: unknown,
  todayKey: string,
  mode: { archiveOthers: boolean; replace: boolean },
  source?: { markdown: string; messageId?: string },
) {
  return run(async (o) => {
    try {
      const markdown = source?.messageId ? await advisor.openDocument(o, source.messageId) : source?.markdown;
      const counts = await planImport.applyPlanImport(o, draft, todayKey, {
        archiveOthers: mode.archiveOthers,
        replace: mode.replace,
        document: markdown ? { markdown, source: source?.messageId ? "ADVISOR" : "IMPORT" } : undefined,
      });
      if (source?.messageId) await advisor.markApplied(o, source.messageId);
      return {
        counts,
        overview: await plan.getPlanOverview(o, todayKey),
        messages: source?.messageId ? (await advisor.listMessages(o)).map(advisor.toMessageView) : null,
      };
    } catch (e) {
      if (e instanceof DomainError) throw e;
      // Said, not thrown: an unexpected failure would otherwise reach the
      // screen as "couldn't read it", about a document that was read fine.
      console.error("plan import apply failed", e);
      return { error: getDictionary(await getLocale()).plan.applyFailed };
    }
  });
}

/** The 計画書 edited by hand: kept as a new version, nothing else changes. */
export async function savePlanDocumentAction(markdown: string) {
  return run(async (o) => ({ document: await plan.savePlanDocument(o, markdown, "MANUAL", "") }));
}

export async function getPlanDocumentAction(id: string) {
  return run(async (o) => ({ document: await plan.getPlanDocument(o, id) }));
}

/* ---------- advisor ---------- */

export async function getAdvisorMessagesAction(): Promise<advisor.AdvisorMessageView[]> {
  return (await advisor.listMessages(await requireOwnerSub())).map(advisor.toMessageView);
}

export async function applyAdvisorProposalAction(messageId: string, todayKey: string) {
  return run(async (o) => {
    const applied = await advisor.applyProposal(o, messageId, todayKey);
    return {
      applied,
      messages: (await advisor.listMessages(o)).map(advisor.toMessageView),
      overview: await plan.getPlanOverview(o, todayKey),
    };
  });
}

export async function clearAdvisorAction() {
  return run(async (o) => (await advisor.clearConversation(o), ok));
}

export async function dismissAdvisorProposalAction(messageId: string) {
  return run(async (o) => {
    await advisor.dismissProposal(o, messageId);
    return { messages: (await advisor.listMessages(o)).map(advisor.toMessageView) };
  });
}

/* ---------- detailed plans ---------- */

export async function createSubPlanAction(goalId: string | null, title: string) {
  return run(async (o) => ({ subPlan: await subPlan.createSubPlan(o, goalId, title) }));
}
export async function updateSubPlanAction(id: string, patch: subPlan.SubPlanPatch) {
  return run(async (o) => ({ subPlan: await subPlan.updateSubPlan(o, id, patch) }));
}
export async function deleteSubPlanAction(id: string) {
  return run(async (o) => (await subPlan.deleteSubPlan(o, id), ok));
}
export async function saveItemAction(subPlanId: string, itemId: string | null, input: subPlan.ItemInput) {
  return run(async (o) => ({ subPlan: await subPlan.saveItem(o, subPlanId, itemId, input) }));
}
export async function deleteItemAction(id: string) {
  return run(async (o) => (await subPlan.deleteItem(o, id), ok));
}
export async function saveStepAction(subPlanId: string, stepId: string | null, input: subPlan.StepInput) {
  return run(async (o) => ({ subPlan: await subPlan.saveStep(o, subPlanId, stepId, input) }));
}
export async function deleteStepAction(id: string) {
  return run(async (o) => (await subPlan.deleteStep(o, id), ok));
}
export async function saveWeekCellAction(subPlanId: string, row: number, col: number, text: string) {
  return run(async (o) => ({ subPlan: await subPlan.saveWeekCell(o, subPlanId, row, col, text) }));
}
export async function getSubPlanDocumentAction(subPlanId: string) {
  return run(async (o) => ({ markdown: await subPlan.subPlanDocument(o, subPlanId) }));
}
