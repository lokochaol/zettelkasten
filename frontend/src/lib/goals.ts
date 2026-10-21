import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ChatProgress, ProgressItem } from "@/lib/chatProgress";
import { partialString } from "@/lib/chatProgress";
import { dayKindOf, periodFor } from "@/lib/goalFocus";
import type { GoalStatus } from "@/generated/prisma/client";

export type { GoalStatus };

/**
 * Goals — what the days are lived towards.
 *
 * Three layers, the way the owner already keeps them:
 *   - the compass: 指針, いまある幸せ, これだけあれば, 障害プランニング — the
 *     ground the goals stand on, rewritten rarely;
 *   - the 🚩 goals, each with steps at a few horizons ("~2週間後",
 *     "1年後 June 1, 2027") and a review date; a review keeps the version
 *     it replaced, so last year's plan is still there to compare with;
 *   - focus periods: for a stretch of days, which goals a weekday, a day off
 *     and the spare moments go to.
 *
 * The last is what makes "always keep it in mind" practical: the calendar's
 * 今日 reads todayFocus() and puts today's goals and the steps coming due at
 * the top of the day.
 */

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;
const MAX_LABEL = 100;
const MAX_TEXT = 50_000;
const MAX_IMPORT_TEXT = 60_000;
/** How far ahead a step's date counts as "coming up" on the calendar. */
export const UPCOMING_DAYS = 14;

export type FocusSlot = "weekday" | "holiday" | "spare";
export const FOCUS_SLOTS: FocusSlot[] = ["weekday", "holiday", "spare"];

export interface FocusLine {
  /** Null for a line that isn't any one goal's ("生活費が足りなそうであれば単発入れる"). */
  goalId: string | null;
  note: string;
}

export interface MilestoneView {
  id: string;
  label: string;
  /** With dueDateKey, a phase bar on the roadmap; without, a point. */
  startDateKey: string | null;
  dueDateKey: string | null;
  /** 次へ進む条件. */
  condition: string;
  body: string;
  done: boolean;
}

export interface GoalSnapshot {
  title: string;
  statement: string;
  reviewedOnDateKey: string | null;
  milestones: { label: string; dueDateKey: string | null; body: string; done: boolean }[];
}

export interface RevisionView {
  id: string;
  dateKey: string;
  snapshot: GoalSnapshot;
}

export interface GoalView {
  id: string;
  title: string;
  statement: string;
  reviewedOnDateKey: string | null;
  status: GoalStatus;
  /** Palette name (src/lib/goalColors.ts); "" = by position. */
  color: string;
  approach: string;
  weeklyHours: number;
  commuteHours: number;
  budgetNote: string;
  keepRecord: string;
  improveCheck: string;
  milestones: MilestoneView[];
  /** Newest first. */
  revisions: RevisionView[];
}

export interface FocusPeriodView {
  id: string;
  label: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  weekday: FocusLine[];
  holiday: FocusLine[];
  spare: FocusLine[];
}

export const COMPASS_FIELDS = ["principles", "happiness", "essentials", "obstacles", "archive"] as const;
export type CompassField = (typeof COMPASS_FIELDS)[number];
export type CompassView = Record<CompassField, string>;

export interface GoalsOverview {
  compass: CompassView;
  /** Active ones first, each group in the owner's order. */
  goals: GoalView[];
  periods: FocusPeriodView[];
}

/* ---------- reading ---------- */

const goalInclude = {
  milestones: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  revisions: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.GoalInclude;

type GoalRow = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

function toMilestoneView(m: GoalRow["milestones"][number]): MilestoneView {
  return {
    id: m.id,
    label: m.label,
    startDateKey: m.startDateKey,
    dueDateKey: m.dueDateKey,
    condition: m.condition,
    body: m.body,
    done: m.doneAt !== null,
  };
}

function toSnapshot(value: unknown): GoalSnapshot {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const milestones = Array.isArray(o.milestones) ? o.milestones : [];
  return {
    title: str(o.title),
    statement: str(o.statement),
    reviewedOnDateKey: dateKeyOrNull(o.reviewedOnDateKey),
    milestones: milestones.map((m) => {
      const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { label: str(r.label), dueDateKey: dateKeyOrNull(r.dueDateKey), body: str(r.body), done: r.done === true };
    }),
  };
}

function toGoalView(g: GoalRow): GoalView {
  return {
    id: g.id,
    title: g.title,
    statement: g.statement,
    reviewedOnDateKey: g.reviewedOnDateKey,
    status: g.status,
    color: g.color,
    approach: g.approach,
    weeklyHours: g.weeklyHours,
    commuteHours: g.commuteHours,
    budgetNote: g.budgetNote,
    keepRecord: g.keepRecord,
    improveCheck: g.improveCheck,
    milestones: g.milestones.map(toMilestoneView),
    revisions: g.revisions.map((r) => ({ id: r.id, dateKey: r.dateKey, snapshot: toSnapshot(r.snapshot) })),
  };
}

function toLines(value: unknown): FocusLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const r = v as Record<string, unknown>;
    const goalId = typeof r.goalId === "string" && r.goalId ? r.goalId : null;
    const note = str(r.note);
    return goalId || note ? [{ goalId, note }] : [];
  });
}

function toPeriodView(p: {
  id: string;
  label: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  weekday: unknown;
  holiday: unknown;
  spare: unknown;
}): FocusPeriodView {
  return {
    id: p.id,
    label: p.label,
    fromDateKey: p.fromDateKey,
    toDateKey: p.toDateKey,
    weekday: toLines(p.weekday),
    holiday: toLines(p.holiday),
    spare: toLines(p.spare),
  };
}

const EMPTY_COMPASS: CompassView = { principles: "", happiness: "", essentials: "", obstacles: "", archive: "" };

export async function getOverview(ownerSub: string): Promise<GoalsOverview> {
  const [compass, goals, periods] = await Promise.all([
    prisma.goalCompass.findUnique({ where: { ownerSub } }),
    prisma.goal.findMany({
      where: { ownerSub },
      include: goalInclude,
      orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.goalFocusPeriod.findMany({ where: { ownerSub }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    compass: compass ? pickCompass(compass) : { ...EMPTY_COMPASS },
    goals: goals.map(toGoalView),
    periods: periods.map(toPeriodView),
  };
}

function pickCompass(row: CompassView): CompassView {
  return Object.fromEntries(COMPASS_FIELDS.map((f) => [f, row[f]])) as CompassView;
}

/* ---------- validation helpers ---------- */

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function dateKeyOrNull(v: unknown): string | null {
  return typeof v === "string" && DATE_KEY.test(v) ? v : null;
}

export function cleanText(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== "string") throw new ValidationError("goalInvalid", "text is not a string");
  if (v.length > max) throw new ValidationError("goalInvalid", "text too long");
  return v;
}

export function cleanTitle(v: unknown): string {
  const title = cleanText(v, MAX_TITLE).trim();
  if (!title) throw new ValidationError("goalInvalid", "title is empty");
  return title;
}

export function cleanDateKey(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DATE_KEY.test(v)) throw new ValidationError("goalInvalid", "bad date");
  return v;
}

export async function requireGoal(ownerSub: string, goalId: string) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, ownerSub }, include: goalInclude });
  if (!goal) throw new NotFoundError("goalNotFound", "goal not found");
  return goal;
}

async function requireMilestone(ownerSub: string, milestoneId: string) {
  const milestone = await prisma.goalMilestone.findFirst({ where: { id: milestoneId, goal: { ownerSub } } });
  if (!milestone) throw new NotFoundError("goalNotFound", "milestone not found");
  return milestone;
}

/* ---------- compass ---------- */

export async function saveCompassField(ownerSub: string, field: CompassField, content: string): Promise<void> {
  if (!COMPASS_FIELDS.includes(field)) throw new ValidationError("goalInvalid", "unknown field");
  const text = cleanText(content);
  await prisma.goalCompass.upsert({
    where: { ownerSub },
    create: { ownerSub, [field]: text },
    update: { [field]: text },
  });
}

/* ---------- goals ---------- */

async function nextGoalOrder(ownerSub: string, tx: Prisma.TransactionClient = prisma): Promise<number> {
  const last = await tx.goal.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return (last?.sortOrder ?? -1) + 1;
}

export async function createGoal(ownerSub: string, title: string, todayKey: string): Promise<GoalView> {
  const goal = await prisma.goal.create({
    data: {
      ownerSub,
      title: cleanTitle(title),
      reviewedOnDateKey: dateKeyOrNull(todayKey),
      sortOrder: await nextGoalOrder(ownerSub),
    },
    include: goalInclude,
  });
  return toGoalView(goal);
}

export interface GoalPatch {
  title?: string;
  statement?: string;
  reviewedOnDateKey?: string | null;
  status?: GoalStatus;
  color?: string;
  approach?: string;
  weeklyHours?: number;
  commuteHours?: number;
  budgetNote?: string;
  keepRecord?: string;
  improveCheck?: string;
}

/** Hours in a week's budget: 0–168, to a quarter hour. */
export function cleanHours(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 168) throw new ValidationError("goalInvalid", "bad hours");
  return Math.round(n * 4) / 4;
}

export async function updateGoal(ownerSub: string, goalId: string, patch: GoalPatch): Promise<GoalView> {
  await requireGoal(ownerSub, goalId);
  const data: Prisma.GoalUpdateInput = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.statement !== undefined) data.statement = cleanText(patch.statement);
  if (patch.reviewedOnDateKey !== undefined) data.reviewedOnDateKey = cleanDateKey(patch.reviewedOnDateKey);
  if (patch.color !== undefined) data.color = cleanText(patch.color, 20);
  if (patch.approach !== undefined) data.approach = cleanText(patch.approach);
  if (patch.weeklyHours !== undefined) data.weeklyHours = cleanHours(patch.weeklyHours);
  if (patch.commuteHours !== undefined) data.commuteHours = cleanHours(patch.commuteHours);
  if (patch.budgetNote !== undefined) data.budgetNote = cleanText(patch.budgetNote, 2000);
  if (patch.keepRecord !== undefined) data.keepRecord = cleanText(patch.keepRecord, 2000);
  if (patch.improveCheck !== undefined) data.improveCheck = cleanText(patch.improveCheck, 2000);
  if (patch.status !== undefined) {
    if (patch.status !== "ACTIVE" && patch.status !== "ARCHIVED") throw new ValidationError("goalInvalid", "bad status");
    data.status = patch.status;
    // Coming back from the archive puts it at the end of the active list.
    if (patch.status === "ACTIVE") data.sortOrder = await nextGoalOrder(ownerSub);
  }
  const goal = await prisma.goal.update({ where: { id: goalId }, data, include: goalInclude });
  return toGoalView(goal);
}

export async function deleteGoal(ownerSub: string, goalId: string): Promise<void> {
  await requireGoal(ownerSub, goalId);
  await prisma.goal.delete({ where: { id: goalId } });
}

/** Sets the order of the goals named, first to last. Ids not the owner's are ignored. */
export async function reorderGoals(ownerSub: string, goalIds: string[]): Promise<void> {
  const owned = new Set(
    (await prisma.goal.findMany({ where: { ownerSub, id: { in: goalIds } }, select: { id: true } })).map((g) => g.id),
  );
  await prisma.$transaction(
    goalIds.filter((id) => owned.has(id)).map((id, i) => prisma.goal.update({ where: { id }, data: { sortOrder: i } })),
  );
}

/**
 * Starts a review: the goal as it stands is kept as a revision dated today,
 * and the goal's review date becomes today. What follows is ordinary
 * editing — the point is that the version being rewritten isn't lost.
 */
export async function reviewGoal(ownerSub: string, goalId: string, todayKey: string): Promise<GoalView> {
  const goal = await requireGoal(ownerSub, goalId);
  const dateKey = cleanDateKey(todayKey);
  if (!dateKey) throw new ValidationError("goalInvalid", "no date");
  const snapshot: GoalSnapshot = {
    title: goal.title,
    statement: goal.statement,
    reviewedOnDateKey: goal.reviewedOnDateKey,
    milestones: goal.milestones.map((m) => ({ label: m.label, dueDateKey: m.dueDateKey, body: m.body, done: m.doneAt !== null })),
  };
  await prisma.$transaction([
    prisma.goalRevision.create({ data: { goalId, dateKey, snapshot: snapshot as unknown as Prisma.InputJsonValue } }),
    prisma.goal.update({ where: { id: goalId }, data: { reviewedOnDateKey: dateKey } }),
  ]);
  return toGoalView(await requireGoal(ownerSub, goalId));
}

export async function deleteRevision(ownerSub: string, revisionId: string): Promise<void> {
  const revision = await prisma.goalRevision.findFirst({ where: { id: revisionId, goal: { ownerSub } } });
  if (!revision) throw new NotFoundError("goalNotFound", "revision not found");
  await prisma.goalRevision.delete({ where: { id: revisionId } });
}

/* ---------- milestones ---------- */

export async function addMilestone(
  ownerSub: string,
  goalId: string,
  label: string,
  dueDateKey: string | null = null,
  /** For a roadmap phase: where it starts and what lets the next begin. */
  extra: { startDateKey?: string | null; condition?: string; body?: string } = {},
): Promise<MilestoneView> {
  await requireGoal(ownerSub, goalId);
  const last = await prisma.goalMilestone.findFirst({ where: { goalId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const milestone = await prisma.goalMilestone.create({
    data: {
      goalId,
      label: cleanText(label, MAX_LABEL).trim(),
      dueDateKey: cleanDateKey(dueDateKey),
      startDateKey: cleanDateKey(extra.startDateKey ?? null),
      condition: cleanText(extra.condition ?? "", 2000),
      body: cleanText(extra.body ?? ""),
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  return toMilestoneView(milestone);
}

export interface MilestonePatch {
  label?: string;
  startDateKey?: string | null;
  condition?: string;
  dueDateKey?: string | null;
  body?: string;
  done?: boolean;
}

export async function updateMilestone(ownerSub: string, milestoneId: string, patch: MilestonePatch): Promise<MilestoneView> {
  await requireMilestone(ownerSub, milestoneId);
  const data: Prisma.GoalMilestoneUpdateInput = {};
  if (patch.label !== undefined) data.label = cleanText(patch.label, MAX_LABEL).trim();
  if (patch.dueDateKey !== undefined) data.dueDateKey = cleanDateKey(patch.dueDateKey);
  if (patch.startDateKey !== undefined) data.startDateKey = cleanDateKey(patch.startDateKey);
  if (patch.condition !== undefined) data.condition = cleanText(patch.condition, 2000);
  if (patch.body !== undefined) data.body = cleanText(patch.body);
  if (patch.done !== undefined) data.doneAt = patch.done ? new Date() : null;
  return toMilestoneView(await prisma.goalMilestone.update({ where: { id: milestoneId }, data }));
}

export async function deleteMilestone(ownerSub: string, milestoneId: string): Promise<void> {
  await requireMilestone(ownerSub, milestoneId);
  await prisma.goalMilestone.delete({ where: { id: milestoneId } });
}

/** Moves a step one place up or down within its goal. */
export async function moveMilestone(ownerSub: string, milestoneId: string, direction: -1 | 1): Promise<void> {
  const milestone = await requireMilestone(ownerSub, milestoneId);
  const siblings = await prisma.goalMilestone.findMany({
    where: { goalId: milestone.goalId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const ids = siblings.map((s) => s.id);
  const from = ids.indexOf(milestoneId);
  const to = from + direction;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await prisma.$transaction(ids.map((id, i) => prisma.goalMilestone.update({ where: { id }, data: { sortOrder: i } })));
}

/* ---------- focus periods ---------- */

export interface FocusPeriodInput {
  label: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  weekday: FocusLine[];
  holiday: FocusLine[];
  spare: FocusLine[];
}

async function cleanPeriod(ownerSub: string, input: FocusPeriodInput) {
  const fromDateKey = cleanDateKey(input.fromDateKey);
  const toDateKey = cleanDateKey(input.toDateKey);
  if (fromDateKey && toDateKey && fromDateKey > toDateKey) throw new ValidationError("goalInvalid", "period ends before it starts");
  const goalIds = new Set(
    (await prisma.goal.findMany({ where: { ownerSub }, select: { id: true } })).map((g) => g.id),
  );
  const lines = (v: unknown): FocusLine[] =>
    toLines(v)
      .slice(0, 50)
      .map((l) => ({ goalId: l.goalId && goalIds.has(l.goalId) ? l.goalId : null, note: cleanText(l.note, 1000).trim() }))
      .filter((l) => l.goalId || l.note);
  return {
    label: cleanText(input.label, MAX_LABEL).trim(),
    fromDateKey,
    toDateKey,
    weekday: lines(input.weekday) as unknown as Prisma.InputJsonValue,
    holiday: lines(input.holiday) as unknown as Prisma.InputJsonValue,
    spare: lines(input.spare) as unknown as Prisma.InputJsonValue,
  };
}

export async function createFocusPeriod(ownerSub: string, input: FocusPeriodInput): Promise<FocusPeriodView> {
  const data = await cleanPeriod(ownerSub, input);
  const last = await prisma.goalFocusPeriod.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return toPeriodView(await prisma.goalFocusPeriod.create({ data: { ownerSub, ...data, sortOrder: (last?.sortOrder ?? -1) + 1 } }));
}

export async function saveFocusPeriod(ownerSub: string, periodId: string, input: FocusPeriodInput): Promise<FocusPeriodView> {
  const existing = await prisma.goalFocusPeriod.findFirst({ where: { id: periodId, ownerSub } });
  if (!existing) throw new NotFoundError("goalNotFound", "period not found");
  const data = await cleanPeriod(ownerSub, input);
  return toPeriodView(await prisma.goalFocusPeriod.update({ where: { id: periodId }, data }));
}

export async function deleteFocusPeriod(ownerSub: string, periodId: string): Promise<void> {
  const existing = await prisma.goalFocusPeriod.findFirst({ where: { id: periodId, ownerSub } });
  if (!existing) throw new NotFoundError("goalNotFound", "period not found");
  await prisma.goalFocusPeriod.delete({ where: { id: periodId } });
}

/* ---------- today ---------- */

export interface TodayFocusLine {
  goalId: string | null;
  goalTitle: string | null;
  note: string;
}

export interface UpcomingStep {
  goalId: string;
  goalTitle: string;
  label: string;
  dueDateKey: string;
  /** The step's first line, as a reminder of what it is. */
  firstLine: string;
  overdue: boolean;
}

export interface TodayFocus {
  dayKind: "weekday" | "holiday";
  periodLabel: string | null;
  /** The lines for the kind of day it is. */
  lines: TodayFocusLine[];
  spare: TodayFocusLine[];
  upcoming: UpcomingStep[];
}

function firstLineOf(body: string): string {
  const line = body.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  return line.replace(/^([-*+]|\d+\.)\s+/, "").slice(0, 120);
}

/** What the calendar's 今日 shows at the top: today's goals, and the steps
 * due within UPCOMING_DAYS (or overdue and not done). Null when there's
 * nothing to show, so a new owner's calendar isn't given an empty box. */
export async function todayFocus(ownerSub: string, todayKey: string): Promise<TodayFocus | null> {
  const [goals, periods] = await Promise.all([
    prisma.goal.findMany({
      where: { ownerSub, status: "ACTIVE" },
      include: { milestones: { where: { doneAt: null, dueDateKey: { not: null } } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.goalFocusPeriod.findMany({ where: { ownerSub }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  const titles = new Map(goals.map((g) => [g.id, g.title]));
  const dayKind = dayKindOf(todayKey);
  const period = periodFor(periods.map(toPeriodView), todayKey);
  // A line naming an archived goal has served its purpose.
  const resolve = (lines: FocusLine[]): TodayFocusLine[] =>
    lines
      .filter((l) => !l.goalId || titles.has(l.goalId))
      .map((l) => ({ goalId: l.goalId, goalTitle: l.goalId ? (titles.get(l.goalId) ?? null) : null, note: l.note }));
  const horizon = shiftDateKey(todayKey, UPCOMING_DAYS);
  const upcoming: UpcomingStep[] = goals
    .flatMap((g) =>
      g.milestones
        .filter((m) => m.dueDateKey && m.dueDateKey <= horizon)
        .map((m) => ({
          goalId: g.id,
          goalTitle: g.title,
          label: m.label,
          dueDateKey: m.dueDateKey!,
          firstLine: firstLineOf(m.body),
          overdue: m.dueDateKey! < todayKey,
        })),
    )
    .sort((a, b) => a.dueDateKey.localeCompare(b.dueDateKey));
  const lines = period ? resolve(period[dayKind]) : [];
  const spare = period ? resolve(period.spare) : [];
  if (lines.length === 0 && spare.length === 0 && upcoming.length === 0) return null;
  return { dayKind, periodLabel: period?.label || null, lines, spare, upcoming };
}

/* ---------- import ---------- */

/**
 * Reading a page of goals written elsewhere (a Notion page pasted whole)
 * into this shape. The model sorts the text into compass / goals / steps /
 * focus periods; this file checks the result rather than trusting it, and
 * nothing is written until the owner has seen what was read and says so.
 */
export interface ImportGoal {
  title: string;
  statement: string;
  reviewedOnDateKey: string | null;
  milestones: { label: string; dueDateKey: string | null; body: string }[];
}

export interface ImportPeriod {
  label: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  /** Goals named by title here — the goals don't have ids yet. */
  weekday: { goal: string | null; note: string }[];
  holiday: { goal: string | null; note: string }[];
  spare: { goal: string | null; note: string }[];
}

export interface ImportDraft {
  summary: string;
  compass: CompassView;
  goals: ImportGoal[];
  periods: ImportPeriod[];
}

const IMPORT_SYSTEM_PROMPT = `あなたは、目標管理のページ（Notionなどからコピーした文章）を、アプリのデータ構造に仕分ける係です。
内容を要約・言い換えしないでください。本人が書いた言葉をそのまま、正しい場所に移すのが仕事です。

仕分け先:
- compass.principles: 「前提となる生き方の指針」など、生き方の方針
- compass.happiness: 「いまある幸せ」
- compass.essentials: 「これだけあれば他に何もいらない」
- compass.obstacles: 「障害プランニング」（もし〜したら〜する、という対策）
- compass.archive: 過去の年度（「2024年度」など）の指針・目標・振り返り、各目標の中にある「archive」の内容。見出し（## 2024年度 など）を付けてまとめる
- goals: 🚩の付いた目標と、「得たい結果」に挙がっている目標。🚩の付いていない目標（例: 本文に箇条書きだけある目標）も含める
  - title: 目標の名前（🚩は付けない）。「得たい結果」の一覧と🚩の見出しで言い回しが少し違うだけの同じ目標は、1つにまとめ🚩側の名前を使う。リンクURLは捨てる
  - statement: 目標の名前のすぐ後にある、その目標の説明や意味（例:「世界中で働くことのできる基盤を作る。」）。なければ空
  - reviewedOnDateKey: 目標に付いている日付（例: 2026.6.18 → "2026-06-18"）。なければ null
  - milestones: 目標の下の段階（「~2週間後」「~2ヶ月以内」「1年後」「2年後」「3年後」「毎日の活動」など）ごとに1つ
    - label: 段階の名前（例: "~2週間後", "1年後", "毎日の活動"）
    - dueDateKey: 段階に日付が書かれていればそれ（例: June 1, 2027 → "2027-06-01"）。書かれていない相対的な段階（~2週間後、1年後 など）は、目標の reviewedOnDateKey を起点に計算した日付。起点がなければ null。「毎日の活動」など期限のないものは null
    - body: その段階の中身。箇条書きや入れ子のメモもそのまま Markdown で（"- " と、入れ子は4スペースのインデント）。「1年後: 2027年に〜」のように段階名の後に続く文はbodyに入れる
- periods: 「日々のタスクと意識する目標」のような、期間ごとに平日・休日・隙間時間にどの目標に取り組むか
  - label: 期間の名前（例: "7/1まで", "7/1以降"）
  - fromDateKey / toDateKey: 期間を日付にしたもの（両端を含む）。年は文中の日付と「今日」から推測する。「7/1まで」なら toDateKey はその前日、「7/1以降」なら fromDateKey は 7/1。分からなければ null
  - weekday / holiday / spare: それぞれ { "goal": 目標のtitle（goals の title と完全に同じ文字列）か null, "note": 補足（例: "IELTS"） }。目標に紐づかない行（例:「生活費が足りなそうであれば単発入れる」）は goal を null にして note に入れる。括弧で囲まれた行も含めてよい

compass の各項目は Markdown（"- " の箇条書き、入れ子は4スペース）。該当するものがなければ空文字列。

返答はJSONオブジェクトのみ（前後に文章やコードフェンスを付けない）:
{
  "summary": "読み取った内容を一文で（例: 目標6件、期間2件を読み取りました）",
  "compass": { "principles": "", "happiness": "", "essentials": "", "obstacles": "", "archive": "" },
  "goals": [
    { "title": "", "statement": "", "reviewedOnDateKey": null, "milestones": [ { "label": "", "dueDateKey": null, "body": "" } ] }
  ],
  "periods": [
    { "label": "", "fromDateKey": null, "toDateKey": null, "weekday": [ { "goal": null, "note": "" } ], "holiday": [], "spare": [] }
  ]
}`;

function clip(v: unknown, max: number): string {
  return str(v).slice(0, max);
}

/** Checks an import draft field by field — used on the model's reply, and
 * again on the draft the browser sends back to be applied. */
export function parseImportDraft(value: unknown): ImportDraft {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const c = (o.compass && typeof o.compass === "object" ? o.compass : {}) as Record<string, unknown>;
  const compass = Object.fromEntries(COMPASS_FIELDS.map((f) => [f, clip(c[f], MAX_TEXT).trim()])) as CompassView;

  const seen = new Set<string>();
  const goals: ImportGoal[] = (Array.isArray(o.goals) ? o.goals : []).slice(0, 50).flatMap((g) => {
    if (!g || typeof g !== "object") return [];
    const r = g as Record<string, unknown>;
    const title = stripFlag(clip(r.title, MAX_TITLE));
    if (!title || seen.has(titleKey(title))) return [];
    seen.add(titleKey(title));
    const milestones = (Array.isArray(r.milestones) ? r.milestones : []).slice(0, 30).flatMap((m) => {
      if (!m || typeof m !== "object") return [];
      const mr = m as Record<string, unknown>;
      const label = clip(mr.label, MAX_LABEL).trim();
      const body = clip(mr.body, MAX_TEXT).trimEnd();
      return label || body.trim() ? [{ label, dueDateKey: dateKeyOrNull(mr.dueDateKey), body }] : [];
    });
    return [{ title, statement: clip(r.statement, MAX_TEXT).trim(), reviewedOnDateKey: dateKeyOrNull(r.reviewedOnDateKey), milestones }];
  });

  const lines = (v: unknown) =>
    (Array.isArray(v) ? v : []).slice(0, 50).flatMap((l) => {
      if (!l || typeof l !== "object") return [];
      const r = l as Record<string, unknown>;
      const goal = typeof r.goal === "string" && r.goal.trim() ? stripFlag(r.goal.slice(0, MAX_TITLE)) : null;
      const note = clip(r.note, 1000).trim();
      return goal || note ? [{ goal, note }] : [];
    });
  const periods: ImportPeriod[] = (Array.isArray(o.periods) ? o.periods : []).slice(0, 20).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const r = p as Record<string, unknown>;
    let fromDateKey = dateKeyOrNull(r.fromDateKey);
    let toDateKey = dateKeyOrNull(r.toDateKey);
    if (fromDateKey && toDateKey && fromDateKey > toDateKey) [fromDateKey, toDateKey] = [null, null];
    const period = {
      label: clip(r.label, MAX_LABEL).trim(),
      fromDateKey,
      toDateKey,
      weekday: lines(r.weekday),
      holiday: lines(r.holiday),
      spare: lines(r.spare),
    };
    const empty = !period.label && period.weekday.length + period.holiday.length + period.spare.length === 0;
    return empty ? [] : [period];
  });

  return { summary: clip(o.summary, 500).trim(), compass, goals, periods };
}

function stripFlag(title: string): string {
  return title.replace(/^[\s🚩]+/u, "").trim();
}

/** Titles compared the forgiving way: full/half width, spaces and the flag
 * don't make two goals different. */
export function titleKey(title: string): string {
  return stripFlag(title).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** The goal titles written out so far, as progress items. */
function progressFromImport(text: string): ChatProgress {
  const start = text.search(/"goals"\s*:\s*\[/);
  const items: ProgressItem[] = [];
  if (start !== -1) {
    // Only goal titles — a period's lines name goals with "goal", not "title".
    for (const m of text.slice(start).matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      items.push({ dateKey: "", slot: null, title: partialString(`{"t":"${m[1]}"}`, "t") });
    }
  }
  return { stage: "writing", reply: partialString(text, "summary"), items };
}

export async function draftImport(
  ownerSub: string,
  text: string,
  todayKey: string,
  onProgress?: (p: ChatProgress) => void,
): Promise<ImportDraft> {
  const source = text.trim();
  if (!source) throw new ValidationError("goalImportEmpty", "nothing to import");
  if (source.length > MAX_IMPORT_TEXT) throw new ValidationError("goalImportTooLong", "import text too long");
  onProgress?.({ stage: "context", reply: "", items: [] });
  let writing = false;
  const { value, truncated } = await askForJson(
    ownerSub,
    IMPORT_SYSTEM_PROMPT,
    [`今日: ${todayKey}`, "", "ページの内容:", source].join("\n"),
    16000,
    undefined,
    onProgress &&
      ((p) => {
        if (p.kind === "thinking") {
          if (!writing) onProgress({ stage: "thinking", reply: "", items: [] });
          return;
        }
        writing = true;
        onProgress(progressFromImport(p.text));
      }),
  );
  const draft = parseImportDraft(value);
  const compassEmpty = COMPASS_FIELDS.every((f) => !draft.compass[f]);
  if (compassEmpty && draft.goals.length === 0 && draft.periods.length === 0) {
    throw new AiJsonError(truncated ? "truncated" : "invalidResponse", "nothing readable in the import");
  }
  onProgress?.({ stage: "saving", reply: draft.summary, items: [] });
  return draft;
}

/**
 * Writes an import in. Additive: a compass section already written gets the
 * imported text after it rather than in place of it, a goal whose title is
 * already here is left as it is (so importing the same page twice doesn't
 * double everything), and periods are added. Lines in a period that name a
 * goal are tied to it by title, existing or just made.
 */
export async function applyImport(ownerSub: string, input: unknown): Promise<{ goals: number; periods: number }> {
  const draft = parseImportDraft(input);
  return prisma.$transaction(async (tx) => {
    const compass = await tx.goalCompass.findUnique({ where: { ownerSub } });
    const merged = Object.fromEntries(
      COMPASS_FIELDS.map((f) => {
        const before = compass?.[f] ?? "";
        const add = draft.compass[f];
        if (!add || before.includes(add)) return [f, before];
        return [f, before.trim() ? `${before.trimEnd()}\n\n${add}` : add];
      }),
    ) as CompassView;
    await tx.goalCompass.upsert({ where: { ownerSub }, create: { ownerSub, ...merged }, update: merged });

    const existing = await tx.goal.findMany({ where: { ownerSub }, select: { id: true, title: true } });
    const byTitle = new Map(existing.map((g) => [titleKey(g.title), g.id]));
    let order = await nextGoalOrder(ownerSub, tx);
    let created = 0;
    for (const g of draft.goals) {
      if (byTitle.has(titleKey(g.title))) continue;
      const goal = await tx.goal.create({
        data: { ownerSub, title: g.title, statement: g.statement, reviewedOnDateKey: g.reviewedOnDateKey, sortOrder: order++ },
      });
      byTitle.set(titleKey(g.title), goal.id);
      created++;
      if (g.milestones.length > 0) {
        await tx.goalMilestone.createMany({
          data: g.milestones.map((m, i) => ({ goalId: goal.id, label: m.label, dueDateKey: m.dueDateKey, body: m.body, sortOrder: i })),
        });
      }
    }

    // A line whose goal can't be found keeps the goal's name in its note
    // rather than losing it.
    const resolve = (lines: ImportPeriod["weekday"]): FocusLine[] =>
      lines.map((l) => {
        const goalId = l.goal ? (byTitle.get(titleKey(l.goal)) ?? null) : null;
        const note = l.goal && !goalId ? [l.goal, l.note].filter(Boolean).join(" - ") : l.note;
        return { goalId, note };
      });
    const lastPeriod = await tx.goalFocusPeriod.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const firstOrder = (lastPeriod?.sortOrder ?? -1) + 1;
    if (draft.periods.length > 0) {
      await tx.goalFocusPeriod.createMany({
        data: draft.periods.map((p, i) => ({
          ownerSub,
          label: p.label,
          fromDateKey: p.fromDateKey,
          toDateKey: p.toDateKey,
          weekday: resolve(p.weekday) as unknown as Prisma.InputJsonValue,
          holiday: resolve(p.holiday) as unknown as Prisma.InputJsonValue,
          spare: resolve(p.spare) as unknown as Prisma.InputJsonValue,
          sortOrder: firstOrder + i,
        })),
      });
    }
    return { goals: created, periods: draft.periods.length };
  }, TRANSACTION_OPTIONS);
}
