import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { cleanDateKey, cleanText } from "@/lib/goals";

/**
 * An area's detailed plan — the level under the roadmap, where a goal like
 * 大学・建築 becomes a course plan: which courses (items) are taken when,
 * how big each is, where each stands, and the dated steps that get each
 * done (work periods, first drafts, checks, a submission target with its
 * fallback, sessions, decisions). With it, the week-by-week execution table
 * and the day-by-day table for the first days.
 *
 * It's written as a document (the owner's course plan) and read in by the
 * import (goalPlanImport, scope "area"); here it's kept and edited.
 */

export const ITEM_STATUSES = ["PLANNED", "REGISTERED", "IN_PROGRESS", "SUBMITTED", "PASSED", "DONE", "DROPPED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const STEP_KINDS = ["WORK", "DRAFT", "CHECK", "DUE", "SESSION", "DECISION", "OTHER"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

const MAX_ITEMS = 120;
const MAX_STEPS = 400;
const MAX_WEEKS = 80;
const MAX_DAYS = 60;

export interface ItemView {
  id: string;
  group: string;
  code: string;
  title: string;
  kind: string;
  size: number;
  status: ItemStatus;
  record: string;
  periodLabel: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  note: string;
}
export interface StepView {
  id: string;
  itemId: string | null;
  label: string;
  kind: StepKind;
  /** Set for a work period; a point otherwise. */
  startDateKey: string | null;
  dateKey: string;
  /** The fallback when the target slips (予備目標). */
  backupDateKey: string | null;
  done: boolean;
  note: string;
}
export interface WeekRow {
  label: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  cells: string[];
}
export interface DayRow {
  dateKey: string;
  time: string;
  work: string;
  output: string;
}
export interface SubPlanView {
  id: string;
  goalId: string | null;
  title: string;
  summary: string;
  unitLabel: string;
  targetTotal: number;
  /** Counted as done though not in the ledger (認定30). */
  baseDone: number;
  weekColumns: string[];
  weeks: WeekRow[];
  days: DayRow[];
  items: ItemView[];
  steps: StepView[];
  /** The document it was read from or last written as. */
  document: { id: string; createdOn: string; source: string; applied: string; chars: number } | null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 && x <= 10_000 ? Math.round(x * 100) / 100 : 0;
};

export function toWeeks(value: unknown): WeekRow[] {
  return (Array.isArray(value) ? value : []).slice(0, MAX_WEEKS).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return {
      label: str(r.label, 100),
      fromDateKey: cleanDateKey(r.fromDateKey),
      toDateKey: cleanDateKey(r.toDateKey),
      cells: (Array.isArray(r.cells) ? r.cells : []).slice(0, 12).map((c) => str(c, 1500)),
    };
  });
}
export function toDays(value: unknown): DayRow[] {
  return (Array.isArray(value) ? value : []).slice(0, MAX_DAYS).flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const dateKey = cleanDateKey(r.dateKey);
    return dateKey ? [{ dateKey, time: str(r.time, 300), work: str(r.work, 2000), output: str(r.output, 1000) }] : [];
  });
}
export const toColumns = (value: unknown): string[] => (Array.isArray(value) ? value : []).slice(0, 12).map((c) => str(c, 100));

const statusOf = (v: unknown): ItemStatus => ((ITEM_STATUSES as readonly string[]).includes(v as string) ? (v as ItemStatus) : "PLANNED");
const kindOf = (v: unknown): StepKind => ((STEP_KINDS as readonly string[]).includes(v as string) ? (v as StepKind) : "OTHER");

type PlanRow = Prisma.GoalSubPlanGetPayload<{ include: { items: true; steps: true } }>;

function toView(p: PlanRow, doc: SubPlanView["document"]): SubPlanView {
  return {
    id: p.id,
    goalId: p.goalId,
    title: p.title,
    summary: p.summary,
    unitLabel: p.unitLabel,
    targetTotal: p.targetTotal,
    baseDone: p.baseDone,
    weekColumns: toColumns(p.weekColumns),
    weeks: toWeeks(p.weeks),
    days: toDays(p.days),
    items: [...p.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        group: i.group,
        code: i.code,
        title: i.title,
        kind: i.kind,
        size: i.size,
        status: statusOf(i.status),
        record: i.record,
        periodLabel: i.periodLabel,
        fromDateKey: i.fromDateKey,
        toDateKey: i.toDateKey,
        note: i.note,
      })),
    steps: [...p.steps]
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.sortOrder - b.sortOrder)
      .map((x) => ({
        id: x.id,
        itemId: x.itemId,
        label: x.label,
        kind: kindOf(x.kind),
        startDateKey: x.startDateKey,
        dateKey: x.dateKey,
        backupDateKey: x.backupDateKey,
        done: x.doneAt !== null,
        note: x.note,
      })),
    document: doc,
  };
}

export async function listSubPlans(ownerSub: string): Promise<SubPlanView[]> {
  const plans = await prisma.goalSubPlan.findMany({
    where: { ownerSub },
    include: { items: true, steps: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (plans.length === 0) return [];
  const docs = await prisma.goalPlanDocument.findMany({
    where: { ownerSub, subPlanId: { in: plans.map((p) => p.id) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, subPlanId: true, createdAt: true, source: true, applied: true, markdown: true },
  });
  return plans.map((p) => {
    const d = docs.find((x) => x.subPlanId === p.id);
    return toView(p, d ? { id: d.id, createdOn: d.createdAt.toISOString().slice(0, 10), source: d.source, applied: d.applied, chars: d.markdown.length } : null);
  });
}

async function requirePlan(ownerSub: string, id: string) {
  const plan = await prisma.goalSubPlan.findFirst({ where: { id, ownerSub }, include: { items: true, steps: true } });
  if (!plan) throw new NotFoundError("goalNotFound", "sub-plan not found");
  return plan;
}

async function view(ownerSub: string, id: string): Promise<SubPlanView> {
  const found = (await listSubPlans(ownerSub)).find((p) => p.id === id);
  if (!found) throw new NotFoundError("goalNotFound", "sub-plan not found");
  return found;
}

export interface SubPlanPatch {
  title?: string;
  summary?: string;
  unitLabel?: string;
  targetTotal?: number;
  baseDone?: number;
  goalId?: string | null;
}

export async function createSubPlan(ownerSub: string, goalId: string | null, title: string): Promise<SubPlanView> {
  const name = cleanText(title, 200).trim();
  if (!name) throw new ValidationError("goalInvalid", "title required");
  const goal = goalId ? await prisma.goal.findFirst({ where: { id: goalId, ownerSub }, select: { id: true } }) : null;
  const last = await prisma.goalSubPlan.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.goalSubPlan.create({ data: { ownerSub, goalId: goal?.id ?? null, title: name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
  return view(ownerSub, row.id);
}

export async function updateSubPlan(ownerSub: string, id: string, patch: SubPlanPatch): Promise<SubPlanView> {
  await requirePlan(ownerSub, id);
  const data: Prisma.GoalSubPlanUncheckedUpdateInput = {};
  if (patch.title !== undefined && patch.title.trim()) data.title = cleanText(patch.title, 200).trim();
  if (patch.summary !== undefined) data.summary = cleanText(patch.summary, 5000);
  if (patch.unitLabel !== undefined) data.unitLabel = cleanText(patch.unitLabel, 20);
  if (patch.targetTotal !== undefined) data.targetTotal = num(patch.targetTotal);
  if (patch.baseDone !== undefined) data.baseDone = num(patch.baseDone);
  if (patch.goalId !== undefined) {
    data.goalId = patch.goalId ? ((await prisma.goal.findFirst({ where: { id: patch.goalId, ownerSub }, select: { id: true } }))?.id ?? null) : null;
  }
  await prisma.goalSubPlan.update({ where: { id }, data });
  return view(ownerSub, id);
}

export async function deleteSubPlan(ownerSub: string, id: string): Promise<void> {
  await requirePlan(ownerSub, id);
  await prisma.$transaction([prisma.goalPlanDocument.deleteMany({ where: { ownerSub, subPlanId: id } }), prisma.goalSubPlan.delete({ where: { id } })]);
}

export interface ItemInput {
  group?: string;
  code?: string;
  title: string;
  kind?: string;
  size?: number;
  status?: string;
  record?: string;
  periodLabel?: string;
  fromDateKey?: string | null;
  toDateKey?: string | null;
  note?: string;
}

export function cleanItem(input: ItemInput) {
  const title = cleanText(input.title ?? "", 300).trim();
  if (!title) throw new ValidationError("goalInvalid", "title required");
  let fromDateKey = cleanDateKey(input.fromDateKey);
  const toDateKey = cleanDateKey(input.toDateKey);
  if (fromDateKey && toDateKey && fromDateKey > toDateKey) fromDateKey = null;
  return {
    group: cleanText(input.group ?? "", 100),
    code: cleanText(input.code ?? "", 40),
    title,
    kind: cleanText(input.kind ?? "", 60),
    size: num(input.size),
    status: statusOf(input.status),
    record: cleanText(input.record ?? "", 1000),
    periodLabel: cleanText(input.periodLabel ?? "", 300),
    fromDateKey,
    toDateKey,
    note: cleanText(input.note ?? "", 3000),
  };
}

export async function saveItem(ownerSub: string, subPlanId: string, itemId: string | null, input: ItemInput): Promise<SubPlanView> {
  const plan = await requirePlan(ownerSub, subPlanId);
  const data = cleanItem(input);
  if (itemId) {
    if (!plan.items.some((i) => i.id === itemId)) throw new NotFoundError("goalNotFound", "item not found");
    await prisma.goalItem.update({ where: { id: itemId }, data });
  } else {
    if (plan.items.length >= MAX_ITEMS) throw new ValidationError("goalInvalid", "too many items");
    await prisma.goalItem.create({ data: { subPlanId, ...data, sortOrder: plan.items.reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1 } });
  }
  return view(ownerSub, subPlanId);
}

export async function deleteItem(ownerSub: string, itemId: string): Promise<void> {
  const item = await prisma.goalItem.findFirst({ where: { id: itemId, subPlan: { ownerSub } } });
  if (!item) throw new NotFoundError("goalNotFound", "item not found");
  await prisma.goalItem.delete({ where: { id: itemId } });
}

export interface StepInput {
  itemId?: string | null;
  label: string;
  kind?: string;
  startDateKey?: string | null;
  dateKey: string;
  backupDateKey?: string | null;
  done?: boolean;
  note?: string;
}

export function cleanStep(input: StepInput) {
  const label = cleanText(input.label ?? "", 300).trim();
  const dateKey = cleanDateKey(input.dateKey);
  if (!label || !dateKey) throw new ValidationError("goalInvalid", "label and date required");
  let startDateKey = cleanDateKey(input.startDateKey);
  if (startDateKey && startDateKey > dateKey) startDateKey = null;
  let backupDateKey = cleanDateKey(input.backupDateKey);
  if (backupDateKey && backupDateKey < dateKey) backupDateKey = null;
  return { label, kind: kindOf(input.kind), startDateKey, dateKey, backupDateKey, note: cleanText(input.note ?? "", 2000) };
}

export async function saveStep(ownerSub: string, subPlanId: string, stepId: string | null, input: StepInput): Promise<SubPlanView> {
  const plan = await requirePlan(ownerSub, subPlanId);
  const itemId = input.itemId && plan.items.some((i) => i.id === input.itemId) ? input.itemId : null;
  const data = { ...cleanStep(input), itemId };
  if (stepId) {
    const existing = plan.steps.find((x) => x.id === stepId);
    if (!existing) throw new NotFoundError("goalNotFound", "step not found");
    const doneAt = input.done === undefined ? existing.doneAt : input.done ? (existing.doneAt ?? new Date()) : null;
    await prisma.goalItemStep.update({ where: { id: stepId }, data: { ...data, doneAt } });
  } else {
    if (plan.steps.length >= MAX_STEPS) throw new ValidationError("goalInvalid", "too many steps");
    await prisma.goalItemStep.create({ data: { subPlanId, ...data, doneAt: input.done ? new Date() : null, sortOrder: plan.steps.length } });
  }
  return view(ownerSub, subPlanId);
}

export async function deleteStep(ownerSub: string, stepId: string): Promise<void> {
  const step = await prisma.goalItemStep.findFirst({ where: { id: stepId, subPlan: { ownerSub } } });
  if (!step) throw new NotFoundError("goalNotFound", "step not found");
  await prisma.goalItemStep.delete({ where: { id: stepId } });
}

/** One cell of the execution table, edited in place. */
export async function saveWeekCell(ownerSub: string, subPlanId: string, row: number, col: number, text: string): Promise<SubPlanView> {
  const plan = await requirePlan(ownerSub, subPlanId);
  const weeks = toWeeks(plan.weeks);
  if (!weeks[row] || col < 0 || col >= Math.max(toColumns(plan.weekColumns).length, weeks[row].cells.length)) {
    throw new ValidationError("goalInvalid", "no such cell");
  }
  const cells = [...weeks[row].cells];
  while (cells.length <= col) cells.push("");
  cells[col] = str(text, 1500);
  weeks[row] = { ...weeks[row], cells };
  await prisma.goalSubPlan.update({ where: { id: subPlanId }, data: { weeks: weeks as unknown as Prisma.InputJsonValue } });
  return view(ownerSub, subPlanId);
}

export async function subPlanDocument(ownerSub: string, subPlanId: string): Promise<string> {
  const doc = await prisma.goalPlanDocument.findFirst({ where: { ownerSub, subPlanId }, orderBy: { createdAt: "desc" } });
  return doc?.markdown ?? "";
}

/** Steps coming due (or overdue and open) around a day — for the calendar and observation. */
export function upcomingSteps(plans: SubPlanView[], todayKey: string, horizon: string) {
  return plans.flatMap((p) =>
    p.steps
      .filter((s) => !s.done && s.kind !== "WORK" && s.dateKey <= horizon && (s.dateKey >= todayKey || (s.backupDateKey ?? s.dateKey) >= todayKey || s.kind === "DUE"))
      .map((s) => ({ ...s, subPlanId: p.id, goalId: p.goalId, itemTitle: p.items.find((i) => i.id === s.itemId)?.title ?? "" })),
  );
}
