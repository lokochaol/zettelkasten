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
import { MAX_PDF_BYTES, PDF_MAPPING, looksLikePdf, readPdfStatement } from "@/lib/pdfStatement";
import type { Dictionary } from "@/lib/i18n/types";
import { prisma } from "@/lib/db";
import { getTodayKey } from "@/lib/preferences/preferences";

export interface MoneyDayView {
  today: Expense[];
  todayTotalYen: number;
  month: MonthSummary;
  categories: string[];
}

export async function getMoneyDayAction(dateKey: string): Promise<MoneyDayView> {
  const ownerSub = await requireOwnerSub();
  // The month's budgets live in its plan, and the plan is made on first
  // read. This view is often the first thing opened in a new month (the
  // calendar's spending card), so it makes sure the current month has one.
  // Only the current month: browsing to another day must not quietly
  // create plans for months nobody asked about.
  if (expenses.monthOf(dateKey) === expenses.monthOf(await getTodayKey())) {
    await moneyPlan.getOrCreateMonthPlan(ownerSub, expenses.monthOf(dateKey));
  }
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

/* ---------- statement import ---------- */

export interface CsvPreview {
  headers: string[];
  mapping: ColumnMapping;
  candidates: expenses.ImportCandidate[];
  rows: Record<string, string>[];
  profiles: { id: string; name: string; mapping: ColumnMapping }[];
  /** Present when the rows were read out of a PDF by the AI — the columns
   * are then fixed, and the totals are there to check the reading. */
  pdf?: { statedTotalYen: number | null; extractedTotalYen: number; truncated: boolean };
}

/** The preview for rows already split into columns, whichever file they
 * came from. */
async function buildPreview(
  ownerSub: string,
  headers: string[],
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  profileName: string,
  saved: { id: string; name: string; dateColumn: string; amountColumn: string; memoColumn: string; amountIsNegativeForSpending: boolean }[],
): Promise<CsvPreview> {
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

/** What to tell the owner when their AI couldn't do it. Every one of these
 * is something they can act on, so it's a message, not an exception. */
function aiErrorMessage(dict: Dictionary, e: AiJsonError, truncatedMessage = dict.meals.errorTruncated): string {
  const byCode: Record<string, string> = {
    notConfigured: dict.meals.errorNoAiKey,
    authError: dict.meals.errorAuth,
    rateLimitError: dict.meals.errorRateLimit,
    invalidResponse: dict.meals.errorBadResponse,
    truncated: truncatedMessage,
    apiError: dict.meals.errorApi,
  };
  // No key is a setting, not a failure — the detail would only be noise.
  if (e.code === "notConfigured") return byCode.notConfigured;
  return `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}`;
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
  return buildPreview(ownerSub, headers, rows, mapping, profileName, saved);
}

/**
 * Reads a statement PDF with the owner's AI and shows what importing it
 * would do — the same preview a CSV gets, so nothing is written until the
 * owner has looked at the rows.
 *
 * The file arrives as FormData rather than as base64 in an argument: it's
 * binary, and base64 would spend a third of the upload limit on encoding.
 */
export async function previewPdfAction(form: FormData): Promise<CsvPreview | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const dict = getDictionary(await getLocale());
  const file = form.get("file");
  const profileName = String(form.get("profileName") ?? "").trim() || "明細";
  if (!(file instanceof File)) return { error: dict.money.pdfNotPdf };
  if (file.size > MAX_PDF_BYTES) return { error: dict.money.pdfTooLarge(Math.round(MAX_PDF_BYTES / 1024 / 1024)) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return { error: dict.money.pdfNotPdf };

  let statement;
  try {
    statement = await readPdfStatement(ownerSub, file.name || "statement.pdf", bytes);
  } catch (e) {
    if (e instanceof AiJsonError) {
      console.error("pdf statement failed", e.code, e.message);
      return { error: aiErrorMessage(dict, e, dict.money.pdfTruncated) };
    }
    throw e;
  }
  if (statement.rows.length === 0) return { error: dict.money.pdfNoRows };

  const saved = await prisma.csvImportProfile.findMany({ where: { ownerSub } });
  const preview = await buildPreview(ownerSub, statement.headers, statement.rows, PDF_MAPPING, profileName, saved);
  return {
    ...preview,
    pdf: {
      statedTotalYen: statement.statedTotalYen,
      extractedTotalYen: statement.extractedTotalYen,
      truncated: statement.truncated,
    },
  };
}

/** Commits the chosen rows and remembers the mapping under this profile
 * name, so the next statement from the same issuer needs no mapping.
 *
 * `rememberMapping` is off for a PDF: its columns are fixed names the app
 * made up, and saving them would overwrite the real mapping of a card
 * whose statements are sometimes imported as CSV. */
export async function importCsvAction(
  profileName: string,
  mapping: ColumnMapping,
  selections: expenses.ImportSelection[],
  learnedRules: { keyword: string; category: string }[],
  rememberMapping = true,
): Promise<expenses.ImportResult> {
  const ownerSub = await requireOwnerSub();
  const name = profileName.trim() || "明細";
  if (rememberMapping) {
    await prisma.csvImportProfile.upsert({
      where: { ownerSub_name: { ownerSub, name } },
      create: { ownerSub, name, ...mapping },
      update: mapping,
    });
  }
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
      console.error("spending advice failed", e.code, e.message);
      return { error: aiErrorMessage(dict, e) };
    }
    throw e;
  }
  revalidatePath("/money");
  return getMoneyPlanAction(todayKey);
}
