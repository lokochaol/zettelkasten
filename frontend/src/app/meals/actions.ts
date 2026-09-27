"use server";

import { revalidatePath } from "next/cache";
import * as mealPlanning from "@/lib/mealPlanning";
import * as coopOrder from "@/lib/coopOrder";
import * as expenses from "@/lib/expenses";
import { shiftDateKey } from "@/lib/dateKey";
import type { MealPlanView, PreferenceInput } from "@/lib/mealPlanning";
import { AiJsonError } from "@/lib/aiJson";
import {
  GoogleCalendarNotLinkedError,
  GoogleCalendarAuthError,
  GoogleCalendarApiError,
} from "@/lib/googleCalendar";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDomainError } from "@/lib/i18n/errors";

export interface MealWeekView {
  weekStartDateKey: string;
  preference: mealPlanning.MealPreference;
  view: MealPlanView | null;
  /** What was actually spent on food during this week, from the expenses
   * the owner entered or imported. The plan's estimate is a guess made
   * before the week; this is the answer, and the two side by side are how
   * the next week's budget gets set honestly. */
  foodSpentYen: number;
}

export async function getMealWeekAction(dateKey: string): Promise<MealWeekView> {
  const ownerSub = await requireOwnerSub();
  const preference = await mealPlanning.getPreference(ownerSub);
  const weekStartDateKey = mealPlanning.weekStartFor(dateKey, preference.shoppingWeekday);
  const [view, foodSpentYen] = await Promise.all([
    mealPlanning.getPlan(ownerSub, weekStartDateKey),
    expenses.sumForRange(ownerSub, weekStartDateKey, shiftDateKey(weekStartDateKey, 6), expenses.FOOD_CATEGORY),
  ]);
  return { weekStartDateKey, preference, view, foodSpentYen };
}

export async function saveMealPreferenceAction(input: PreferenceInput): Promise<{ ok: true } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await mealPlanning.savePreference(ownerSub, input);
    revalidatePath("/meals");
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

/**
 * Runs the planner on the owner's own AI key. Every failure mode here is
 * something the owner can act on — no key configured, a key that was
 * rejected, a reply that wasn't usable — so they come back as messages
 * rather than exceptions.
 */
export async function generateMealPlanAction(
  weekStartDateKey: string,
  todayKey: string,
): Promise<{ view: MealPlanView; warnings: string[] } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  try {
    const { view, warnings } = await mealPlanning.generatePlan(ownerSub, weekStartDateKey, todayKey);
    revalidatePath("/meals");
    revalidatePath("/calendar");
    return { view, warnings };
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
      // The detail matters more than the category here: this app has one
      // user, running it on their own key, and "couldn't read the reply"
      // with nothing further is not something they can act on.
      console.error("meal plan generation failed", e.code, e.message);
      return { error: `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}` };
    }
    throw e;
  }
}

export async function toggleShoppingItemAction(itemId: string, checked: boolean): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await mealPlanning.setShoppingItemChecked(ownerSub, itemId, checked);
  revalidatePath("/meals");
}

/**
 * Writes the week's meals into Google Calendar. Separate from generating
 * the plan on purpose: a plan is a proposal, and putting it into someone's
 * real calendar is a decision they make after reading it.
 */
export async function syncMealsToCalendarAction(
  weekStartDateKey: string,
  timeZone: string,
): Promise<{ written: number; failed: number } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  try {
    return await mealPlanning.syncWeekToCalendar(ownerSub, weekStartDateKey, timeZone);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof GoogleCalendarNotLinkedError) return { error: dict.meals.syncNotLinked };
    if (e instanceof GoogleCalendarAuthError) return { error: dict.meals.syncReauth };
    if (e instanceof GoogleCalendarApiError) return { error: dict.meals.syncFailed };
    throw e;
  }
}

/* ---------- Coop Deli order ---------- */

export interface CoopWeekView {
  weekStartDateKey: string;
  /** The week ordering can still reach — everything nearer has either been
   * bought or has passed its deadline. */
  targetWeekStartDateKey: string;
  order: coopOrder.CoopOrderView | null;
  /** The list as text, ready to paste into eフレンズ or a notes app. Built
   * on the server so the client doesn't re-implement the formatting. */
  text: string;
}

export async function getCoopOrderAction(weekStartDateKey: string, todayKey: string): Promise<CoopWeekView> {
  const ownerSub = await requireOwnerSub();
  const preference = await mealPlanning.getPreference(ownerSub);
  const order = await coopOrder.getOrder(ownerSub, weekStartDateKey, todayKey);
  return {
    weekStartDateKey,
    targetWeekStartDateKey: coopOrder.targetWeekStart(
      todayKey,
      preference.shoppingWeekday,
      preference.coopDeliveryWeekday,
      preference.coopOrderLeadDays,
    ),
    order,
    text: order ? coopOrder.orderText(order) : "",
  };
}

/**
 * Proposes the order for a week. Nothing is submitted anywhere: eフレンズ
 * has no external ordering API, so this ends in a list the owner types in
 * themselves, and saying that plainly beats implying an integration that
 * cannot exist.
 */
export async function proposeCoopOrderAction(
  weekStartDateKey: string,
  todayKey: string,
): Promise<{ order: coopOrder.CoopOrderView; refined: boolean; text: string } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  try {
    const { view, refined } = await coopOrder.proposeOrder(ownerSub, weekStartDateKey, todayKey);
    revalidatePath("/meals");
    return { order: view, refined, text: coopOrder.orderText(view) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof AiJsonError) {
      const byCode: Record<string, string> = {
        authError: dict.meals.errorAuth,
        rateLimitError: dict.meals.errorRateLimit,
        invalidResponse: dict.meals.errorBadResponse,
        truncated: dict.meals.errorTruncated,
        apiError: dict.meals.errorApi,
      };
      console.error("coop order proposal failed", e.code, e.message);
      return { error: `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}` };
    }
    throw e;
  }
}

export async function toggleCoopItemAction(
  itemId: string,
  chosen: boolean,
  weekStartDateKey: string,
  todayKey: string,
): Promise<CoopWeekView> {
  const ownerSub = await requireOwnerSub();
  await coopOrder.setItemChosen(ownerSub, itemId, chosen);
  revalidatePath("/meals");
  return getCoopOrderAction(weekStartDateKey, todayKey);
}
