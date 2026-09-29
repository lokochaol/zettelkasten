import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { applyMapping, type ColumnMapping, type MappedRow } from "@/lib/csvImport";
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

/** The food category the meal planner's budget is measured against. Plain
 * string rather than an enum for the same reason the rest are: the owner
 * renames their own categories, and this is the one the app ships with. */
export const FOOD_CATEGORY = "食費";

/** What was actually spent over a span of days, optionally in one
 * category. Inclusive of both ends — the caller thinks in "this week",
 * not in half-open ranges. */
export async function sumForRange(
  ownerSub: string,
  fromDateKey: string,
  toDateKey: string,
  category?: string,
): Promise<number> {
  const { _sum } = await prisma.expense.aggregate({
    where: { ownerSub, dateKey: { gte: fromDateKey, lte: toDateKey }, ...(category ? { category } : {}) },
    _sum: { amountYen: true },
  });
  return _sum.amountYen ?? 0;
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
    // The month's own plan (see src/lib/moneyPlan.ts), not the standing
    // per-category budget this used to read: that one was a second set of
    // numbers for the same categories, edited in a different section, and
    // the two drifted apart as soon as the plan existed.
    prisma.monthBudget.findMany({ where: { ownerSub, month } }),
  ]);
  const budgetByCategory = new Map(budgets.map((b) => [b.category, b.amountYen]));
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

/* ---------- importing statements ---------- */


export interface ImportCandidate extends MappedRow {
  category: string;
  /** Already imported from a statement before — same fingerprint. */
  alreadyImported: boolean;
  /** Same day and amount as something typed in by hand. Not skipped
   * automatically: a ¥500 coffee bought twice in a day is two expenses,
   * and only the owner can tell that from a double entry. */
  manualMatchId: string | null;
}

/** Applies a mapping, categorises what it can, and marks what looks like
 * a duplicate — everything needed to show the owner a preview before
 * anything is written. */
export async function prepareImport(
  ownerSub: string,
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  profileName: string,
): Promise<ImportCandidate[]> {
  const mapped = applyMapping(rows, mapping, profileName);
  const usable = mapped.filter((r) => !r.problem);
  const [rules, existing, manual] = await Promise.all([
    prisma.categoryRule.findMany({ where: { ownerSub } }),
    prisma.expense.findMany({
      where: { ownerSub, externalKey: { in: usable.map((r) => r.externalKey) } },
      select: { externalKey: true },
    }),
    prisma.expense.findMany({
      where: { ownerSub, source: "MANUAL", dateKey: { in: [...new Set(usable.map((r) => r.dateKey))] } },
      select: { id: true, dateKey: true, amountYen: true },
    }),
  ]);
  const importedKeys = new Set(existing.map((e) => e.externalKey));
  const claimedManual = new Set<string>();

  return mapped.map((row) => {
    if (row.problem) return { ...row, category: "", alreadyImported: false, manualMatchId: null };
    const rule = rules.find((r) => row.memo.toLowerCase().includes(r.keyword.toLowerCase()));
    // One manual entry can only explain one statement line, so a matched
    // entry is claimed and won't be offered against a second row.
    const match = manual.find(
      (m) => !claimedManual.has(m.id) && m.dateKey === row.dateKey && m.amountYen === row.amountYen,
    );
    if (match) claimedManual.add(match.id);
    return {
      ...row,
      category: rule?.category ?? "",
      alreadyImported: importedKeys.has(row.externalKey),
      manualMatchId: match?.id ?? null,
    };
  });
}

export interface ImportSelection {
  externalKey: string;
  dateKey: string;
  amountYen: number;
  memo: string;
  category: string;
  /** When set, this statement line replaces that hand-typed entry rather
   * than joining it. */
  replacesManualId: string | null;
}

export interface ImportResult {
  imported: number;
  replaced: number;
  skipped: number;
}

/** Writes the chosen rows. Idempotent on externalKey, so importing an
 * overlapping statement again adds only what's new. */
export async function commitImport(ownerSub: string, selections: ImportSelection[]): Promise<ImportResult> {
  let imported = 0;
  let replaced = 0;
  let skipped = 0;

  for (const row of selections) {
    const exists = await prisma.expense.findFirst({
      where: { ownerSub, externalKey: row.externalKey },
      select: { id: true },
    });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      if (row.replacesManualId) {
        const { count } = await tx.expense.deleteMany({
          where: { id: row.replacesManualId, ownerSub, source: "MANUAL" },
        });
        if (count > 0) replaced++;
      }
      await tx.expense.create({
        data: {
          ownerSub,
          dateKey: row.dateKey,
          amountYen: row.amountYen,
          category: row.category.trim() || "その他",
          memo: row.memo,
          source: "CSV",
          externalKey: row.externalKey,
        },
      });
      imported++;
    });
  }
  return { imported, replaced, skipped };
}

/** Remembers "descriptions containing this go in that category", so the
 * next statement arrives mostly sorted. */
export async function learnCategoryRule(ownerSub: string, keyword: string, category: string): Promise<void> {
  const trimmedKeyword = keyword.trim();
  const trimmedCategory = category.trim();
  if (!trimmedKeyword || !trimmedCategory) return;
  await prisma.categoryRule.upsert({
    where: { ownerSub_keyword: { ownerSub, keyword: trimmedKeyword } },
    create: { ownerSub, keyword: trimmedKeyword, category: trimmedCategory },
    update: { category: trimmedCategory },
  });
}

/* ---------- the long view ---------- */

export interface MonthTotal {
  month: string;
  totalYen: number;
}

/** Totals for the last `months` calendar months, oldest first, including
 * the months with nothing in them — a gap in spending is a shape worth
 * seeing, and dropping empty months would draw a misleading line. */
export async function monthlyTotals(ownerSub: string, throughDateKey: string, months = 12): Promise<MonthTotal[]> {
  const [year, month] = throughDateKey.slice(0, 7).split("-").map(Number);
  const wanted: string[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    wanted.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const rows = await prisma.expense.findMany({
    where: { ownerSub, dateKey: { gte: `${wanted[0]}-01` } },
    select: { dateKey: true, amountYen: true },
  });
  const totals = new Map(wanted.map((m) => [m, 0]));
  for (const row of rows) {
    const m = monthOf(row.dateKey);
    if (totals.has(m)) totals.set(m, (totals.get(m) ?? 0) + row.amountYen);
  }
  return wanted.map((month) => ({ month, totalYen: totals.get(month) ?? 0 }));
}
