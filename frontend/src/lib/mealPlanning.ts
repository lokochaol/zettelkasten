import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { localTimeUtc, shiftDateKey } from "@/lib/dateKey";
import * as googleCalendar from "@/lib/googleCalendar";
import { ValidationError } from "@/lib/errors";
import type { MealKind, MealPlan, MealPreference, MealSlot, MealStatus, PlannedMeal, ShoppingItem } from "@/generated/prisma/client";

export type { MealKind, MealPreference, MealStatus, PlannedMeal, ShoppingItem };

const DAYS_IN_PLAN = 7;

/* ---------- preferences ---------- */

/** The owner's meal preferences, created with defaults the first time.
 * Two first reads at once would both find nothing and both insert, and the
 * loser would fail on the unique owner — so losing that race reads the
 * winner's row back instead (same as moneyPlan.getProfile). */
export async function getPreference(ownerSub: string): Promise<MealPreference> {
  const row = await prisma.mealPreference.findUnique({ where: { ownerSub } });
  if (row) return row;
  try {
    return await prisma.mealPreference.create({ data: { ownerSub } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    const created = await prisma.mealPreference.findUnique({ where: { ownerSub } });
    if (!created) throw e;
    return created;
  }
}

export interface PreferenceInput {
  weeklyBudgetYen: number;
  weekdayCookMinutes: number;
  shoppingWeekday: number;
  weekStartWeekday: number;
  dislikes: string;
  allergies: string;
  breakfastMinutes: number;
  lunchMinutes: number;
  dinnerMinutes: number;
  cookSessionsPerWeek: number;
  readyMadeMealsPerWeek: number;
}

export async function savePreference(ownerSub: string, input: PreferenceInput): Promise<MealPreference> {
  if (!(input.weeklyBudgetYen >= 1000 && input.weeklyBudgetYen <= 200000)) {
    throw new ValidationError("mealPreferenceInvalid", "Weekly budget is out of range");
  }
  if (!(input.weekdayCookMinutes >= 0 && input.weekdayCookMinutes <= 240)) {
    throw new ValidationError("mealPreferenceInvalid", "Cooking time is out of range");
  }
  if (!Number.isInteger(input.shoppingWeekday) || input.shoppingWeekday < 0 || input.shoppingWeekday > 6) {
    throw new ValidationError("mealPreferenceInvalid", "Shopping weekday must be 0-6");
  }
  if (!Number.isInteger(input.weekStartWeekday) || input.weekStartWeekday < 0 || input.weekStartWeekday > 6) {
    throw new ValidationError("mealPreferenceInvalid", "Week start weekday must be 0-6");
  }
  if (!Number.isInteger(input.cookSessionsPerWeek) || input.cookSessionsPerWeek < 0 || input.cookSessionsPerWeek > 7) {
    throw new ValidationError("mealPreferenceInvalid", "Cooking days must be 0-7");
  }
  // 21 is every meal in the week; anything above it is not a preference,
  // it's a typo.
  if (!Number.isInteger(input.readyMadeMealsPerWeek) || input.readyMadeMealsPerWeek < 0 || input.readyMadeMealsPerWeek > 21) {
    throw new ValidationError("mealPreferenceInvalid", "Ready-made meals must be 0-21");
  }
  for (const minutes of [input.breakfastMinutes, input.lunchMinutes, input.dinnerMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
      throw new ValidationError("mealPreferenceInvalid", "Meal times must be within a day");
    }
  }
  return prisma.mealPreference.upsert({
    where: { ownerSub },
    create: { ownerSub, ...input },
    update: input,
  });
}

/* ---------- reading a plan ---------- */

export interface DayTotals {
  dateKey: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  saltG: number;
  prepMinutes: number;
}

export interface MealPlanView {
  plan: MealPlan;
  meals: PlannedMeal[];
  shoppingItems: ShoppingItem[];
  dayTotals: DayTotals[];
  estimatedYen: number;
  /** How far the plan misses the brief it was written to. Recomputed on
   * every read rather than stored: the check is pure, and a warning that
   * only exists in the reply that generated it disappears the moment the
   * owner switches panes. */
  warnings: string[];
}

/** The week a date belongs to, on the owner's own calendar — their week
 * may start on a Monday, a Sunday, or the day they happen to shop. */
export function weekStartFor(dateKey: string, weekStartWeekday: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const diff = (date.getUTCDay() - weekStartWeekday + 7) % 7;
  return shiftDateKey(dateKey, -diff);
}

/**
 * The day the shopping is done for a given week.
 *
 * On or before the week it feeds, never inside it: a trip on Wednesday
 * cannot supply Monday. When the shopping day is the week's own start
 * day that is the first day itself; otherwise it is the most recent one
 * before it — a Saturday shop for a week that starts on Monday.
 */
export function shoppingDayFor(weekStartDateKey: string, shoppingWeekday: number): string {
  const startWeekday = new Date(`${weekStartDateKey}T00:00:00Z`).getUTCDay();
  return shiftDateKey(weekStartDateKey, -((startWeekday - shoppingWeekday + 7) % 7));
}

function totalsFor(meals: PlannedMeal[]): DayTotals[] {
  const byDay = new Map<string, DayTotals>();
  for (const m of meals) {
    const t = byDay.get(m.dateKey) ?? {
      dateKey: m.dateKey, kcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, saltG: 0, prepMinutes: 0,
    };
    t.kcal += m.kcal;
    t.proteinG += m.proteinG;
    t.fatG += m.fatG;
    t.carbG += m.carbG;
    t.fiberG += m.fiberG;
    t.saltG += m.saltG;
    t.prepMinutes += m.prepMinutes;
    byDay.set(m.dateKey, t);
  }
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export async function getPlan(ownerSub: string, weekStartDateKey: string): Promise<MealPlanView | null> {
  const plan = await prisma.mealPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] }, shoppingItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!plan) return null;
  const { meals, shoppingItems, ...rest } = plan;
  return buildView(rest as MealPlan, meals, shoppingItems);
}

/** One place that turns stored rows into what the screen shows, so a plan
 * read back looks exactly like one just generated — warnings included. */
function buildView(plan: MealPlan, meals: PlannedMeal[], shoppingItems: ShoppingItem[]): MealPlanView {
  const dayTotals = totalsFor(meals);
  const estimatedYen = shoppingItems.reduce((sum, i) => sum + i.estimatedYen, 0);
  const dates = Array.from({ length: DAYS_IN_PLAN }, (_, i) => shiftDateKey(plan.weekStartDateKey, i));
  return {
    plan,
    meals,
    shoppingItems,
    dayTotals,
    estimatedYen,
    warnings: checkAgainstBrief(
      dayTotals,
      dates,
      {
        kcal: plan.targetKcal,
        proteinG: plan.targetProteinG,
        fiberG: plan.targetFiberG,
        saltMaxG: plan.targetSaltMaxG,
        weekdayCookMinutes: plan.weekdayCookMinutes,
        cookSessionsPerWeek: plan.cookSessionsPerWeek,
        readyMadeMealsPerWeek: plan.readyMadeMealsPerWeek,
      },
      estimatedYen,
      plan.budgetYen,
      cookingLoadOf(meals),
    ),
  };
}

/**
 * The meals for one day, for the dashboard — from one plan only.
 *
 * Plans are stored per week, keyed by the day the week starts, so two plans
 * can cover the same day: change the week's start from Monday to Saturday
 * and the plan for Mon 9/28–Sun 10/4 still exists beside the new one for
 * Sat 10/3–Fri 10/9. Reading every plan's meals for a date then showed two
 * breakfasts, two lunches and two dinners on the overlap, and added both
 * into the day's planned total.
 *
 * The plan chosen is the one /meals shows for that day under the current
 * week-start setting, so the two screens agree. Days with no such plan —
 * the past, from before the setting changed — fall back to the most recently
 * made plan that covers them.
 */
export async function getMealsForDay(
  ownerSub: string,
  dateKey: string,
  /** Pass it when the caller already has it, to save the read. */
  preference?: MealPreference,
): Promise<PlannedMeal[]> {
  const plans = await prisma.mealPlan.findMany({
    where: { ownerSub, meals: { some: { dateKey } } },
    select: { id: true, weekStartDateKey: true },
    orderBy: { createdAt: "desc" },
  });
  if (plans.length === 0) return [];
  const { weekStartWeekday } = preference ?? (await getPreference(ownerSub));
  const shownWeek = weekStartFor(dateKey, weekStartWeekday);
  const plan = plans.find((p) => p.weekStartDateKey === shownWeek) ?? plans[0];
  return prisma.plannedMeal.findMany({
    where: { planId: plan.id, dateKey },
    orderBy: { slot: "asc" },
  });
}

export interface CookingLoad {
  /** The days with at least one meal cooked from scratch. Named, not just
   * counted, so the warning can say which evenings the plan is claiming. */
  cookDays: string[];
  batchMeals: number;
  readyMeals: number;
}

/** How much kitchen time a plan actually asks for. Pure and exported for
 * the same reason as checkAgainstBrief: this is the claim most worth
 * checking, and the model is the last thing that should be trusted to
 * check it. */
export function cookingLoadOf(meals: Pick<PlannedMeal, "dateKey" | "kind">[]): CookingLoad {
  return {
    cookDays: [...new Set(meals.filter((m) => m.kind === "COOK").map((m) => m.dateKey))].sort(),
    batchMeals: meals.filter((m) => m.kind === "BATCH").length,
    readyMeals: meals.filter((m) => m.kind === "READY").length,
  };
}

/** Recomputed totals vs the brief. Kept exported and pure so the check can
 * be re-run when a plan is read back, not only when it's generated. */
export function checkAgainstBrief(
  dayTotals: DayTotals[],
  expectedDates: string[],
  target: {
    kcal: number;
    proteinG: number;
    fiberG: number;
    saltMaxG: number;
    weekdayCookMinutes: number;
    cookSessionsPerWeek: number;
    readyMadeMealsPerWeek: number;
  },
  estimatedYen: number,
  budgetYen: number,
  load?: CookingLoad,
): string[] {
  const warnings: string[] = [];
  if (load) {
    if (load.cookDays.length > target.cookSessionsPerWeek) {
      warnings.push(
        `台所に立つ日が ${load.cookDays.length} 日（希望は週 ${target.cookSessionsPerWeek} 日）: ${load.cookDays.join(", ")}`,
      );
    }
    if (load.readyMeals > target.readyMadeMealsPerWeek) {
      warnings.push(`冷凍食品・惣菜が ${load.readyMeals} 食（上限 ${target.readyMadeMealsPerWeek} 食）`);
    }
  }
  const missing = expectedDates.filter((d) => !dayTotals.some((t) => t.dateKey === d));
  if (missing.length > 0) warnings.push(`献立が入っていない日: ${missing.join(", ")}`);

  for (const t of dayTotals) {
    if (Math.abs(t.kcal - target.kcal) > 150) {
      warnings.push(`${t.dateKey}: ${t.kcal} kcal（目標 ${target.kcal} から ${t.kcal > target.kcal ? "+" : ""}${t.kcal - target.kcal}）`);
    }
    if (t.proteinG < target.proteinG * 0.9) {
      warnings.push(`${t.dateKey}: たんぱく質 ${Math.round(t.proteinG)}g（目標 ${target.proteinG}g に不足）`);
    }
    if (t.fiberG < target.fiberG * 0.9) {
      warnings.push(`${t.dateKey}: 食物繊維 ${Math.round(t.fiberG)}g（目標 ${target.fiberG}g に不足）`);
    }
    if (t.saltG > target.saltMaxG) {
      warnings.push(`${t.dateKey}: 食塩相当量 ${t.saltG.toFixed(1)}g（上限 ${target.saltMaxG}g 超過）`);
    }
    const weekday = new Date(`${t.dateKey}T00:00:00Z`).getUTCDay();
    // A batch-cooking day is meant to run long — that's the trade. Only
    // the other days are held to the weekday cap.
    const isCookDay = load ? load.cookDays.includes(t.dateKey) : false;
    if (!isCookDay && weekday >= 1 && weekday <= 5 && t.prepMinutes > target.weekdayCookMinutes) {
      warnings.push(`${t.dateKey}: 調理 ${t.prepMinutes}分（平日の上限 ${target.weekdayCookMinutes}分 超過）`);
    }
  }
  if (estimatedYen > budgetYen) {
    warnings.push(`買い物リストの概算 ${estimatedYen.toLocaleString()}円（週予算 ${budgetYen.toLocaleString()}円 超過）`);
  }
  return warnings;
}

/* ---------- placing meals in time ---------- */

/** Minutes past midnight for each slot, from the owner's preference. */
export function slotMinutes(preference: MealPreference, slot: MealSlot): number {
  return slot === "BREAKFAST" ? preference.breakfastMinutes : slot === "LUNCH" ? preference.lunchMinutes : preference.dinnerMinutes;
}

/** How long the block on the timeline is: the cooking the plan asked for,
 * plus twenty minutes to actually eat it. A five-minute breakfast still
 * takes a chunk out of a morning. */
export function slotDurationMinutes(prepMinutes: number): number {
  return Math.max(20, prepMinutes) + 20;
}

export interface ScheduledMeal {
  meal: PlannedMeal;
  start: Date;
  end: Date;
}

/** The day's meals as instants, using the owner's local midnight so the
 * times mean what the clock on their wall says. */
export async function scheduledMealsForDay(
  ownerSub: string,
  dateKey: string,
  timeZone: string,
): Promise<ScheduledMeal[]> {
  const preference = await getPreference(ownerSub);
  const meals = await getMealsForDay(ownerSub, dateKey, preference);
  return meals.map((meal) => {
    const start = localTimeUtc(dateKey, slotMinutes(preference, meal.slot), timeZone);
    return { meal, start, end: new Date(start.getTime() + slotDurationMinutes(meal.prepMinutes) * 60_000) };
  });
}

/**
 * Writes the week's meals into Google Calendar, one event each, updating
 * the events already written rather than adding a second set. The event id
 * is kept on the meal, so a meal replaced by a regenerated plan simply
 * loses its pointer and the new one writes a fresh event.
 *
 * Partial success is the normal case worth designing for: if the calendar
 * rejects the fourth of twenty-one events, the first three are already in
 * the owner's calendar and should stay. So failures are counted and
 * returned instead of unwinding.
 */
export async function syncWeekToCalendar(
  ownerSub: string,
  weekStartDateKey: string,
  timeZone: string,
): Promise<{ written: number; failed: number }> {
  const preference = await getPreference(ownerSub);
  const plan = await prisma.mealPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] } },
  });
  if (!plan) throw new ValidationError("mealPlanNotFound", "No plan for that week");

  let written = 0;
  let failed = 0;
  for (const meal of plan.meals) {
    const start = localTimeUtc(meal.dateKey, slotMinutes(preference, meal.slot), timeZone);
    const end = new Date(start.getTime() + slotDurationMinutes(meal.prepMinutes) * 60_000);
    try {
      const eventId = await googleCalendar.upsertEvent(
        ownerSub,
        {
          summary: `${slotLabelJa(meal.slot)} ${meal.title}`,
          description: `${meal.kcal} kcal / P ${meal.proteinG}g F ${meal.fatG}g C ${meal.carbG}g\n\n${meal.recipe}`,
          start,
          end,
          timeZone,
        },
        meal.googleEventId,
      );
      if (eventId !== meal.googleEventId) {
        await prisma.plannedMeal.update({ where: { id: meal.id }, data: { googleEventId: eventId } });
      }
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
}

function slotLabelJa(slot: MealSlot): string {
  return slot === "BREAKFAST" ? "朝食" : slot === "LUNCH" ? "昼食" : "夕食";
}

/* ---------- what actually happened ---------- */

export interface DayIntake {
  /** Totals from the meals confirmed eaten, and only those. */
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  saltG: number;
  eaten: number;
  skipped: number;
  /** Eaten, but something else — so its nutrition is unknown and is not in
   * the totals above. Counted separately so the UI can say the day's figure
   * is incomplete instead of quietly under-reporting it. */
  replaced: number;
  /** Nothing said yet. Not "didn't eat": an unanswered meal is unknown, and
   * treating it as a skip would tell the owner they are under target when
   * they may simply not have logged lunch. */
  unlogged: number;
}

/** Pure, so the same arithmetic serves the dashboard, a later week view,
 * and the tests. */
export function intakeOf(meals: Pick<PlannedMeal, "status" | "kcal" | "proteinG" | "fatG" | "carbG" | "fiberG" | "saltG">[]): DayIntake {
  const intake: DayIntake = { kcal: 0, proteinG: 0, fatG: 0, carbG: 0, fiberG: 0, saltG: 0, eaten: 0, skipped: 0, replaced: 0, unlogged: 0 };
  for (const meal of meals) {
    if (meal.status === "EATEN") {
      intake.kcal += meal.kcal;
      intake.proteinG += meal.proteinG;
      intake.fatG += meal.fatG;
      intake.carbG += meal.carbG;
      intake.fiberG += meal.fiberG;
      intake.saltG += meal.saltG;
      intake.eaten++;
    } else if (meal.status === "SKIPPED") intake.skipped++;
    else if (meal.status === "REPLACED") intake.replaced++;
    else intake.unlogged++;
  }
  return intake;
}

/** Records what happened to one meal. The note belongs to REPLACED and is
 * cleared otherwise, so a note can't outlive the answer it explained. */
export async function setMealStatus(
  ownerSub: string,
  mealId: string,
  status: MealStatus,
  replacementNote = "",
): Promise<PlannedMeal> {
  const meal = await prisma.plannedMeal.findFirst({ where: { id: mealId, plan: { ownerSub } }, select: { id: true } });
  if (!meal) throw new ValidationError("mealPlanNotFound", "Meal not found");
  return prisma.plannedMeal.update({
    where: { id: mealId },
    data: { status, replacementNote: status === "REPLACED" ? replacementNote.trim().slice(0, 200) : "" },
  });
}
