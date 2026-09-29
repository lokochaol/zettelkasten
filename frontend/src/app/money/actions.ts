"use server";

import { revalidatePath } from "next/cache";
import * as expenses from "@/lib/expenses";
import * as moneyPlan from "@/lib/moneyPlan";
import * as spendingAdvice from "@/lib/spendingAdvice";
import type { AdviceView } from "@/lib/spendingAdvice";
import type { MonthProjection } from "@/lib/moneyPlanning";
import { AiJsonError } from "@/lib/aiJson";
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

/* ---------- planning ---------- */

export interface MoneyPlanView {
  profile: moneyPlan.MoneyProfile;
  plan: moneyPlan.MonthPlan;
  /** Spent so far this month, by the plan's own categories. */
  spentByCategory: Record<string, number>;
  year: MonthProjection[];
  commitments: moneyPlan.Commitment[];
  goals: moneyPlan.SavingsGoal[];
  advice: AdviceView | null;
  recentAdvice: AdviceView[];
  weekStartDateKey: string;
}

/**
 * The whole planning picture for a day: this month's plan (created now if
 * the month is new), the twelve months around it, and the latest weekly
 * advice. One round trip, because every part of it is read together.
 */
export async function getMoneyPlanAction(todayKey: string): Promise<MoneyPlanView> {
  const ownerSub = await requireOwnerSub();
  const month = expenses.monthOf(todayKey);
  const [profile, plan, summary, year, commitments, goals, recentAdvice] = await Promise.all([
    moneyPlan.getProfile(ownerSub),
    moneyPlan.getOrCreateMonthPlan(ownerSub, month),
    expenses.monthSummary(ownerSub, todayKey),
    moneyPlan.projectYear(ownerSub, month, 12),
    prisma.commitment.findMany({ where: { ownerSub }, orderBy: [{ kind: "asc" }, { monthlyYen: "desc" }] }),
    prisma.savingsGoal.findMany({ where: { ownerSub }, orderBy: { targetMonth: "asc" } }),
    spendingAdvice.listRecentAdvice(ownerSub, 4),
  ]);
  const weekStartDateKey = spendingAdvice.weekStartFor(todayKey);
  return {
    profile,
    plan,
    spentByCategory: Object.fromEntries(summary.byCategory.map((c) => [c.category, c.spentYen])),
    year,
    commitments,
    goals,
    advice: recentAdvice.find((a) => a.weekStartDateKey === weekStartDateKey) ?? null,
    recentAdvice,
    weekStartDateKey,
  };
}

export async function saveMoneyProfileAction(
  input: moneyPlan.ProfileInput,
  todayKey: string,
): Promise<MoneyPlanView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await moneyPlan.saveProfile(ownerSub, input);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function addCommitmentAction(
  input: moneyPlan.CommitmentInput,
  todayKey: string,
): Promise<MoneyPlanView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await moneyPlan.addCommitment(ownerSub, input);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function removeCommitmentAction(id: string, todayKey: string): Promise<MoneyPlanView> {
  const ownerSub = await requireOwnerSub();
  await moneyPlan.removeCommitment(ownerSub, id);
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function addGoalAction(
  input: moneyPlan.GoalInput,
  todayKey: string,
): Promise<MoneyPlanView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await moneyPlan.addGoal(ownerSub, input);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function updateGoalSavedAction(id: string, savedYen: number, todayKey: string): Promise<MoneyPlanView> {
  const ownerSub = await requireOwnerSub();
  await moneyPlan.updateGoalSaved(ownerSub, id, savedYen);
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function removeGoalAction(id: string, todayKey: string): Promise<MoneyPlanView> {
  const ownerSub = await requireOwnerSub();
  await moneyPlan.removeGoal(ownerSub, id);
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

export async function setMonthBudgetAction(
  month: string,
  category: string,
  amountYen: number,
  todayKey: string,
): Promise<MoneyPlanView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await moneyPlan.setMonthBudget(ownerSub, month, category, amountYen);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

/** Throws this month's allocation away and derives it again — for when
 * income or commitments have changed under it. */
export async function resetMonthPlanAction(month: string, todayKey: string): Promise<MoneyPlanView> {
  const ownerSub = await requireOwnerSub();
  await moneyPlan.resetMonthPlan(ownerSub, month);
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}

/**
 * Asks the owner's own model for this week's advice. Every failure is
 * something they can act on — no key, a rejected key, an unusable reply —
 * so they come back as messages rather than exceptions.
 */
export async function generateAdviceAction(todayKey: string): Promise<MoneyPlanView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  try {
    await spendingAdvice.generateAdvice(ownerSub, todayKey);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof AiJsonError) {
      const byCode: Record<string, string> = {
        notConfigured: dict.meals.errorNoAiKey,
        authError: dict.meals.errorAuth,
        rateLimitError: dict.meals.errorRateLimit,
        invalidResponse: dict.meals.errorBadResponse,
        truncated: dict.meals.errorTruncated,
        apiError: dict.meals.errorApi,
      };
      console.error("spending advice failed", e.code, e.message);
      return { error: `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}` };
    }
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}
