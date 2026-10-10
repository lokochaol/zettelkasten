"use server";

import { revalidatePath } from "next/cache";
import * as mealPlanning from "@/lib/mealPlanning";
import * as expenses from "@/lib/expenses";
import * as inventory from "@/lib/inventory";
import * as mealChat from "@/lib/mealChat";
import * as purchaseList from "@/lib/purchaseList";
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
  const weekStartDateKey = mealPlanning.weekStartFor(dateKey, preference.weekStartWeekday);
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

/**
 * Ticks a shopping line, and with it puts the item into the inventory (or,
 * unticked, takes it back out — see inventory.setShoppingItemBought).
 * Returns the inventory as it now stands, so the list beside the shopping
 * list moves in the same tap.
 */
export async function toggleShoppingItemAction(itemId: string, checked: boolean): Promise<inventory.InventoryItem[]> {
  const ownerSub = await requireOwnerSub();
  await inventory.setShoppingItemBought(ownerSub, itemId, checked);
  revalidatePath("/meals");
  return inventory.listInventory(ownerSub);
}

/* ---------- purchase list ---------- */

export type PurchaseListView = purchaseList.PurchaseListView;

export async function getPurchaseListAction(): Promise<PurchaseListView | null> {
  return purchaseList.getPurchaseList(await requireOwnerSub());
}

/** Makes the to-buy list for `days` days from `fromDateKey` — the step
 * after the meals are settled. Replaces the current list. */
export async function createPurchaseListAction(
  fromDateKey: string,
  days: number,
): Promise<{ list: PurchaseListView; inventory: inventory.InventoryItem[] } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const list = await purchaseList.createPurchaseList(ownerSub, fromDateKey, days);
    revalidatePath("/meals");
    return { list, inventory: await inventory.listInventory(ownerSub) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof AiJsonError) {
      console.error("purchase list failed", e.code, e.message);
      return { error: aiErrorMessage(getDictionary(locale), e) };
    }
    throw e;
  }
}

export async function clearPurchaseListAction(): Promise<void> {
  await purchaseList.clearPurchaseList(await requireOwnerSub());
  revalidatePath("/meals");
}

/* ---------- inventory ---------- */

export async function listInventoryAction(): Promise<inventory.InventoryItem[]> {
  return inventory.listInventory(await requireOwnerSub());
}

type InventoryResult = { items: inventory.InventoryItem[] } | { error: string };

async function inventoryChange(change: (ownerSub: string) => Promise<unknown>): Promise<InventoryResult> {
  const ownerSub = await requireOwnerSub();
  try {
    await change(ownerSub);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/meals");
  return { items: await inventory.listInventory(ownerSub) };
}

export async function addInventoryItemAction(input: inventory.InventoryInput): Promise<InventoryResult> {
  return inventoryChange((ownerSub) => inventory.addInventoryItem(ownerSub, input));
}

export async function updateInventoryItemAction(id: string, input: Partial<inventory.InventoryInput>): Promise<InventoryResult> {
  return inventoryChange((ownerSub) => inventory.updateInventoryItem(ownerSub, id, input));
}

export async function removeInventoryItemAction(id: string): Promise<InventoryResult> {
  return inventoryChange((ownerSub) => inventory.removeInventoryItem(ownerSub, id));
}

/* ---------- meal chat ---------- */

/** A chat message as the screen gets it: plain values only, the proposal
 * already read out of its JSON column. */
export interface MealChatMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposal: mealChat.Proposal | null;
  applied: boolean;
  dismissed: boolean;
}

function toView(m: mealChat.MealChatMessage): MealChatMessageView {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    proposal: (m.proposal as unknown as mealChat.Proposal | null) ?? null,
    applied: m.appliedAt !== null,
    dismissed: m.dismissedAt !== null,
  };
}

function aiErrorMessage(dict: ReturnType<typeof getDictionary>, e: AiJsonError): string {
  const byCode: Record<string, string> = {
    notConfigured: dict.meals.errorNoAiKey,
    authError: dict.meals.errorAuth,
    rateLimitError: dict.meals.errorRateLimit,
    invalidResponse: dict.meals.errorBadResponse,
    truncated: dict.meals.errorTruncated,
    apiError: dict.meals.errorApi,
  };
  if (e.code === "notConfigured") return byCode.notConfigured;
  return `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}`;
}

export async function getMealChatAction(weekStartDateKey: string): Promise<MealChatMessageView[]> {
  const ownerSub = await requireOwnerSub();
  const plan = await mealPlanning.getPlan(ownerSub, weekStartDateKey);
  if (!plan) return [];
  return (await mealChat.listMessages(ownerSub, plan.plan.id)).map(toView);
}

export async function sendMealChatAction(
  weekStartDateKey: string,
  text: string,
  todayKey: string,
): Promise<{ messages: MealChatMessageView[] } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  try {
    const messages = await mealChat.sendMessage(ownerSub, weekStartDateKey, text, todayKey);
    return { messages: messages.map(toView) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof AiJsonError) {
      console.error("meal chat failed", e.code, e.message);
      return { error: aiErrorMessage(getDictionary(locale), e) };
    }
    throw e;
  }
}

/**
 * Applies a proposal from the chat, and hands back everything it moved —
 * the week, the inventory, the conversation — so the screen updates in one
 * go. If the replaced meals had been written to Google Calendar, those
 * events are rewritten too; a failure there is reported but doesn't undo
 * the plan change.
 */
export async function applyMealChatProposalAction(
  messageId: string,
  weekStartDateKey: string,
  todayKey: string,
  timeZone: string,
): Promise<
  | { week: MealWeekView; inventory: inventory.InventoryItem[]; messages: MealChatMessageView[]; calendarError: string | null }
  | { error: string }
> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  let calendarNeedsUpdate = false;
  try {
    ({ calendarNeedsUpdate } = await mealChat.applyProposal(ownerSub, messageId, todayKey));
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    throw e;
  }
  let calendarError: string | null = null;
  if (calendarNeedsUpdate) {
    try {
      await mealPlanning.syncWeekToCalendar(ownerSub, weekStartDateKey, timeZone);
    } catch (e) {
      if (e instanceof GoogleCalendarNotLinkedError) calendarError = dict.meals.syncNotLinked;
      else if (e instanceof GoogleCalendarAuthError) calendarError = dict.meals.syncReauth;
      else if (e instanceof GoogleCalendarApiError) calendarError = dict.meals.syncFailed;
      else throw e;
    }
  }
  revalidatePath("/meals");
  revalidatePath("/calendar");
  const plan = await mealPlanning.getPlan(ownerSub, weekStartDateKey);
  return {
    week: await getMealWeekAction(weekStartDateKey),
    inventory: await inventory.listInventory(ownerSub),
    messages: plan ? (await mealChat.listMessages(ownerSub, plan.plan.id)).map(toView) : [],
    calendarError,
  };
}

export async function dismissMealChatProposalAction(
  messageId: string,
  weekStartDateKey: string,
): Promise<{ messages: MealChatMessageView[] } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await mealChat.dismissProposal(ownerSub, messageId);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  return { messages: await getMealChatAction(weekStartDateKey) };
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

