"use server";

import { revalidatePath } from "next/cache";
import * as dayPlan from "@/lib/dayPlan";
import { requireOwnerSub } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";

/*
 * The day's plan (src/lib/dayPlan.ts). The browser passes its own time zone:
 * the blocks are clock times, and the calendar writes them in the zone the
 * owner reads them in.
 */

type Result<T> = T | { error: string };

async function run<T>(work: (ownerSub: string) => Promise<T>): Promise<Result<T>> {
  const ownerSub = await requireOwnerSub();
  try {
    const result = await work(ownerSub);
    revalidatePath("/calendar");
    return result;
  } catch (e) {
    if (e instanceof DomainError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function getDayPlanAction(dateKey: string, timeZone: string) {
  const ownerSub = await requireOwnerSub();
  const [plan, messages] = await Promise.all([dayPlan.getDayPlan(ownerSub, dateKey, timeZone), dayPlan.listDayMessages(ownerSub, dateKey)]);
  return { plan, messages };
}

export async function saveDayPlanAction(dateKey: string, blocks: dayPlan.DayBlock[], note: string, timeZone: string) {
  return run(async (o) => ({ plan: await dayPlan.saveDayPlan(o, dateKey, blocks, note, timeZone) }));
}

export async function redraftDayPlanAction(dateKey: string, timeZone: string) {
  return run(async (o) => ({ plan: await dayPlan.redraftDayPlan(o, dateKey, timeZone) }));
}

export async function pushDayPlanAction(dateKey: string, timeZone: string) {
  return run(async (o) => {
    const result = await dayPlan.pushDayPlan(o, dateKey, timeZone);
    return { result, plan: await dayPlan.getDayPlan(o, dateKey, timeZone) };
  });
}

export async function applyDayProposalAction(messageId: string, timeZone: string) {
  return run(async (o) => {
    const plan = await dayPlan.applyDayProposal(o, messageId, timeZone);
    return { plan, messages: await dayPlan.listDayMessages(o, plan.dateKey) };
  });
}

export async function dismissDayProposalAction(messageId: string, dateKey: string) {
  return run(async (o) => {
    await dayPlan.dismissDayProposal(o, messageId);
    return { messages: await dayPlan.listDayMessages(o, dateKey) };
  });
}

export async function clearDayMessagesAction(dateKey: string) {
  return run(async (o) => {
    await dayPlan.clearDayMessages(o, dateKey);
    return { messages: [] as dayPlan.DayMessageView[] };
  });
}
