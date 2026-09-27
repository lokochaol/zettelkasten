"use server";

import { revalidatePath } from "next/cache";
import * as mealPlanning from "@/lib/mealPlanning";
import type { MealPlanView, PreferenceInput } from "@/lib/mealPlanning";
import { AiJsonError } from "@/lib/aiJson";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDomainError } from "@/lib/i18n/errors";

export interface MealWeekView {
  weekStartDateKey: string;
  preference: mealPlanning.MealPreference;
  view: MealPlanView | null;
}

export async function getMealWeekAction(dateKey: string): Promise<MealWeekView> {
  const ownerSub = await requireOwnerSub();
  const preference = await mealPlanning.getPreference(ownerSub);
  const weekStartDateKey = mealPlanning.weekStartFor(dateKey, preference.shoppingWeekday);
  return { weekStartDateKey, preference, view: await mealPlanning.getPlan(ownerSub, weekStartDateKey) };
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
        apiError: dict.meals.errorApi,
      };
      return { error: byCode[e.code] ?? dict.meals.errorApi };
    }
    throw e;
  }
}

export async function toggleShoppingItemAction(itemId: string, checked: boolean): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await mealPlanning.setShoppingItemChecked(ownerSub, itemId, checked);
  revalidatePath("/meals");
}
