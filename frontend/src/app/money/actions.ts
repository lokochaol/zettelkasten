"use server";

import { revalidatePath } from "next/cache";
import * as expenses from "@/lib/expenses";
import type { Expense, ExpenseInput, MonthSummary } from "@/lib/expenses";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";

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
