import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import * as expenses from "@/lib/expenses";
import { DEFAULT_CATEGORIES, monthOf } from "@/lib/expenses";
import { allocate, monthsBetween, project, shiftMonth, type MonthProjection } from "@/lib/moneyPlanning";
import type { Commitment, CommitmentKind, MoneyProfile, SavingsGoal } from "@/generated/prisma/client";

export type { Commitment, CommitmentKind, MoneyProfile, SavingsGoal };

/**
 * The month's plan, and the year it sits in.
 *
 * The rule the owner asked for is that the month's budget is never blank:
 * they don't want to remember to sit down on the first and fill a form.
 * So the plan is derived the moment the month is first looked at — from
 * income, what is already promised, and what this household actually
 * spends — and stored so that adjusting it afterwards sticks.
 */

/** How many months of history shape the allocation. Long enough to average
 * out a bad week, short enough to follow a real change in habits. */
const HISTORY_MONTHS = 3;

/** Food doesn't scale to zero, however tight the month. Applied as a floor
 * so a lean plan cuts the discretionary categories first. */
const FOOD_FLOOR_RATIO = 0.35;

export async function getProfile(ownerSub: string): Promise<MoneyProfile> {
  const row = await prisma.moneyProfile.findUnique({ where: { ownerSub } });
  return row ?? prisma.moneyProfile.create({ data: { ownerSub } });
}

export interface ProfileInput {
  monthlyIncomeYen: number;
  minimumLivingYen: number;
  bufferYen: number;
}

export async function saveProfile(ownerSub: string, input: ProfileInput): Promise<MoneyProfile> {
  for (const [field, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
      throw new ValidationError("moneyPlanInvalid", `${field} is out of range`);
    }
  }
  const data = {
    monthlyIncomeYen: Math.round(input.monthlyIncomeYen),
    minimumLivingYen: Math.round(input.minimumLivingYen),
    bufferYen: Math.round(input.bufferYen),
  };
  return prisma.moneyProfile.upsert({ where: { ownerSub }, create: { ownerSub, ...data }, update: data });
}

/* ---------- what is already promised ---------- */

export interface CommitmentInput {
  name: string;
  kind: CommitmentKind;
  monthlyYen: number;
  fromMonth: string;
  toMonth: string | null;
}

const MONTH = /^\d{4}-\d{2}$/;

export async function addCommitment(ownerSub: string, input: CommitmentInput): Promise<Commitment> {
  if (!input.name.trim()) throw new ValidationError("moneyPlanInvalid", "name is required");
  if (!Number.isFinite(input.monthlyYen) || input.monthlyYen <= 0) {
    throw new ValidationError("moneyPlanInvalid", "monthly amount must be positive");
  }
  if (!MONTH.test(input.fromMonth)) throw new ValidationError("moneyPlanInvalid", "from month must be YYYY-MM");
  if (input.toMonth !== null && !MONTH.test(input.toMonth)) {
    throw new ValidationError("moneyPlanInvalid", "to month must be YYYY-MM");
  }
  if (input.toMonth !== null && input.toMonth < input.fromMonth) {
    throw new ValidationError("moneyPlanInvalid", "the last month is before the first");
  }
  return prisma.commitment.create({
    data: { ownerSub, ...input, name: input.name.trim(), monthlyYen: Math.round(input.monthlyYen) },
  });
}

export async function removeCommitment(ownerSub: string, id: string): Promise<void> {
  const { count } = await prisma.commitment.deleteMany({ where: { id, ownerSub } });
  if (count === 0) throw new ValidationError("moneyPlanNotFound", "Commitment not found");
}

export interface GoalInput {
  name: string;
  targetYen: number;
  targetMonth: string;
  savedYen: number;
}

export async function addGoal(ownerSub: string, input: GoalInput): Promise<SavingsGoal> {
  if (!input.name.trim()) throw new ValidationError("moneyPlanInvalid", "name is required");
  if (!Number.isFinite(input.targetYen) || input.targetYen <= 0) {
    throw new ValidationError("moneyPlanInvalid", "target must be positive");
  }
  if (!MONTH.test(input.targetMonth)) throw new ValidationError("moneyPlanInvalid", "target month must be YYYY-MM");
  if (!Number.isFinite(input.savedYen) || input.savedYen < 0) {
    throw new ValidationError("moneyPlanInvalid", "saved so far cannot be negative");
  }
  return prisma.savingsGoal.create({
    data: {
      ownerSub,
      name: input.name.trim(),
      targetYen: Math.round(input.targetYen),
      targetMonth: input.targetMonth,
      savedYen: Math.round(input.savedYen),
    },
  });
}

export async function updateGoalSaved(ownerSub: string, id: string, savedYen: number): Promise<void> {
  if (!Number.isFinite(savedYen) || savedYen < 0) throw new ValidationError("moneyPlanInvalid", "saved so far cannot be negative");
  const { count } = await prisma.savingsGoal.updateMany({ where: { id, ownerSub }, data: { savedYen: Math.round(savedYen) } });
  if (count === 0) throw new ValidationError("moneyPlanNotFound", "Goal not found");
}

export async function removeGoal(ownerSub: string, id: string): Promise<void> {
  const { count } = await prisma.savingsGoal.deleteMany({ where: { id, ownerSub } });
  if (count === 0) throw new ValidationError("moneyPlanNotFound", "Goal not found");
}

/* ---------- the year ---------- */

export async function projectYear(ownerSub: string, fromMonth: string, months = 12): Promise<MonthProjection[]> {
  const [profile, commitments, goals] = await Promise.all([
    getProfile(ownerSub),
    prisma.commitment.findMany({ where: { ownerSub } }),
    prisma.savingsGoal.findMany({ where: { ownerSub } }),
  ]);
  return project({
    fromMonth,
    months,
    monthlyIncomeYen: profile.monthlyIncomeYen,
    minimumLivingYen: profile.minimumLivingYen,
    bufferYen: profile.bufferYen,
    commitments: commitments.map((c) => ({ name: c.name, monthlyYen: c.monthlyYen, fromMonth: c.fromMonth, toMonth: c.toMonth })),
    goals: goals.map((g) => ({ name: g.name, targetYen: g.targetYen, targetMonth: g.targetMonth, savedYen: g.savedYen })),
  });
}

/* ---------- the month ---------- */

export interface MonthPlan {
  month: string;
  projection: MonthProjection;
  budgets: { category: string; amountYen: number }[];
  /** True when this was worked out just now rather than read back — the
   * screen says so, because a plan nobody has looked at yet deserves a
   * glance before it's trusted. */
  justCreated: boolean;
}

/**
 * The month's plan, created on first sight if it isn't there.
 *
 * "Always filled in" is the point: the owner asked not to have to
 * remember. Derived once and stored, so later adjustments survive — this
 * never silently overwrites a plan the owner has edited.
 */
export async function getOrCreateMonthPlan(ownerSub: string, month: string, fromMonth = month): Promise<MonthPlan> {
  // Projected from the current month rather than from the month asked
  // about: a goal's contributions accumulate, and a plan for March read
  // in October must not ask March for everything the goal still needs.
  const run = await projectYear(ownerSub, fromMonth, Math.max(1, monthsBetween(fromMonth, month) + 1));
  const projection = run[run.length - 1];
  const existing = await prisma.monthBudget.findMany({ where: { ownerSub, month } });
  // An all-zero plan is what you get when the month was first opened
  // before the income was entered. It carries no decision, so it is
  // replaced rather than kept — otherwise the budget stays empty for the
  // rest of the month, which is the one thing this is meant to prevent.
  const empty = existing.every((b) => b.amountYen === 0);
  if (existing.length > 0 && !(empty && projection.discretionaryYen > 0)) {
    return {
      month,
      projection,
      budgets: sortBudgets(existing.map((b) => ({ category: b.category, amountYen: b.amountYen }))),
      justCreated: false,
    };
  }

  if (existing.length > 0) await prisma.monthBudget.deleteMany({ where: { ownerSub, month } });
  const history = await averageByCategory(ownerSub, month, HISTORY_MONTHS);
  const floors = foodFloor(projection.discretionaryYen, history);
  // Zero-amount categories are kept: "the budget is never blank" means
  // every category the owner uses has a figure to look at and change,
  // even when this month's answer for it is nothing.
  const budgets = allocate(projection.discretionaryYen, history, floors);
  if (budgets.length > 0) {
    await prisma.monthBudget.createMany({
      data: budgets.map((b) => ({ ownerSub, month, category: b.category, amountYen: b.amountYen })),
      skipDuplicates: true,
    });
  }
  return { month, projection, budgets: sortBudgets(budgets), justCreated: true };
}

/** Largest first, then by name — the same order whether the plan was
 * just derived or read back, so the screen doesn't reshuffle itself. */
function sortBudgets(budgets: { category: string; amountYen: number }[]): { category: string; amountYen: number }[] {
  return [...budgets].sort((a, b) => b.amountYen - a.amountYen || a.category.localeCompare(b.category));
}

export async function setMonthBudget(ownerSub: string, month: string, category: string, amountYen: number): Promise<void> {
  const trimmed = category.trim();
  if (!trimmed) throw new ValidationError("moneyPlanInvalid", "category is required");
  if (!Number.isFinite(amountYen) || amountYen < 0) throw new ValidationError("moneyPlanInvalid", "amount cannot be negative");
  const value = Math.round(amountYen);
  await prisma.monthBudget.upsert({
    where: { ownerSub_month_category: { ownerSub, month, category: trimmed } },
    create: { ownerSub, month, category: trimmed, amountYen: value },
    update: { amountYen: value },
  });
}

/** Throws the month's plan away so the next read derives a fresh one —
 * for when income or commitments have changed enough that last week's
 * arithmetic is simply wrong. */
export async function resetMonthPlan(ownerSub: string, month: string): Promise<MonthPlan> {
  await prisma.monthBudget.deleteMany({ where: { ownerSub, month } });
  return getOrCreateMonthPlan(ownerSub, month);
}

/** What this household has actually been spending, by category. The
 * categories it already uses, plus the defaults so a first month still
 * has somewhere to put things. */
export async function averageByCategory(
  ownerSub: string,
  beforeMonth: string,
  months: number,
): Promise<{ category: string; averageYen: number }[]> {
  const first = shiftMonth(beforeMonth, -months);
  const rows = await prisma.expense.findMany({
    where: { ownerSub, dateKey: { gte: `${first}-01`, lt: `${beforeMonth}-01` } },
    select: { category: true, amountYen: true },
  });
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountYen);
  const seen = [...totals.entries()].map(([category, total]) => ({ category, averageYen: Math.round(total / months) }));
  const known = new Set(seen.map((s) => s.category));
  return [...seen, ...DEFAULT_CATEGORIES.filter((c) => !known.has(c)).map((category) => ({ category, averageYen: 0 }))];
}

function foodFloor(discretionaryYen: number, history: { category: string; averageYen: number }[]): Record<string, number> {
  const food = expenses.FOOD_CATEGORY;
  if (!history.some((h) => h.category === food)) return {};
  // A share of what there is, not a fixed sum: on a lean month the floor
  // has to come down too or it swallows the whole budget.
  return { [food]: Math.max(0, Math.round((discretionaryYen * FOOD_FLOOR_RATIO) / 100) * 100) };
}

/** Month keys for a day key, so callers don't reimplement the slice. */
export function monthOfDay(dateKey: string): string {
  return monthOf(dateKey);
}
