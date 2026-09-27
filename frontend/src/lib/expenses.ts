import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { Expense, ExpenseSource } from "@/generated/prisma/client";

export type { Expense };

/**
 * The money half, kept deliberately small.
 *
 * Two entry points by design, for two different jobs: typing a coffee in
 * at the counter, and importing a month of card statements to see where
 * the year is going. Bank and card aggregation is not one of them — in
 * Japan that needs registration as an 電子決済等代行業者 or a corporate
 * contract with an aggregator, so it's closed to a personal app. CSV plus
 * manual entry is what's actually available, and saying so beats building
 * around a integration that can't exist.
 */

/** Offered in the category picker before the owner has invented their own.
 * Not an enum — see the schema comment. */
export const DEFAULT_CATEGORIES = ["食費", "日用品", "交通", "交際", "住居", "その他"] as const;

export interface ExpenseInput {
  dateKey: string;
  amountYen: number;
  category: string;
  memo?: string;
}

export async function add(ownerSub: string, input: ExpenseInput, source: ExpenseSource = "MANUAL"): Promise<Expense> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) {
    throw new ValidationError("expenseInvalid", "date must be YYYY-MM-DD");
  }
  if (!Number.isFinite(input.amountYen) || input.amountYen === 0) {
    throw new ValidationError("expenseInvalid", "amount must be a non-zero number");
  }
  if (!input.category.trim()) throw new ValidationError("expenseInvalid", "category is required");
  return prisma.expense.create({
    data: {
      ownerSub,
      dateKey: input.dateKey,
      // Rounded, not floored: a 0.5 yen statement line should land on the
      // nearer yen rather than always in the owner's favour.
      amountYen: Math.round(input.amountYen),
      category: input.category.trim(),
      memo: input.memo?.trim() ?? "",
      source,
    },
  });
}

export async function remove(ownerSub: string, id: string): Promise<void> {
  const { count } = await prisma.expense.deleteMany({ where: { id, ownerSub } });
  if (count === 0) throw new ValidationError("expenseNotFound", "Expense not found");
}

export async function listForDay(ownerSub: string, dateKey: string): Promise<Expense[]> {
  return prisma.expense.findMany({ where: { ownerSub, dateKey }, orderBy: { createdAt: "desc" } });
}

/** "YYYY-MM" for a day key — the month a day belongs to, without going
 * through Date and its timezone. */
export function monthOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export interface CategorySpend {
  category: string;
  spentYen: number;
  budgetYen: number | null;
}

export interface MonthSummary {
  month: string;
  totalYen: number;
  byCategory: CategorySpend[];
  /** Days elapsed and total, so the UI can say "over budget" versus
   * "ahead of pace" — halfway through a month, half the budget spent is
   * not a problem, and the two readings need different words. */
  dayOfMonth: number;
  daysInMonth: number;
}

export async function monthSummary(ownerSub: string, dateKey: string): Promise<MonthSummary> {
  const month = monthOf(dateKey);
  const [rows, budgets] = await Promise.all([
    prisma.expense.groupBy({
      by: ["category"],
      where: { ownerSub, dateKey: { startsWith: month } },
      _sum: { amountYen: true },
    }),
    prisma.categoryBudget.findMany({ where: { ownerSub } }),
  ]);
  const budgetByCategory = new Map(budgets.map((b) => [b.category, b.monthlyYen]));
  const spentByCategory = new Map(rows.map((r) => [r.category, r._sum.amountYen ?? 0]));

  // Every budgeted category appears even at zero spend — a budget you
  // haven't touched is information, and hiding it until the first
  // purchase makes the list jump around all month.
  const categories = [...new Set([...spentByCategory.keys(), ...budgetByCategory.keys()])].sort(
    (a, b) => (spentByCategory.get(b) ?? 0) - (spentByCategory.get(a) ?? 0),
  );
  const [year, monthNum] = month.split("-").map(Number);
  return {
    month,
    totalYen: [...spentByCategory.values()].reduce((sum, n) => sum + n, 0),
    byCategory: categories.map((category) => ({
      category,
      spentYen: spentByCategory.get(category) ?? 0,
      budgetYen: budgetByCategory.get(category) ?? null,
    })),
    dayOfMonth: Number(dateKey.slice(8, 10)),
    daysInMonth: new Date(Date.UTC(year, monthNum, 0)).getUTCDate(),
  };
}

export async function setCategoryBudget(ownerSub: string, category: string, monthlyYen: number | null): Promise<void> {
  const trimmed = category.trim();
  if (!trimmed) throw new ValidationError("expenseInvalid", "category is required");
  if (monthlyYen === null) {
    await prisma.categoryBudget.deleteMany({ where: { ownerSub, category: trimmed } });
    return;
  }
  if (!Number.isFinite(monthlyYen) || monthlyYen < 0) {
    throw new ValidationError("expenseInvalid", "budget must be zero or more");
  }
  const value = Math.round(monthlyYen);
  await prisma.categoryBudget.upsert({
    where: { ownerSub_category: { ownerSub, category: trimmed } },
    create: { ownerSub, category: trimmed, monthlyYen: value },
    update: { monthlyYen: value },
  });
}

/** Categories the owner has actually used or budgeted, for the picker —
 * their own vocabulary first, the defaults only to fill in the gaps. */
export async function knownCategories(ownerSub: string): Promise<string[]> {
  const [used, budgeted] = await Promise.all([
    prisma.expense.findMany({ where: { ownerSub }, distinct: ["category"], select: { category: true }, take: 50 }),
    prisma.categoryBudget.findMany({ where: { ownerSub }, select: { category: true } }),
  ]);
  const mine = [...new Set([...used.map((u) => u.category), ...budgeted.map((b) => b.category)])];
  return [...mine, ...DEFAULT_CATEGORIES.filter((c) => !mine.includes(c))];
}
