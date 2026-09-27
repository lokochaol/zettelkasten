import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { localTimeUtc, shiftDateKey } from "@/lib/dateKey";
import * as googleCalendar from "@/lib/googleCalendar";
import { currentTargets } from "@/lib/health";
import { ValidationError } from "@/lib/errors";
import type { MealPlan, MealPreference, MealSlot, PlannedMeal, ShoppingItem } from "@/generated/prisma/client";

export type { MealPreference, PlannedMeal, ShoppingItem };

const SLOTS: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER"];
const DAYS_IN_PLAN = 7;

/* ---------- preferences ---------- */

export async function getPreference(ownerSub: string): Promise<MealPreference> {
  const row = await prisma.mealPreference.findUnique({ where: { ownerSub } });
  if (row) return row;
  return prisma.mealPreference.create({ data: { ownerSub } });
}

export interface PreferenceInput {
  weeklyBudgetYen: number;
  weekdayCookMinutes: number;
  shoppingWeekday: number;
  dislikes: string;
  allergies: string;
  breakfastMinutes: number;
  lunchMinutes: number;
  dinnerMinutes: number;
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
}

/** The week a date belongs to, starting on the owner's shopping day — the
 * plan is organised around the trip, not around Monday. */
export function weekStartFor(dateKey: string, shoppingWeekday: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const diff = (date.getUTCDay() - shoppingWeekday + 7) % 7;
  return shiftDateKey(dateKey, -diff);
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
  return {
    plan: rest as MealPlan,
    meals,
    shoppingItems,
    dayTotals: totalsFor(meals),
    estimatedYen: shoppingItems.reduce((sum, i) => sum + i.estimatedYen, 0),
  };
}

/** The meals for one day, for the dashboard. */
export async function getMealsForDay(ownerSub: string, dateKey: string): Promise<PlannedMeal[]> {
  return prisma.plannedMeal.findMany({
    where: { dateKey, plan: { ownerSub } },
    orderBy: { slot: "asc" },
  });
}

export async function setShoppingItemChecked(ownerSub: string, itemId: string, checked: boolean): Promise<void> {
  const item = await prisma.shoppingItem.findFirst({ where: { id: itemId, plan: { ownerSub } }, select: { id: true } });
  if (!item) throw new ValidationError("mealPlanNotFound", "Shopping item not found");
  await prisma.shoppingItem.update({ where: { id: itemId }, data: { checked } });
}

/* ---------- generation ---------- */

const SYSTEM_PROMPT = `あなたは管理栄養士です。1週間分の献立（朝・昼・夕 × 7日）と、それを作るための買い物リストを設計します。

守ること:
1. 栄養目標は1日ごとに満たす。週の平均で帳尻を合わせるのではなく、毎日がバランスの取れた1日になるようにする。特にたんぱく質と食物繊維は毎日届かせ、食塩相当量は毎日その上限を超えない。
2. 買い物は週に1回だけ。7日分すべての食材が、その1回で買える内容であること。
3. 使い切る。同じ食材を複数の日・複数の料理に散らし、中途半端に余らないように数量を決める。
4. 傷みやすいもの（葉物野菜・生魚・鶏肉）は週の前半に、日持ちするもの（根菜・冷凍・乾物）は後半に配置する。
5. 予算を超えない。買い物リストの概算金額の合計が、指定された週予算以内に収まること。
6. 平日の調理時間の上限を守る。超えそうな日は、前日の作り置きや冷凍を前提にした構成にする（その旨をrecipeに書く）。
7. 苦手な食材は使わない。アレルギーの食材は、微量でも、出汁や調味料としても絶対に使わない。
8. 日本の家庭で普通に手に入る食材と、現実的な価格にする。
9. 栄養価は1食あたりの実際の量に基づいて見積もる。適当な丸め値ではなく、材料から計算した値にすること。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "meals": [
        {
          "slot": "BREAKFAST",
          "title": "料理名",
          "recipe": "材料（分量つき）と作り方を短く。作り置きを使う場合はその旨も。",
          "kcal": 480,
          "proteinG": 28,
          "fatG": 14,
          "carbG": 52,
          "fiberG": 6,
          "saltG": 1.2,
          "prepMinutes": 5
        }
      ]
    }
  ],
  "shopping": [
    { "category": "肉・魚", "name": "鶏むね肉", "quantity": "400g × 2", "estimatedYen": 720 }
  ]
}

daysは7日分、各日のmealsはBREAKFAST・LUNCH・DINNERの3つを必ず含めること。`;

interface RawMeal {
  slot?: unknown;
  title?: unknown;
  recipe?: unknown;
  kcal?: unknown;
  proteinG?: unknown;
  fatG?: unknown;
  carbG?: unknown;
  fiberG?: unknown;
  saltG?: unknown;
  prepMinutes?: unknown;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface GenerateResult {
  view: MealPlanView;
  /** Days whose totals missed the brief, so the UI can say so instead of
   * presenting the model's output as if it were verified. */
  warnings: string[];
}

/**
 * Generates and stores a week's plan.
 *
 * What comes back is checked against the brief rather than trusted: the
 * model is good at proposing meals and unreliable at arithmetic, so the
 * per-day totals are recomputed here and any day that misses the targets
 * is reported. Showing a plan next to how far off it is beats either
 * silently accepting it or throwing away an otherwise usable week.
 */
export async function generatePlan(ownerSub: string, weekStartDateKey: string, todayKey: string): Promise<GenerateResult> {
  const [preference, targetsNow] = await Promise.all([getPreference(ownerSub), currentTargets(ownerSub, todayKey)]);
  if (!targetsNow) {
    throw new ValidationError("healthProfileMissing", "Fill in the health profile first — there are no targets to plan against");
  }
  const t = targetsNow.targets;
  const dates = Array.from({ length: DAYS_IN_PLAN }, (_, i) => shiftDateKey(weekStartDateKey, i));

  const brief = [
    `対象の7日間: ${dates.join(", ")}`,
    `買い物日: ${dates[0]}（この日に1回だけ買い物をする）`,
    "",
    "1日あたりの栄養目標（毎日これを満たす）:",
    `  エネルギー ${t.targetKcal} kcal（±100 kcal 以内）`,
    `  たんぱく質 ${t.proteinG} g 以上`,
    `  脂質 ${t.fatG} g 前後`,
    `  炭水化物 ${t.carbG} g 前後`,
    `  食物繊維 ${t.fiberG} g 以上`,
    `  食塩相当量 ${t.saltMaxG} g 未満`,
    "",
    `週の食費: ${preference.weeklyBudgetYen} 円以内`,
    `平日の調理時間: 1日あたり合計 ${preference.weekdayCookMinutes} 分以内（土日は多めでも可）`,
    preference.dislikes ? `苦手・避けたいもの: ${preference.dislikes}` : "苦手な食材: 特になし",
    preference.allergies ? `アレルギー（絶対に使わない）: ${preference.allergies}` : "アレルギー: なし",
  ].join("\n");

  const parsed = (await askForJson(ownerSub, SYSTEM_PROMPT, brief)) as { days?: unknown; shopping?: unknown };

  const meals: Array<Omit<PlannedMeal, "id" | "planId" | "googleEventId">> = [];
  const days = Array.isArray(parsed.days) ? parsed.days : [];
  for (const rawDay of days) {
    const day = rawDay as { date?: unknown; meals?: unknown };
    const dateKey = str(day.date);
    if (!dates.includes(dateKey)) continue; // ignore a date the model invented
    for (const rawMeal of Array.isArray(day.meals) ? day.meals : []) {
      const m = rawMeal as RawMeal;
      const slot = str(m.slot).toUpperCase() as MealSlot;
      if (!SLOTS.includes(slot)) continue;
      const title = str(m.title);
      if (!title) continue;
      meals.push({
        dateKey,
        slot,
        title,
        recipe: str(m.recipe),
        kcal: Math.round(num(m.kcal)),
        proteinG: num(m.proteinG),
        fatG: num(m.fatG),
        carbG: num(m.carbG),
        fiberG: num(m.fiberG),
        saltG: num(m.saltG),
        prepMinutes: Math.round(num(m.prepMinutes)),
      });
    }
  }
  if (meals.length === 0) throw new AiJsonError("invalidResponse", "the plan contained no usable meals");

  const shopping = (Array.isArray(parsed.shopping) ? parsed.shopping : []).map((rawItem, i) => {
    const item = rawItem as { category?: unknown; name?: unknown; quantity?: unknown; estimatedYen?: unknown };
    return {
      category: str(item.category) || "その他",
      name: str(item.name),
      quantity: str(item.quantity),
      estimatedYen: Math.round(num(item.estimatedYen)),
      sortOrder: i,
    };
  }).filter((i) => i.name);

  const plan = await prisma.$transaction(async (tx) => {
    // Regenerating replaces the week outright; the cascade takes the old
    // meals and shopping list with it.
    await tx.mealPlan.deleteMany({ where: { ownerSub, weekStartDateKey } });
    return tx.mealPlan.create({
      data: {
        ownerSub,
        weekStartDateKey,
        targetKcal: t.targetKcal,
        targetProteinG: t.proteinG,
        targetFiberG: t.fiberG,
        budgetYen: preference.weeklyBudgetYen,
        promptSummary: brief,
        meals: { create: meals },
        shoppingItems: { create: shopping },
      },
      include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] }, shoppingItems: { orderBy: { sortOrder: "asc" } } },
    });
  });

  const dayTotals = totalsFor(plan.meals);
  const estimatedYen = plan.shoppingItems.reduce((sum, i) => sum + i.estimatedYen, 0);
  const warnings = checkAgainstBrief(dayTotals, dates, {
    kcal: t.targetKcal,
    proteinG: t.proteinG,
    fiberG: t.fiberG,
    saltMaxG: t.saltMaxG,
    weekdayCookMinutes: preference.weekdayCookMinutes,
  }, estimatedYen, preference.weeklyBudgetYen);

  const { meals: planMeals, shoppingItems, ...rest } = plan;
  return {
    view: { plan: rest as MealPlan, meals: planMeals, shoppingItems, dayTotals, estimatedYen },
    warnings,
  };
}

/** Recomputed totals vs the brief. Kept exported and pure so the check can
 * be re-run when a plan is read back, not only when it's generated. */
export function checkAgainstBrief(
  dayTotals: DayTotals[],
  expectedDates: string[],
  target: { kcal: number; proteinG: number; fiberG: number; saltMaxG: number; weekdayCookMinutes: number },
  estimatedYen: number,
  budgetYen: number,
): string[] {
  const warnings: string[] = [];
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
    if (weekday >= 1 && weekday <= 5 && t.prepMinutes > target.weekdayCookMinutes) {
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
  const [preference, meals] = await Promise.all([getPreference(ownerSub), getMealsForDay(ownerSub, dateKey)]);
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
