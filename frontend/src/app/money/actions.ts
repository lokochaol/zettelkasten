"use server";

import { revalidatePath } from "next/cache";
import * as expenses from "@/lib/expenses";
import type { Expense, ExpenseInput, MonthSummary } from "@/lib/expenses";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";
import { getDictionary } from "@/lib/i18n/dictionary";
import { parseCsv, guessMapping, type ColumnMapping } from "@/lib/csvImport";
import { prisma } from "@/lib/db";

export interface MoneyDayView {
  today: Expense[];
  todayTotalYen: number;
  month: MonthSummary;
  categories: string[];
}

export async function getMoneyDayAction(dateKey: string): Promise<MoneyDayView> {
  const ownerSub = await requireOwnerSub();
  const [today, month, categories] = await Promise.all([
    expenses.listForDay(ownerSub, dateKey),
    expenses.monthSummary(ownerSub, dateKey),
    expenses.knownCategories(ownerSub),
  ]);
  return {
    today,
    todayTotalYen: today.reduce((sum, e) => sum + e.amountYen, 0),
    month,
    categories,
  };
}

export async function addExpenseAction(input: ExpenseInput): Promise<{ view: MoneyDayView } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await expenses.add(ownerSub, input);
    revalidatePath("/money");
    revalidatePath("/calendar");
    return { view: await getMoneyDayAction(input.dateKey) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function removeExpenseAction(id: string, dateKey: string): Promise<MoneyDayView> {
  const ownerSub = await requireOwnerSub();
  await expenses.remove(ownerSub, id);
  revalidatePath("/money");
  revalidatePath("/calendar");
  return getMoneyDayAction(dateKey);
}

export async function setCategoryBudgetAction(
  category: string,
  monthlyYen: number | null,
  dateKey: string,
): Promise<MonthSummary> {
  const ownerSub = await requireOwnerSub();
  await expenses.setCategoryBudget(ownerSub, category, monthlyYen);
  revalidatePath("/money");
  return expenses.monthSummary(ownerSub, dateKey);
}

/* ---------- statement import ---------- */

export interface CsvPreview {
  headers: string[];
  mapping: ColumnMapping;
  candidates: expenses.ImportCandidate[];
  rows: Record<string, string>[];
  profiles: { id: string; name: string; mapping: ColumnMapping }[];
}

/**
 * Parses the pasted-in statement text and shows what importing it would
 * do — including which rows are already in and which look like something
 * typed by hand. Nothing is written until the owner confirms.
 */
export async function previewCsvAction(
  text: string,
  profileName: string,
  overrides?: Partial<ColumnMapping>,
): Promise<CsvPreview | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0 || rows.length === 0) {
    return { error: (await getDictionary(await getLocale())).money.csvEmpty };
  }
  const saved = await prisma.csvImportProfile.findMany({ where: { ownerSub } });
  const savedForName = saved.find((p) => p.name === profileName);
  const guessed = guessMapping(headers);
  const mapping: ColumnMapping = {
    dateColumn: overrides?.dateColumn ?? savedForName?.dateColumn ?? guessed.dateColumn ?? headers[0],
    amountColumn: overrides?.amountColumn ?? savedForName?.amountColumn ?? guessed.amountColumn ?? headers[0],
    memoColumn: overrides?.memoColumn ?? savedForName?.memoColumn ?? guessed.memoColumn ?? headers[0],
    amountIsNegativeForSpending:
      overrides?.amountIsNegativeForSpending ?? savedForName?.amountIsNegativeForSpending ?? false,
  };
  return {
    headers,
    mapping,
    rows,
    candidates: await expenses.prepareImport(ownerSub, rows, mapping, profileName),
    profiles: saved.map((p) => ({
      id: p.id,
      name: p.name,
      mapping: {
        dateColumn: p.dateColumn,
        amountColumn: p.amountColumn,
        memoColumn: p.memoColumn,
        amountIsNegativeForSpending: p.amountIsNegativeForSpending,
      },
    })),
  };
}

/** Commits the chosen rows and remembers the mapping under this profile
 * name, so the next statement from the same issuer needs no mapping. */
export async function importCsvAction(
  profileName: string,
  mapping: ColumnMapping,
  selections: expenses.ImportSelection[],
  learnedRules: { keyword: string; category: string }[],
): Promise<expenses.ImportResult> {
  const ownerSub = await requireOwnerSub();
  const name = profileName.trim() || "明細";
  await prisma.csvImportProfile.upsert({
    where: { ownerSub_name: { ownerSub, name } },
    create: { ownerSub, name, ...mapping },
    update: mapping,
  });
  for (const rule of learnedRules) await expenses.learnCategoryRule(ownerSub, rule.keyword, rule.category);
  const result = await expenses.commitImport(ownerSub, selections);
  revalidatePath("/money");
  revalidatePath("/calendar");
  return result;
}

export async function getMonthlyTotalsAction(throughDateKey: string): Promise<expenses.MonthTotal[]> {
  const ownerSub = await requireOwnerSub();
  return expenses.monthlyTotals(ownerSub, throughDateKey);
}
