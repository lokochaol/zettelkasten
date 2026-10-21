import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { shiftDateKey } from "@/lib/dateKey";
import { NotFoundError, ValidationError } from "@/lib/errors";
import * as goals from "@/lib/goals";
import { cleanDateKey, cleanHours, cleanText } from "@/lib/goals";
import { alertsFor, weekMetric, type Alert, type WeekMetric } from "@/lib/goalMetrics";
import { goalColor } from "@/lib/goalColors";
import { listSubPlans, toDays, type DayRow, type SubPlanView } from "@/lib/goalSubPlan";

/**
 * The goals as a plan to live by, not only a list — the way the owner's
 * roadmap document runs it (目標ロードマップと計測・改善の運用):
 *
 *   vision → goals (areas, each with a colour, a weekly budget and phases on
 *   a long roadmap) → a 12-week cycle with targets and evidence → a
 *   standard week of time blocks → the daily 1–2 minute record → the weekly
 *   review (planned vs actual, up to three deliverables, one change) →
 *   4- and 12-week reviews, experiments, and a change log.
 *
 * Observation is computed from the records in src/lib/goalMetrics.ts.
 * src/lib/goals.ts still owns the goals and their phases themselves.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DELIVERABLE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "STEP_DONE", "SUBMITTED", "WAITING", "NEEDS_FIX", "CONFIRMED"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const EVENT_KINDS = ["DEADLINE", "APPLICATION", "EVENT", "REVIEW"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EXPERIMENT_STATUSES = ["RUNNING", "KEPT", "ADJUSTED", "REVERTED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export const REVIEW_KINDS = ["WEEKLY", "FOUR_WEEK", "TWELVE_WEEK"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
/** At most this many priority deliverables a week (§7.2). */
export const MAX_DELIVERABLES_PER_WEEK = 3;

/* ---------- views ---------- */

export interface LifeBudgetLine {
  label: string;
  hours: number;
  note: string;
}

export interface PlanView {
  title: string;
  vision: string;
  baseline: string;
  lifeBudget: LifeBudgetLine[];
  decisionRules: string;
}

export interface CyclePhase {
  label: string;
  fromDateKey: string;
  toDateKey: string;
}

export interface OutcomeView {
  id: string;
  goalId: string | null;
  area: string;
  target: string;
  evidence: string;
  hoursNote: string;
  phaseTexts: string[];
}

export interface CycleView {
  id: string;
  label: string;
  fromDateKey: string;
  toDateKey: string;
  note: string;
  phases: CyclePhase[];
  outcomes: OutcomeView[];
}

export interface SlotView {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  goalId: string | null;
  label: string;
  commute: boolean;
}

export interface EventView {
  id: string;
  goalId: string | null;
  kind: EventKind;
  title: string;
  dateKey: string;
  endDateKey: string | null;
  confirmed: boolean;
  done: boolean;
  note: string;
}

export interface CheckView {
  id: string;
  goalId: string | null;
  question: string;
  method: string;
  impact: string;
  dueDateKey: string | null;
  answer: string;
  done: boolean;
}

export interface TaskView {
  id: string;
  goalId: string | null;
  text: string;
  dueDateKey: string | null;
  done: boolean;
}

export interface ChangeLogView {
  id: string;
  dateKey: string;
  before: string;
  after: string;
  reason: string;
  checkDateKey: string | null;
  source: string;
}

/** The plan written out whole (計画書), one version. */
export interface PlanDocumentView {
  id: string;
  markdown: string;
  source: string;
  /** FULL, MERGE, or "" when it was only kept. */
  applied: string;
  createdOn: string;
}
export type PlanDocumentMeta = Omit<PlanDocumentView, "markdown"> & { chars: number };
export interface PlanOverview extends goals.GoalsOverview {
  plan: PlanView;
  /** The newest version of the 計画書, and the versions before it (newest first). */
  document: PlanDocumentView | null;
  documentVersions: PlanDocumentMeta[];
  /** Areas' detailed plans (goalSubPlan). */
  subPlans: SubPlanView[];
  cycles: CycleView[];
  /** The cycle covering today, else the latest one, else null. */
  currentCycleId: string | null;
  slots: SlotView[];
  events: EventView[];
  checks: CheckView[];
  tasks: TaskView[];
  changeLog: ChangeLogView[];
}

const s = (v: unknown, max = 50_000) => (typeof v === "string" ? v.slice(0, max) : "");
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

function toLifeBudget(value: unknown): LifeBudgetLine[] {
  return (Array.isArray(value) ? value : []).flatMap((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const label = s(r.label, 100).trim();
    return label ? [{ label, hours: Math.max(0, Math.round(n(r.hours) * 4) / 4), note: s(r.note, 500) }] : [];
  });
}

function toPhases(value: unknown): CyclePhase[] {
  return (Array.isArray(value) ? value : []).flatMap((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const fromDateKey = s(r.fromDateKey, 10);
    const toDateKey = s(r.toDateKey, 10);
    return DATE_KEY.test(fromDateKey) && DATE_KEY.test(toDateKey) ? [{ label: s(r.label, 100), fromDateKey, toDateKey }] : [];
  });
}

function toStrings(value: unknown, max = 2000): string[] {
  return (Array.isArray(value) ? value : []).map((v) => s(v, max));
}

const EMPTY_PLAN: PlanView = { title: "", vision: "", baseline: "", lifeBudget: [], decisionRules: "" };

function toPlanView(row: { title: string; vision: string; baseline: string; lifeBudget: unknown; decisionRules: string } | null): PlanView {
  if (!row) return { ...EMPTY_PLAN };
  return { title: row.title, vision: row.vision, baseline: row.baseline, lifeBudget: toLifeBudget(row.lifeBudget), decisionRules: row.decisionRules };
}

type CycleRow = Prisma.GoalCycleGetPayload<{ include: { outcomes: true } }>;
function toCycleView(c: CycleRow): CycleView {
  return {
    id: c.id,
    label: c.label,
    fromDateKey: c.fromDateKey,
    toDateKey: c.toDateKey,
    note: c.note,
    phases: toPhases(c.phases),
    outcomes: [...c.outcomes]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({ id: o.id, goalId: o.goalId, area: o.area, target: o.target, evidence: o.evidence, hoursNote: o.hoursNote, phaseTexts: toStrings(o.phaseTexts) })),
  };
}

const toSlot = (r: Prisma.GoalWeekSlotGetPayload<object>): SlotView => ({
  id: r.id,
  weekday: r.weekday,
  startTime: r.startTime,
  endTime: r.endTime,
  goalId: r.goalId,
  label: r.label,
  commute: r.commute,
});
const toEvent = (r: Prisma.GoalEventGetPayload<object>): EventView => ({
  id: r.id,
  goalId: r.goalId,
  kind: (EVENT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as EventKind) : "EVENT",
  title: r.title,
  dateKey: r.dateKey,
  endDateKey: r.endDateKey,
  confirmed: r.confirmed,
  done: r.done,
  note: r.note,
});
const toCheck = (r: Prisma.GoalCheckGetPayload<object>): CheckView => ({
  id: r.id,
  goalId: r.goalId,
  question: r.question,
  method: r.method,
  impact: r.impact,
  dueDateKey: r.dueDateKey,
  answer: r.answer,
  done: r.doneAt !== null,
});
const toTask = (r: Prisma.GoalTaskGetPayload<object>): TaskView => ({ id: r.id, goalId: r.goalId, text: r.text, dueDateKey: r.dueDateKey, done: r.doneAt !== null });
const toChange = (r: Prisma.GoalChangeLogGetPayload<object>): ChangeLogView => ({
  id: r.id,
  dateKey: r.dateKey,
  before: r.before,
  after: r.after,
  reason: r.reason,
  checkDateKey: r.checkDateKey,
  source: r.source,
});

export function currentCycleOf<C extends { id: string; fromDateKey: string; toDateKey: string }>(cycles: C[], todayKey: string): C | null {
  return cycles.find((c) => c.fromDateKey <= todayKey && c.toDateKey >= todayKey) ?? [...cycles].sort((a, b) => b.fromDateKey.localeCompare(a.fromDateKey))[0] ?? null;
}

export async function getPlanOverview(ownerSub: string, todayKey: string): Promise<PlanOverview> {
  const [base, plan, cycles, slots, events, checks, tasks, changeLog, docs, subPlans] = await Promise.all([
    goals.getOverview(ownerSub),
    prisma.goalPlan.findUnique({ where: { ownerSub } }),
    prisma.goalCycle.findMany({ where: { ownerSub }, include: { outcomes: true }, orderBy: { fromDateKey: "asc" } }),
    prisma.goalWeekSlot.findMany({ where: { ownerSub }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    prisma.goalEvent.findMany({ where: { ownerSub }, orderBy: [{ dateKey: "asc" }, { createdAt: "asc" }] }),
    prisma.goalCheck.findMany({ where: { ownerSub }, orderBy: { createdAt: "asc" } }),
    prisma.goalTask.findMany({ where: { ownerSub }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.goalChangeLog.findMany({ where: { ownerSub }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.goalPlanDocument.findMany({
      where: { ownerSub, subPlanId: null },
      orderBy: { createdAt: "desc" },
      take: MAX_DOCUMENT_VERSIONS,
      select: { id: true, source: true, applied: true, createdAt: true, markdown: true },
    }),
    listSubPlans(ownerSub),
  ]);
  const cycleViews = cycles.map(toCycleView);
  return {
    ...base,
    plan: toPlanView(plan),
    cycles: cycleViews,
    currentCycleId: currentCycleOf(cycleViews, todayKey)?.id ?? null,
    slots: slots.map(toSlot),
    events: events.map(toEvent),
    checks: checks.map(toCheck),
    tasks: tasks.map(toTask),
    changeLog: changeLog.map(toChange),
    document: docs[0] ? toDocument(docs[0]) : null,
    subPlans,
    documentVersions: docs.slice(1).map((d) => ({ id: d.id, source: d.source, applied: d.applied, createdOn: d.createdAt.toISOString().slice(0, 10), chars: d.markdown.length })),
  };
}

/* ---------- the plan document ---------- */

const MAX_DOCUMENT_VERSIONS = 30;
/** A detailed course plan runs past 100,000 characters. */
export const MAX_DOCUMENT_CHARS = 200_000;

function toDocument(d: { id: string; markdown: string; source: string; applied: string; createdAt: Date }): PlanDocumentView {
  return { id: d.id, markdown: d.markdown, source: d.source, applied: d.applied, createdOn: d.createdAt.toISOString().slice(0, 10) };
}

/**
 * Keeps a version of the 計画書. The same text as the newest version only
 * updates how it was applied; older versions past the limit are dropped.
 */
export async function savePlanDocument(
  ownerSub: string,
  markdown: string,
  source: "ADVISOR" | "IMPORT" | "MANUAL",
  applied: "" | "FULL" | "MERGE",
  tx: Prisma.TransactionClient = prisma,
  /** An area's detailed plan the document belongs to; none for the whole plan. */
  subPlanId: string | null = null,
): Promise<PlanDocumentView> {
  const text = cleanText(markdown, MAX_DOCUMENT_CHARS).trim();
  if (!text) throw new ValidationError("goalInvalid", "empty document");
  const latest = await tx.goalPlanDocument.findFirst({ where: { ownerSub, subPlanId }, orderBy: { createdAt: "desc" } });
  if (latest && latest.markdown === text) {
    return toDocument(applied ? await tx.goalPlanDocument.update({ where: { id: latest.id }, data: { applied } }) : latest);
  }
  const row = await tx.goalPlanDocument.create({ data: { ownerSub, markdown: text, source, applied, subPlanId } });
  const stale = await tx.goalPlanDocument.findMany({ where: { ownerSub, subPlanId }, orderBy: { createdAt: "desc" }, skip: MAX_DOCUMENT_VERSIONS, select: { id: true } });
  if (stale.length > 0) await tx.goalPlanDocument.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } });
  return toDocument(row);
}

export async function getPlanDocument(ownerSub: string, id: string): Promise<PlanDocumentView> {
  const row = await prisma.goalPlanDocument.findFirst({ where: { id, ownerSub } });
  if (!row) notFound();
  return toDocument(row);
}

/* ---------- plan ---------- */

export interface PlanPatch {
  title?: string;
  vision?: string;
  baseline?: string;
  lifeBudget?: LifeBudgetLine[];
  decisionRules?: string;
}

export async function savePlan(ownerSub: string, patch: PlanPatch): Promise<PlanView> {
  const data: Prisma.GoalPlanUpdateInput = {};
  if (patch.title !== undefined) data.title = cleanText(patch.title, 200);
  if (patch.vision !== undefined) data.vision = cleanText(patch.vision);
  if (patch.baseline !== undefined) data.baseline = cleanText(patch.baseline);
  if (patch.decisionRules !== undefined) data.decisionRules = cleanText(patch.decisionRules);
  if (patch.lifeBudget !== undefined) data.lifeBudget = toLifeBudget(patch.lifeBudget) as unknown as Prisma.InputJsonValue;
  const row = await prisma.goalPlan.upsert({
    where: { ownerSub },
    create: { ...(data as Omit<Prisma.GoalPlanCreateInput, "ownerSub">), ownerSub },
    update: data,
  });
  return toPlanView(row);
}

/* ---------- shared checks ---------- */

async function ownedGoalId(ownerSub: string, goalId: unknown): Promise<string | null> {
  if (goalId === null || goalId === undefined || goalId === "") return null;
  if (typeof goalId !== "string") throw new ValidationError("goalInvalid", "bad goal");
  const goal = await prisma.goal.findFirst({ where: { id: goalId, ownerSub }, select: { id: true } });
  if (!goal) throw new NotFoundError("goalNotFound", "goal not found");
  return goal.id;
}

function requiredDate(v: unknown): string {
  const d = cleanDateKey(v);
  if (!d) throw new ValidationError("goalInvalid", "date required");
  return d;
}

function requiredText(v: unknown, max = 2000): string {
  const t = cleanText(v ?? "", max).trim();
  if (!t) throw new ValidationError("goalInvalid", "text required");
  return t;
}

function notFound(): never {
  throw new NotFoundError("goalNotFound", "not found");
}

/* ---------- cycles ---------- */

export interface CycleInput {
  label: string;
  fromDateKey: string;
  toDateKey: string;
  note?: string;
  phases?: CyclePhase[];
}

function cleanCycle(input: CycleInput) {
  const fromDateKey = requiredDate(input.fromDateKey);
  const toDateKey = requiredDate(input.toDateKey);
  if (fromDateKey > toDateKey) throw new ValidationError("goalInvalid", "cycle ends before it starts");
  return {
    label: cleanText(input.label ?? "", 200),
    fromDateKey,
    toDateKey,
    note: cleanText(input.note ?? ""),
    phases: toPhases(input.phases ?? []) as unknown as Prisma.InputJsonValue,
  };
}

/** Splits a cycle into stretches of `weeks` weeks — the 4-week phases. */
export function phasesFor(fromDateKey: string, toDateKey: string, weeks = 4, labelFor = (i: number, a: number, b: number) => `第${a}〜${b}週`): CyclePhase[] {
  const out: CyclePhase[] = [];
  let i = 0;
  for (let start = fromDateKey; start <= toDateKey; start = shiftDateKey(start, weeks * 7), i++) {
    const end = shiftDateKey(start, weeks * 7 - 1);
    out.push({ label: labelFor(i, i * weeks + 1, (i + 1) * weeks), fromDateKey: start, toDateKey: end > toDateKey ? toDateKey : end });
  }
  return out;
}

async function requireCycle(ownerSub: string, cycleId: string) {
  const cycle = await prisma.goalCycle.findFirst({ where: { id: cycleId, ownerSub }, include: { outcomes: true } });
  if (!cycle) notFound();
  return cycle;
}

export async function createCycle(ownerSub: string, input: CycleInput): Promise<CycleView> {
  const data = cleanCycle(input);
  if ((data.phases as unknown as CyclePhase[]).length === 0) {
    data.phases = phasesFor(data.fromDateKey, data.toDateKey) as unknown as Prisma.InputJsonValue;
  }
  return toCycleView(await prisma.goalCycle.create({ data: { ownerSub, ...data }, include: { outcomes: true } }));
}

export async function updateCycle(ownerSub: string, cycleId: string, input: CycleInput): Promise<CycleView> {
  await requireCycle(ownerSub, cycleId);
  const data = cleanCycle(input);
  // No phases (or new dates, which the screen sends without them): 4-week ones again.
  if ((data.phases as unknown as CyclePhase[]).length === 0) {
    data.phases = phasesFor(data.fromDateKey, data.toDateKey) as unknown as Prisma.InputJsonValue;
  }
  return toCycleView(await prisma.goalCycle.update({ where: { id: cycleId }, data, include: { outcomes: true } }));
}

export async function deleteCycle(ownerSub: string, cycleId: string): Promise<void> {
  await requireCycle(ownerSub, cycleId);
  await prisma.goalCycle.delete({ where: { id: cycleId } });
}

export interface OutcomeInput {
  goalId: string | null;
  area?: string;
  target: string;
  evidence: string;
  hoursNote?: string;
  phaseTexts?: string[];
}

export async function saveOutcome(ownerSub: string, cycleId: string, outcomeId: string | null, input: OutcomeInput): Promise<CycleView> {
  const cycle = await requireCycle(ownerSub, cycleId);
  const data = {
    goalId: await ownedGoalId(ownerSub, input.goalId),
    area: cleanText(input.area ?? "", 100),
    target: cleanText(input.target ?? "", 5000),
    evidence: cleanText(input.evidence ?? "", 5000),
    hoursNote: cleanText(input.hoursNote ?? "", 500),
    phaseTexts: toStrings(input.phaseTexts ?? []) as unknown as Prisma.InputJsonValue,
  };
  if (outcomeId) {
    if (!cycle.outcomes.some((o) => o.id === outcomeId)) notFound();
    await prisma.goalCycleOutcome.update({ where: { id: outcomeId }, data });
  } else {
    await prisma.goalCycleOutcome.create({ data: { cycleId, ...data, sortOrder: cycle.outcomes.length } });
  }
  return toCycleView(await requireCycle(ownerSub, cycleId));
}

export async function deleteOutcome(ownerSub: string, outcomeId: string): Promise<void> {
  const o = await prisma.goalCycleOutcome.findFirst({ where: { id: outcomeId, cycle: { ownerSub } } });
  if (!o) notFound();
  await prisma.goalCycleOutcome.delete({ where: { id: outcomeId } });
}

/* ---------- the standard week ---------- */

export interface SlotInput {
  weekday: number;
  startTime: string;
  endTime: string;
  goalId: string | null;
  label: string;
  commute: boolean;
}

async function cleanSlot(ownerSub: string, input: SlotInput) {
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new ValidationError("goalInvalid", "bad weekday");
  if (!TIME.test(input.startTime) || !TIME.test(input.endTime) || input.startTime >= input.endTime) {
    throw new ValidationError("goalInvalid", "bad time range");
  }
  return {
    weekday: input.weekday,
    startTime: input.startTime,
    endTime: input.endTime,
    goalId: await ownedGoalId(ownerSub, input.goalId),
    label: cleanText(input.label ?? "", 200),
    commute: input.commute === true,
  };
}

export async function createSlot(ownerSub: string, input: SlotInput): Promise<SlotView> {
  return toSlot(await prisma.goalWeekSlot.create({ data: { ownerSub, ...(await cleanSlot(ownerSub, input)) } }));
}

export async function updateSlot(ownerSub: string, slotId: string, input: SlotInput): Promise<SlotView> {
  if (!(await prisma.goalWeekSlot.findFirst({ where: { id: slotId, ownerSub } }))) notFound();
  return toSlot(await prisma.goalWeekSlot.update({ where: { id: slotId }, data: await cleanSlot(ownerSub, input) }));
}

export async function deleteSlot(ownerSub: string, slotId: string): Promise<void> {
  if (!(await prisma.goalWeekSlot.findFirst({ where: { id: slotId, ownerSub } }))) notFound();
  await prisma.goalWeekSlot.delete({ where: { id: slotId } });
}

/** Minutes a slot lasts. */
export function slotMinutes(slot: Pick<SlotView, "startTime" | "endTime">): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, m(slot.endTime) - m(slot.startTime));
}

/* ---------- events, checks, tasks ---------- */

export interface EventInput {
  goalId: string | null;
  kind: string;
  title: string;
  dateKey: string;
  endDateKey: string | null;
  confirmed: boolean;
  done: boolean;
  note: string;
}

async function cleanEvent(ownerSub: string, input: EventInput) {
  const dateKey = requiredDate(input.dateKey);
  const endDateKey = cleanDateKey(input.endDateKey);
  if (endDateKey && endDateKey < dateKey) throw new ValidationError("goalInvalid", "event ends before it starts");
  return {
    goalId: await ownedGoalId(ownerSub, input.goalId),
    kind: (EVENT_KINDS as readonly string[]).includes(input.kind) ? input.kind : "EVENT",
    title: requiredText(input.title, 300),
    dateKey,
    endDateKey,
    confirmed: input.confirmed === true,
    done: input.done === true,
    note: cleanText(input.note ?? "", 2000),
  };
}

export async function createEvent(ownerSub: string, input: EventInput): Promise<EventView> {
  return toEvent(await prisma.goalEvent.create({ data: { ownerSub, ...(await cleanEvent(ownerSub, input)) } }));
}

export async function updateEvent(ownerSub: string, id: string, input: EventInput): Promise<EventView> {
  if (!(await prisma.goalEvent.findFirst({ where: { id, ownerSub } }))) notFound();
  return toEvent(await prisma.goalEvent.update({ where: { id }, data: await cleanEvent(ownerSub, input) }));
}

export async function deleteEvent(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalEvent.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalEvent.delete({ where: { id } });
}

export interface CheckInput {
  goalId: string | null;
  question: string;
  method: string;
  impact: string;
  dueDateKey: string | null;
  answer: string;
  done: boolean;
}

async function cleanCheck(ownerSub: string, input: CheckInput) {
  return {
    goalId: await ownedGoalId(ownerSub, input.goalId),
    question: requiredText(input.question, 1000),
    method: cleanText(input.method ?? "", 2000),
    impact: cleanText(input.impact ?? "", 2000),
    dueDateKey: cleanDateKey(input.dueDateKey),
    answer: cleanText(input.answer ?? "", 5000),
  };
}

export async function createCheck(ownerSub: string, input: CheckInput): Promise<CheckView> {
  const data = await cleanCheck(ownerSub, input);
  return toCheck(await prisma.goalCheck.create({ data: { ownerSub, ...data, doneAt: input.done ? new Date() : null } }));
}

export async function updateCheck(ownerSub: string, id: string, input: CheckInput): Promise<CheckView> {
  const existing = await prisma.goalCheck.findFirst({ where: { id, ownerSub } });
  if (!existing) notFound();
  const data = await cleanCheck(ownerSub, input);
  return toCheck(
    await prisma.goalCheck.update({
      where: { id },
      data: { ...data, doneAt: input.done ? (existing.doneAt ?? new Date()) : null },
    }),
  );
}

export async function deleteCheck(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalCheck.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalCheck.delete({ where: { id } });
}

export interface TaskInput {
  goalId: string | null;
  text: string;
  dueDateKey: string | null;
  done: boolean;
}

export async function createTask(ownerSub: string, input: TaskInput): Promise<TaskView> {
  const last = await prisma.goalTask.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return toTask(
    await prisma.goalTask.create({
      data: {
        ownerSub,
        goalId: await ownedGoalId(ownerSub, input.goalId),
        text: requiredText(input.text, 1000),
        dueDateKey: cleanDateKey(input.dueDateKey),
        doneAt: input.done ? new Date() : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    }),
  );
}

export async function updateTask(ownerSub: string, id: string, input: TaskInput): Promise<TaskView> {
  const existing = await prisma.goalTask.findFirst({ where: { id, ownerSub } });
  if (!existing) notFound();
  return toTask(
    await prisma.goalTask.update({
      where: { id },
      data: {
        goalId: await ownedGoalId(ownerSub, input.goalId),
        text: requiredText(input.text, 1000),
        dueDateKey: cleanDateKey(input.dueDateKey),
        doneAt: input.done ? (existing.doneAt ?? new Date()) : null,
      },
    }),
  );
}

export async function deleteTask(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalTask.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalTask.delete({ where: { id } });
}

/* ---------- change log ---------- */

export interface ChangeInput {
  dateKey: string;
  before: string;
  after: string;
  reason: string;
  checkDateKey: string | null;
}

export async function addChange(
  ownerSub: string,
  input: ChangeInput,
  source: "MANUAL" | "ADVISOR" | "IMPORT" = "MANUAL",
  tx: Prisma.TransactionClient = prisma,
): Promise<ChangeLogView> {
  return toChange(
    await tx.goalChangeLog.create({
      data: {
        ownerSub,
        dateKey: requiredDate(input.dateKey),
        before: cleanText(input.before ?? "", 5000),
        after: requiredText(input.after, 5000),
        reason: cleanText(input.reason ?? "", 5000),
        checkDateKey: cleanDateKey(input.checkDateKey),
        source,
      },
    }),
  );
}

export async function deleteChange(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalChangeLog.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalChangeLog.delete({ where: { id } });
}

/* ---------- records ---------- */

/** The weekday the plan's weeks start on: its cycle's first day, else Monday. */
export async function weekStartWeekday(ownerSub: string, todayKey: string): Promise<number> {
  const cycles = await prisma.goalCycle.findMany({ where: { ownerSub }, select: { id: true, fromDateKey: true, toDateKey: true } });
  const cycle = currentCycleOf(cycles, todayKey);
  return cycle ? new Date(`${cycle.fromDateKey}T00:00:00Z`).getUTCDay() : 1;
}

export function weekStartOn(dateKey: string, weekday: number): string {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shiftDateKey(dateKey, -((day - weekday + 7) % 7));
}

export interface DailyLogView {
  dateKey: string;
  special: boolean;
  hours: Record<string, number>;
  commuteHours: number;
  progress: string;
  blocker: string;
  next: string;
  life: string;
}

function toHours(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const h = n(v);
      if (h > 0) out[k] = Math.round(h * 4) / 4;
    }
  }
  return out;
}

const toLog = (r: Prisma.GoalDailyLogGetPayload<object>): DailyLogView => ({
  dateKey: r.dateKey,
  special: r.special,
  hours: toHours(r.hours),
  commuteHours: r.commuteHours,
  progress: r.progress,
  blocker: r.blocker,
  next: r.next,
  life: r.life,
});

export interface DailyLogInput {
  special: boolean;
  hours: Record<string, number>;
  commuteHours: number;
  progress: string;
  blocker: string;
  next: string;
  life: string;
}

export async function saveDailyLog(ownerSub: string, dateKey: string, input: DailyLogInput): Promise<DailyLogView> {
  const day = requiredDate(dateKey);
  const owned = new Set((await prisma.goal.findMany({ where: { ownerSub }, select: { id: true } })).map((g) => g.id));
  const hours: Record<string, number> = {};
  for (const [goalId, h] of Object.entries(input.hours ?? {})) {
    if (!owned.has(goalId)) continue;
    const v = cleanHours(h);
    if (v > 24) throw new ValidationError("goalInvalid", "more than a day");
    if (v > 0) hours[goalId] = v;
  }
  const data = {
    special: input.special === true,
    hours: hours as unknown as Prisma.InputJsonValue,
    commuteHours: Math.min(24, cleanHours(input.commuteHours ?? 0)),
    progress: cleanText(input.progress ?? "", 5000),
    blocker: cleanText(input.blocker ?? "", 5000),
    next: cleanText(input.next ?? "", 5000),
    life: cleanText(input.life ?? "", 5000),
  };
  return toLog(
    await prisma.goalDailyLog.upsert({
      where: { ownerSub_dateKey: { ownerSub, dateKey: day } },
      create: { ownerSub, dateKey: day, ...data },
      update: data,
    }),
  );
}

/** The weekly review's own fields (§11.2). */
export interface WeeklyReviewData {
  specialReason: string;
  fixed: string;
  partner: string;
  /** Planned hours per goal for this week, when they differ from the budget. */
  plannedHours: Record<string, number>;
  quality: string;
  lifeNotes: string;
  blocker: string;
  hypothesis: string;
  change: string;
  changeEvidence: string;
  carryContinue: string;
  carryShrink: string;
  carryPostpone: string;
  carryStop: string;
  scheduleChange: string;
}

/** A 4- or 12-week review (§11.3). */
export interface LongReviewData {
  periodFrom: string;
  periodTo: string;
  rows: { goalId: string | null; area: string; outcome: string; change: string; next: string }[];
  keep: string;
  change: string;
  addPostpone: string;
  nextBudget: string;
  nextTargets: string;
  ganttChanges: string;
  unknowns: string;
  firstWeek: string;
}

export interface ReviewView<D> {
  id: string;
  kind: ReviewKind;
  dateKey: string;
  special: boolean;
  data: D;
}

const WEEKLY_FIELDS: (keyof Omit<WeeklyReviewData, "plannedHours">)[] = [
  "specialReason", "fixed", "partner", "quality", "lifeNotes", "blocker", "hypothesis", "change", "changeEvidence",
  "carryContinue", "carryShrink", "carryPostpone", "carryStop", "scheduleChange",
];
const LONG_FIELDS: (keyof Omit<LongReviewData, "rows" | "periodFrom" | "periodTo">)[] = [
  "keep", "change", "addPostpone", "nextBudget", "nextTargets", "ganttChanges", "unknowns", "firstWeek",
];

export function toWeeklyData(value: unknown): WeeklyReviewData {
  const r = (value ?? {}) as Record<string, unknown>;
  const out = Object.fromEntries(WEEKLY_FIELDS.map((f) => [f, s(r[f], 5000)])) as Omit<WeeklyReviewData, "plannedHours">;
  return { ...out, plannedHours: toHours(r.plannedHours) };
}

export function toLongData(value: unknown): LongReviewData {
  const r = (value ?? {}) as Record<string, unknown>;
  const out = Object.fromEntries(LONG_FIELDS.map((f) => [f, s(r[f], 5000)])) as Omit<LongReviewData, "rows" | "periodFrom" | "periodTo">;
  const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, 30).map((x) => {
    const row = (x ?? {}) as Record<string, unknown>;
    return {
      goalId: typeof row.goalId === "string" && row.goalId ? row.goalId : null,
      area: s(row.area, 100),
      outcome: s(row.outcome, 5000),
      change: s(row.change, 5000),
      next: s(row.next, 5000),
    };
  });
  return { ...out, periodFrom: DATE_KEY.test(s(r.periodFrom)) ? s(r.periodFrom) : "", periodTo: DATE_KEY.test(s(r.periodTo)) ? s(r.periodTo) : "", rows };
}

export async function saveReview(
  ownerSub: string,
  kind: ReviewKind,
  dateKey: string,
  special: boolean,
  data: unknown,
): Promise<ReviewView<WeeklyReviewData | LongReviewData>> {
  if (!(REVIEW_KINDS as readonly string[]).includes(kind)) throw new ValidationError("goalInvalid", "bad review kind");
  const day = requiredDate(dateKey);
  const clean = kind === "WEEKLY" ? toWeeklyData(data) : toLongData(data);
  const row = await prisma.goalReview.upsert({
    where: { ownerSub_kind_dateKey: { ownerSub, kind, dateKey: day } },
    create: { ownerSub, kind, dateKey: day, special: special === true, data: clean as unknown as Prisma.InputJsonValue },
    update: { special: special === true, data: clean as unknown as Prisma.InputJsonValue },
  });
  return { id: row.id, kind, dateKey: row.dateKey, special: row.special, data: clean };
}

export async function deleteReview(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalReview.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalReview.delete({ where: { id } });
}

export interface DeliverableView {
  id: string;
  goalId: string | null;
  weekStartDateKey: string;
  title: string;
  condition: string;
  status: DeliverableStatus;
  evidence: string;
  checkDateKey: string | null;
  statusChangedOn: string;
}

const toDeliverable = (r: Prisma.GoalDeliverableGetPayload<object>): DeliverableView => ({
  id: r.id,
  goalId: r.goalId,
  weekStartDateKey: r.weekStartDateKey,
  title: r.title,
  condition: r.condition,
  status: (DELIVERABLE_STATUSES as readonly string[]).includes(r.status) ? (r.status as DeliverableStatus) : "NOT_STARTED",
  evidence: r.evidence,
  checkDateKey: r.checkDateKey,
  statusChangedOn: r.statusChangedAt.toISOString().slice(0, 10),
});

export interface DeliverableInput {
  goalId: string | null;
  title: string;
  condition: string;
  status: string;
  evidence: string;
  checkDateKey: string | null;
}

async function cleanDeliverable(ownerSub: string, input: DeliverableInput) {
  return {
    goalId: await ownedGoalId(ownerSub, input.goalId),
    title: requiredText(input.title, 500),
    condition: cleanText(input.condition ?? "", 2000),
    status: (DELIVERABLE_STATUSES as readonly string[]).includes(input.status) ? input.status : "NOT_STARTED",
    evidence: cleanText(input.evidence ?? "", 2000),
    checkDateKey: cleanDateKey(input.checkDateKey),
  };
}

export async function createDeliverable(ownerSub: string, weekStartDateKey: string, input: DeliverableInput): Promise<DeliverableView> {
  const week = requiredDate(weekStartDateKey);
  const count = await prisma.goalDeliverable.count({ where: { ownerSub, weekStartDateKey: week } });
  if (count >= MAX_DELIVERABLES_PER_WEEK) throw new ValidationError("goalDeliverableLimit", "at most three a week");
  return toDeliverable(await prisma.goalDeliverable.create({ data: { ownerSub, weekStartDateKey: week, ...(await cleanDeliverable(ownerSub, input)) } }));
}

export async function updateDeliverable(ownerSub: string, id: string, input: DeliverableInput): Promise<DeliverableView> {
  const existing = await prisma.goalDeliverable.findFirst({ where: { id, ownerSub } });
  if (!existing) notFound();
  const data = await cleanDeliverable(ownerSub, input);
  return toDeliverable(
    await prisma.goalDeliverable.update({
      where: { id },
      data: { ...data, ...(data.status !== existing.status ? { statusChangedAt: new Date() } : {}) },
    }),
  );
}

/** Takes an unfinished deliverable into another week (持ち越し). */
export async function moveDeliverable(ownerSub: string, id: string, weekStartDateKey: string): Promise<DeliverableView> {
  if (!(await prisma.goalDeliverable.findFirst({ where: { id, ownerSub } }))) notFound();
  const week = requiredDate(weekStartDateKey);
  const count = await prisma.goalDeliverable.count({ where: { ownerSub, weekStartDateKey: week } });
  if (count >= MAX_DELIVERABLES_PER_WEEK) throw new ValidationError("goalDeliverableLimit", "at most three a week");
  return toDeliverable(await prisma.goalDeliverable.update({ where: { id }, data: { weekStartDateKey: week } }));
}

export async function deleteDeliverable(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalDeliverable.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalDeliverable.delete({ where: { id } });
}

export interface ExperimentView {
  id: string;
  goalId: string | null;
  observation: string;
  hypothesis: string;
  change: string;
  evidence: string;
  reviewDateKey: string | null;
  keepIf: string;
  otherwise: string;
  status: ExperimentStatus;
  outcome: string;
  createdOn: string;
}

const toExperiment = (r: Prisma.GoalExperimentGetPayload<object>): ExperimentView => ({
  id: r.id,
  goalId: r.goalId,
  observation: r.observation,
  hypothesis: r.hypothesis,
  change: r.change,
  evidence: r.evidence,
  reviewDateKey: r.reviewDateKey,
  keepIf: r.keepIf,
  otherwise: r.otherwise,
  status: (EXPERIMENT_STATUSES as readonly string[]).includes(r.status) ? (r.status as ExperimentStatus) : "RUNNING",
  outcome: r.outcome,
  createdOn: r.createdAt.toISOString().slice(0, 10),
});

export type ExperimentInput = Omit<ExperimentView, "id" | "createdOn" | "status"> & { status: string };

async function cleanExperiment(ownerSub: string, input: ExperimentInput) {
  return {
    goalId: await ownedGoalId(ownerSub, input.goalId),
    observation: cleanText(input.observation ?? "", 3000),
    hypothesis: cleanText(input.hypothesis ?? "", 3000),
    change: requiredText(input.change, 3000),
    evidence: cleanText(input.evidence ?? "", 3000),
    reviewDateKey: cleanDateKey(input.reviewDateKey),
    keepIf: cleanText(input.keepIf ?? "", 3000),
    otherwise: cleanText(input.otherwise ?? "", 3000),
    status: (EXPERIMENT_STATUSES as readonly string[]).includes(input.status) ? input.status : "RUNNING",
    outcome: cleanText(input.outcome ?? "", 3000),
  };
}

export async function createExperiment(ownerSub: string, input: ExperimentInput): Promise<ExperimentView> {
  return toExperiment(await prisma.goalExperiment.create({ data: { ownerSub, ...(await cleanExperiment(ownerSub, input)) } }));
}

export async function updateExperiment(ownerSub: string, id: string, input: ExperimentInput): Promise<ExperimentView> {
  if (!(await prisma.goalExperiment.findFirst({ where: { id, ownerSub } }))) notFound();
  return toExperiment(await prisma.goalExperiment.update({ where: { id }, data: await cleanExperiment(ownerSub, input) }));
}

export async function deleteExperiment(ownerSub: string, id: string): Promise<void> {
  if (!(await prisma.goalExperiment.findFirst({ where: { id, ownerSub } }))) notFound();
  await prisma.goalExperiment.delete({ where: { id } });
}

/** Everything the 記録 tab shows for one week. */
export interface WeekRecords {
  weekStartDateKey: string;
  logs: DailyLogView[];
  review: ReviewView<WeeklyReviewData> | null;
  deliverables: DeliverableView[];
  /** Earlier weeks' deliverables still open — to carry, shrink, postpone or drop. */
  carried: DeliverableView[];
  longReviews: ReviewView<LongReviewData>[];
  experiments: ExperimentView[];
}

const OPEN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "NEEDS_FIX", "SUBMITTED"];

export async function getWeekRecords(ownerSub: string, weekStartDateKey: string): Promise<WeekRecords> {
  const week = requiredDate(weekStartDateKey);
  const end = shiftDateKey(week, 6);
  const [logs, review, deliverables, carried, longReviews, experiments] = await Promise.all([
    prisma.goalDailyLog.findMany({ where: { ownerSub, dateKey: { gte: week, lte: end } }, orderBy: { dateKey: "asc" } }),
    prisma.goalReview.findUnique({ where: { ownerSub_kind_dateKey: { ownerSub, kind: "WEEKLY", dateKey: week } } }),
    prisma.goalDeliverable.findMany({ where: { ownerSub, weekStartDateKey: week }, orderBy: { createdAt: "asc" } }),
    prisma.goalDeliverable.findMany({
      where: { ownerSub, weekStartDateKey: { lt: week }, status: { in: OPEN_STATUSES } },
      orderBy: { weekStartDateKey: "desc" },
      take: 20,
    }),
    prisma.goalReview.findMany({ where: { ownerSub, kind: { in: ["FOUR_WEEK", "TWELVE_WEEK"] } }, orderBy: { dateKey: "desc" }, take: 10 }),
    prisma.goalExperiment.findMany({ where: { ownerSub }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return {
    weekStartDateKey: week,
    logs: logs.map(toLog),
    review: review ? { id: review.id, kind: "WEEKLY", dateKey: review.dateKey, special: review.special, data: toWeeklyData(review.data) } : null,
    deliverables: deliverables.map(toDeliverable),
    carried: carried.map(toDeliverable),
    longReviews: longReviews.map((r) => ({ id: r.id, kind: r.kind as ReviewKind, dateKey: r.dateKey, special: r.special, data: toLongData(r.data) })),
    experiments: experiments.map(toExperiment),
  };
}

/* ---------- observation ---------- */

export interface Observation {
  todayKey: string;
  weekStartDateKey: string;
  /** Oldest first, this week last. */
  weeks: WeekMetric[];
  alerts: Alert[];
  /** Deliverables still in play (this week's and carried), by status. */
  deliverables: DeliverableView[];
  experiments: ExperimentView[];
}

const OBSERVED_WEEKS = 8;

export async function observe(ownerSub: string, todayKey: string): Promise<Observation> {
  const weekday = await weekStartWeekday(ownerSub, todayKey);
  const thisWeek = weekStartOn(todayKey, weekday);
  const firstWeek = shiftDateKey(thisWeek, -7 * (OBSERVED_WEEKS - 1));
  const [goalRows, logs, reviews, deliverables, checks, events, experiments, firstCycle, firstLog, steps] = await Promise.all([
    prisma.goal.findMany({ where: { ownerSub, status: "ACTIVE" }, select: { id: true, weeklyHours: true } }),
    prisma.goalDailyLog.findMany({ where: { ownerSub, dateKey: { gte: firstWeek, lte: shiftDateKey(thisWeek, 6) } } }),
    prisma.goalReview.findMany({ where: { ownerSub, kind: "WEEKLY", dateKey: { gte: firstWeek } } }),
    prisma.goalDeliverable.findMany({
      where: { ownerSub, OR: [{ weekStartDateKey: thisWeek }, { status: { in: OPEN_STATUSES } }] },
      orderBy: [{ weekStartDateKey: "desc" }, { createdAt: "asc" }],
      take: 60,
    }),
    prisma.goalCheck.findMany({ where: { ownerSub, doneAt: null } }),
    prisma.goalEvent.findMany({ where: { ownerSub, done: false } }),
    prisma.goalExperiment.findMany({ where: { ownerSub, status: "RUNNING" } }),
    prisma.goalCycle.findFirst({ where: { ownerSub }, orderBy: { fromDateKey: "asc" }, select: { fromDateKey: true } }),
    prisma.goalDailyLog.findFirst({ where: { ownerSub }, orderBy: { dateKey: "asc" }, select: { dateKey: true } }),
    prisma.goalItemStep.findMany({
      where: { subPlan: { ownerSub }, doneAt: null, dateKey: { gte: shiftDateKey(todayKey, -60), lte: shiftDateKey(todayKey, 7) } },
      include: { item: { select: { title: true } } },
      orderBy: { dateKey: "asc" },
      take: 80,
    }),
  ]);
  const starts = [firstCycle?.fromDateKey, firstLog?.dateKey].filter((d): d is string => !!d).sort();
  const metricLogs = logs.map((l) => ({ dateKey: l.dateKey, special: l.special, hours: toHours(l.hours) }));
  const weeks: WeekMetric[] = [];
  for (let i = 0; i < OBSERVED_WEEKS; i++) {
    const start = shiftDateKey(firstWeek, 7 * i);
    const review = reviews.find((r) => r.dateKey === start);
    const planned = review ? toWeeklyData(review.data).plannedHours : null;
    weeks.push(weekMetric(start, goalRows, metricLogs, planned && Object.keys(planned).length > 0 ? planned : null, review?.special ?? false));
  }
  const deliverableViews = deliverables.map(toDeliverable);
  const experimentViews = experiments.map(toExperiment);
  const alerts = alertsFor({
    todayKey,
    weeks,
    currentWeekStart: thisWeek,
    logDates: metricLogs.map((l) => l.dateKey),
    recordsFrom: starts[0] ?? null,
    deliverables: deliverableViews,
    checks: checks.map((c) => ({ id: c.id, title: c.question, dateKey: c.dueDateKey, done: false })),
    // An application window is due when it closes.
    events: events.map((e) => ({ id: e.id, title: e.title, dateKey: e.kind === "APPLICATION" ? (e.endDateKey ?? e.dateKey) : e.dateKey, done: e.done, kind: e.kind })),
    experiments: experimentViews.map((x) => ({ id: x.id, title: x.change, dateKey: x.reviewDateKey, done: false })),
    steps: steps.map((x) => ({ id: x.id, label: x.label, itemTitle: x.item?.title ?? "", kind: x.kind, dateKey: x.dateKey, backupDateKey: x.backupDateKey, done: false })),
  });
  return { todayKey, weekStartDateKey: thisWeek, weeks, alerts, deliverables: deliverableViews, experiments: experimentViews };
}

/** What today's standard week holds, and the dated things close by — for
 * the calendar's 今日. */
export interface TodayPlan {
  slots: SlotView[];
  events: EventView[];
  /** Detailed plans' steps within the week (and targets passed, still open). */
  steps: { id: string; goalId: string | null; label: string; itemTitle: string; kind: string; dateKey: string; backupDateKey: string | null }[];
  /** Today's row of a detailed plan's day-by-day table. */
  dayRows: { title: string; goalId: string | null; row: DayRow }[];
  /** The goals the slots and events name, with the colour /goals gives them. */
  goals: { id: string; title: string; hex: string }[];
}

export async function todayPlan(ownerSub: string, todayKey: string): Promise<TodayPlan> {
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  const horizon = shiftDateKey(todayKey, 14);
  const [goalRows, slots, events, subPlans] = await Promise.all([
    prisma.goal.findMany({ where: { ownerSub }, select: { id: true, title: true, color: true, status: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.goalWeekSlot.findMany({ where: { ownerSub, weekday }, orderBy: { startTime: "asc" } }),
    prisma.goalEvent.findMany({
      where: {
        ownerSub,
        done: false,
        OR: [
          { dateKey: { gte: todayKey, lte: horizon } },
          // A window that's open now.
          { dateKey: { lte: todayKey }, endDateKey: { gte: todayKey } },
        ],
      },
      orderBy: { dateKey: "asc" },
    }),
    prisma.goalSubPlan.findMany({
      where: { ownerSub },
      select: {
        title: true,
        goalId: true,
        days: true,
        steps: {
          where: { doneAt: null, kind: { not: "WORK" }, dateKey: { lte: shiftDateKey(todayKey, 7) }, OR: [{ dateKey: { gte: todayKey } }, { kind: "DUE", dateKey: { gte: shiftDateKey(todayKey, -14) } }] },
          include: { item: { select: { title: true } } },
          orderBy: { dateKey: "asc" },
        },
      },
    }),
  ]);
  // Coloured by place among all goals, active first — as goals.getOverview orders them.
  const ordered = [...goalRows.filter((g) => g.status === "ACTIVE"), ...goalRows.filter((g) => g.status !== "ACTIVE")];
  return {
    slots: slots.map(toSlot),
    events: events.map(toEvent),
    goals: ordered.map((g, i) => ({ id: g.id, title: g.title, hex: goalColor(g.color, i).hex })),
    steps: subPlans
      .flatMap((p) => p.steps.map((x) => ({ id: x.id, goalId: p.goalId, label: x.label, itemTitle: x.item?.title ?? "", kind: x.kind, dateKey: x.dateKey, backupDateKey: x.backupDateKey })))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(0, 12),
    dayRows: subPlans.flatMap((p) => toDays(p.days).filter((d) => d.dateKey === todayKey).map((row) => ({ title: p.title, goalId: p.goalId, row }))),
  };
}

export { DATE_KEY as PLAN_DATE_KEY, TIME as PLAN_TIME };
export type { Alert, WeekMetric };
