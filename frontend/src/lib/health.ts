import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import { shiftDateKey } from "@/lib/dateKey";
import { ageFromBirthYear, computeTargets, type NutritionTargets } from "@/lib/nutritionTargets";
import * as body from "@/lib/bodyComposition";
import type { ActivityLevel, BiologicalSex, HealthDailyMetric, HealthProfile } from "@/generated/prisma/client";

export type { HealthProfile, HealthDailyMetric };

/** How many days of active energy to average when setting targets. A
 * single day is the wrong input for planning a week of meals: it swings
 * with one long walk, and before noon it's barely accumulated anything. */
const ACTIVE_ENERGY_WINDOW_DAYS = 7;

export interface ProfileInput {
  heightCm: number;
  birthYear: number;
  sex: BiologicalSex;
  activityLevel: ActivityLevel;
  weeklyKgDelta: number;
  fallbackWeightKg: number | null;
  /** The composition being aimed at. Once a scale is reporting, this is
   * the goal and the weekly figure above is derived from it. */
  targetBodyFatPercent: number | null;
}

export async function getProfile(ownerSub: string): Promise<HealthProfile | null> {
  return prisma.healthProfile.findUnique({ where: { ownerSub } });
}

export async function upsertProfile(ownerSub: string, input: ProfileInput): Promise<HealthProfile> {
  if (!(input.heightCm >= 100 && input.heightCm <= 250)) {
    throw new ValidationError("healthProfileInvalid", "Height must be between 100 and 250 cm");
  }
  const thisYear = new Date().getUTCFullYear();
  if (!Number.isInteger(input.birthYear) || input.birthYear < thisYear - 120 || input.birthYear > thisYear - 10) {
    throw new ValidationError("healthProfileInvalid", "Birth year is out of range");
  }
  // A goal outside this band isn't a preference, it's a plan to lose muscle
  // — and this app would be the one writing the menu for it.
  if (!(input.weeklyKgDelta >= -1 && input.weeklyKgDelta <= 0.5)) {
    throw new ValidationError("healthGoalTooAggressive", "Weekly change must be between -1.0 and +0.5 kg");
  }
  if (input.fallbackWeightKg !== null && !(input.fallbackWeightKg >= 25 && input.fallbackWeightKg <= 300)) {
    throw new ValidationError("healthProfileInvalid", "Weight must be between 25 and 300 kg");
  }
  // Below the essential-fat line is not a goal anyone should be able to
  // type into a meal planner. The floors are the essential body fat
  // figures — the fat the body is built out of, not the fat it stores.
  if (input.targetBodyFatPercent !== null) {
    const floor = input.sex === "MALE" ? 6 : 14;
    if (!(input.targetBodyFatPercent >= floor && input.targetBodyFatPercent <= 40)) {
      throw new ValidationError("healthGoalTooAggressive", `Target body fat must be between ${floor}% and 40%`);
    }
  }
  const data = { ...input };
  return prisma.healthProfile.upsert({ where: { ownerSub }, create: { ownerSub, ...data }, update: data });
}

export async function listRecentMetrics(ownerSub: string, limit = 14): Promise<HealthDailyMetric[]> {
  return prisma.healthDailyMetric.findMany({ where: { ownerSub }, orderBy: { dateKey: "desc" }, take: limit });
}

export interface MetricInput {
  dateKey: string;
  weightKg?: number | null;
  activeEnergyKcal?: number | null;
  bodyFatPercent?: number | null;
  leanBodyMassKg?: number | null;
  steps?: number | null;
}

/**
 * Upsert rather than insert: the Shortcut posts a daily summary, so a
 * second delivery for the same day is a corrected figure, not a second
 * reading to add up.
 *
 * Only the fields actually sent are written. An absent field means "no
 * information", never "clear it" — which matters because the metrics for
 * one day don't all arrive together: a morning run sends today's weight
 * while yesterday's energy and steps are the ones that are complete, so
 * each day ends up written twice, from two different requests. Treating
 * absence as null would have the second write wipe the first.
 */
export async function recordDailyMetric(ownerSub: string, input: MetricInput): Promise<HealthDailyMetric> {
  // One spelling, deliberately: the format is documented, the Shortcut is
  // set up once, and a loose parser would let a misconfigured automation
  // look like it was working. The received value is echoed back so a
  // mismatch is diagnosable without another round trip.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) {
    throw new ValidationError(
      "healthMetricInvalid",
      `date must be YYYY-MM-DD (received: ${JSON.stringify(input.dateKey)})`,
    );
  }
  const provided = {
    ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
    ...(input.activeEnergyKcal !== undefined ? { activeEnergyKcal: input.activeEnergyKcal } : {}),
    ...(input.bodyFatPercent !== undefined ? { bodyFatPercent: input.bodyFatPercent } : {}),
    ...(input.leanBodyMassKg !== undefined ? { leanBodyMassKg: input.leanBodyMassKg } : {}),
    ...(input.steps !== undefined ? { steps: input.steps } : {}),
  };
  return prisma.healthDailyMetric.upsert({
    where: { ownerSub_dateKey: { ownerSub, dateKey: input.dateKey } },
    create: { ownerSub, dateKey: input.dateKey, ...provided, receivedAt: new Date() },
    update: { ...provided, receivedAt: new Date() },
  });
}

/* ---------- ingest token ---------- */

const TOKEN_PREFIX_LENGTH = 8;

export interface IngestTokenView {
  token: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export async function getIngestToken(ownerSub: string): Promise<IngestTokenView | null> {
  const row = await prisma.healthIngestToken.findUnique({ where: { ownerSub } });
  if (!row) return null;
  return { token: decryptSecret(row.tokenEncrypted), lastUsedAt: row.lastUsedAt, createdAt: row.createdAt };
}

/** Issues (or replaces) the token the Shortcut sends. Replacing one breaks
 * the automation already on the phone, which the UI warns about. */
export async function issueIngestToken(ownerSub: string): Promise<IngestTokenView> {
  const token = `hk_${randomBytes(24).toString("base64url")}`;
  const data = {
    tokenEncrypted: encryptSecret(token),
    tokenPrefix: token.slice(0, TOKEN_PREFIX_LENGTH),
    lastUsedAt: null,
  };
  const row = await prisma.healthIngestToken.upsert({ where: { ownerSub }, create: { ownerSub, ...data }, update: data });
  return { token, lastUsedAt: null, createdAt: row.createdAt };
}

/** Resolves a bearer token to its owner. The prefix is stored in the clear
 * purely as an index — the match itself is against the decrypted value, so
 * a colliding prefix can't authenticate anyone. */
export async function ownerForIngestToken(token: string): Promise<string | null> {
  const row = await prisma.healthIngestToken.findUnique({ where: { tokenPrefix: token.slice(0, TOKEN_PREFIX_LENGTH) } });
  if (!row) return null;
  let stored: string;
  try {
    stored = decryptSecret(row.tokenEncrypted);
  } catch {
    return null;
  }
  if (stored !== token) return null;
  await prisma.healthIngestToken.update({ where: { ownerSub: row.ownerSub }, data: { lastUsedAt: new Date() } });
  return row.ownerSub;
}

/* ---------- targets ---------- */

export interface CompositionView {
  /** Averaged over a week, because a day of it is mostly water. */
  current: body.Window;
  trend: body.Trend;
  band: body.Band | null;
  /** The target actually being worked to — the owner's, or the one
   * derived from the athletic range when they haven't set one. Never
   * null once a composition exists: "aim at nothing" is not a useful
   * state for something that plans meals. */
  targetBodyFatPercent: number;
  /** True when the app chose it, so the screen can say so rather than
   * presenting a number the owner never typed as if they had. */
  targetIsAuto: boolean;
  suggested: { from: number; to: number };
  plan: body.CompositionPlan | null;
}

export interface CurrentTargets {
  targets: NutritionTargets;
  weightKg: number;
  weightSource: "measured" | "manual";
  /** Null until a scale reports a body fat percentage. */
  composition: CompositionView | null;
  /** The measurement window the active-energy average came from, for the
   * UI to say what the numbers are actually based on. */
  activeEnergyDays: number;
  lastSyncedDateKey: string | null;
}

/** The day's nutrition targets, or null when the profile isn't filled in
 * (or there's no weight from either source yet) — a missing profile is a
 * normal first-run state, not an error. */
export async function currentTargets(ownerSub: string, todayKey: string): Promise<CurrentTargets | null> {
  const profile = await getProfile(ownerSub);
  if (!profile) return null;

  const since = shiftDateKey(todayKey, -ACTIVE_ENERGY_WINDOW_DAYS);
  const window = await prisma.healthDailyMetric.findMany({
    where: { ownerSub, dateKey: { gt: since, lte: todayKey } },
    orderBy: { dateKey: "desc" },
  });

  const weighed = window.find((m) => m.weightKg !== null) ?? (await prisma.healthDailyMetric.findFirst({
    where: { ownerSub, weightKg: { not: null } },
    orderBy: { dateKey: "desc" },
  }));
  const weightKg = weighed?.weightKg ?? profile.fallbackWeightKg;
  if (!weightKg) return null;

  // Today is deliberately excluded from the average: it's still
  // accumulating, and a half-finished day would drag the target down all
  // morning and drift up all evening.
  const energies = window.filter((m) => m.dateKey !== todayKey && m.activeEnergyKcal !== null).map((m) => m.activeEnergyKcal as number);
  const avgActive = energies.length > 0 ? energies.reduce((a, b) => a + b, 0) / energies.length : null;

  const composition = await compositionFor(ownerSub, todayKey, profile);
  // Averaged lean mass, not today's reading: the targets shouldn't move
  // because yesterday was salty.
  const leanMassKg = composition?.current.leanMassKg ?? null;
  // With a composition goal, the weekly rate is worked out from the gap
  // rather than typed in — the owner says what body they want, not how
  // fast to lose weight.
  const weeklyKgDelta = composition?.plan?.weeklyKgDelta ?? profile.weeklyKgDelta;

  return {
    targets: computeTargets({
      heightCm: profile.heightCm,
      weightKg,
      age: ageFromBirthYear(profile.birthYear),
      sex: profile.sex,
      activityLevel: profile.activityLevel,
      weeklyKgDelta,
      leanMassKg,
      measuredActiveEnergyKcal: avgActive,
    }),
    weightKg,
    weightSource: weighed?.weightKg ? "measured" : "manual",
    composition,
    activeEnergyDays: energies.length,
    lastSyncedDateKey: window[0]?.dateKey ?? null,
  };
}

/** How many days of readings the trend looks back over: two weeks, so
 * there is a week to compare against a week. */
const COMPOSITION_WINDOW_DAYS = 14;

/**
 * The body as the scale has been seeing it.
 *
 * Null when no body fat percentage has ever arrived — a weight alone
 * says nothing about composition, and this file would rather report
 * nothing than a number it made up.
 */
async function compositionFor(
  ownerSub: string,
  todayKey: string,
  profile: HealthProfile,
): Promise<CompositionView | null> {
  const rows = await prisma.healthDailyMetric.findMany({
    where: { ownerSub, dateKey: { gt: shiftDateKey(todayKey, -COMPOSITION_WINDOW_DAYS), lte: todayKey } },
    orderBy: { dateKey: "asc" },
  });
  const measurements: body.Measurement[] = rows.map((r) => ({
    dateKey: r.dateKey,
    weightKg: r.weightKg,
    bodyFatPercent: r.bodyFatPercent,
    leanBodyMassKg: r.leanBodyMassKg,
  }));
  const trend = body.trendOf(measurements, 7);
  const current = trend.recent;
  if (current.bodyFatPercent === null || current.weightKg === null || current.leanMassKg === null) return null;

  const targetIsAuto = profile.targetBodyFatPercent === null;
  const target = profile.targetBodyFatPercent ?? body.autoTargetFor(current.bodyFatPercent, profile.sex);
  return {
    current,
    trend,
    band: body.bandOf(current.bodyFatPercent, profile.sex),
    targetBodyFatPercent: target,
    targetIsAuto,
    suggested: body.suggestedTarget(profile.sex),
    plan: body.planFor(
      {
        weightKg: current.weightKg,
        bodyFatPercent: current.bodyFatPercent,
        fatMassKg: current.fatMassKg ?? 0,
        leanMassKg: current.leanMassKg,
      },
      target,
    ),
  };
}

/** One day's measurements, or null when the phone hasn't sent that day. */
export async function getDailyMetric(ownerSub: string, dateKey: string): Promise<HealthDailyMetric | null> {
  return prisma.healthDailyMetric.findUnique({ where: { ownerSub_dateKey: { ownerSub, dateKey } } });
}
