"use server";

import { revalidatePath } from "next/cache";
import * as health from "@/lib/health";
import * as training from "@/lib/training";
import { AiJsonError } from "@/lib/aiJson";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDomainError } from "@/lib/i18n/errors";
import type { BiologicalSex } from "@/generated/prisma/client";

export type SessionView = training.SessionView;
export type TrainingWeekView = training.TrainingWeekView;

export interface TrainingOverview {
  weekStartDateKey: string;
  week: training.TrainingWeekView;
  preference: training.TrainingPreference;
  /** Null until the profile basics are filled in on /settings. */
  sex: BiologicalSex | null;
  targetBodyFatPercent: number | null;
  targetLeanMassKg: number | null;
  composition: health.CompositionView | null;
  history: health.CompositionWeek[];
}

export async function getTrainingOverviewAction(anchorDateKey: string, todayKey: string): Promise<TrainingOverview> {
  const ownerSub = await requireOwnerSub();
  const weekStartDateKey = await training.weekStartOf(ownerSub, anchorDateKey);
  const [week, preference, profile, current, history] = await Promise.all([
    training.getWeek(ownerSub, weekStartDateKey),
    training.getPreference(ownerSub),
    health.getProfile(ownerSub),
    health.currentTargets(ownerSub, todayKey),
    health.compositionHistory(ownerSub, todayKey, 12),
  ]);
  return {
    weekStartDateKey,
    week,
    preference,
    sex: profile?.sex ?? null,
    targetBodyFatPercent: profile?.targetBodyFatPercent ?? null,
    targetLeanMassKg: profile?.targetLeanMassKg ?? null,
    composition: current?.composition ?? null,
    history,
  };
}

export async function saveCompositionTargetAction(
  input: health.CompositionTargetInput,
  todayKey: string,
): Promise<{ composition: health.CompositionView | null } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await health.setCompositionTarget(ownerSub, input);
    // The target moves the nutrition targets too, so the meal screens and
    // the calendar's day view read it again.
    revalidatePath("/training");
    revalidatePath("/meals");
    revalidatePath("/calendar");
    return { composition: (await health.currentTargets(ownerSub, todayKey))?.composition ?? null };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function saveTrainingPreferenceAction(
  input: training.PreferenceInput,
): Promise<{ preference: training.TrainingPreference } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    const preference = await training.savePreference(ownerSub, input);
    revalidatePath("/training");
    return { preference };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function generateTrainingWeekAction(
  weekStartDateKey: string,
  todayKey: string,
): Promise<{ week: training.TrainingWeekView } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  try {
    const week = await training.generateWeek(ownerSub, weekStartDateKey, todayKey);
    revalidatePath("/training");
    revalidatePath("/meals");
    return { week };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(locale, e) };
    if (e instanceof AiJsonError) {
      console.error("training plan failed", e.code, e.message);
      if (e.code === "notConfigured") return { error: dict.meals.errorNoAiKey };
      const byCode: Record<string, string> = {
        authError: dict.meals.errorAuth,
        rateLimitError: dict.meals.errorRateLimit,
        invalidResponse: dict.meals.errorBadResponse,
        truncated: dict.meals.errorTruncated,
        apiError: dict.meals.errorApi,
      };
      return { error: `${byCode[e.code] ?? dict.meals.errorApi}${dict.meals.errorDetail(e.message)}` };
    }
    throw e;
  }
}

export async function logTrainingSessionAction(
  sessionId: string,
  input: training.SessionLogInput,
): Promise<{ session: training.SessionView } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    const session = await training.logSession(ownerSub, sessionId, input);
    revalidatePath("/training");
    return { session };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}
