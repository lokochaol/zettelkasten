import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { localTimeUtc, shiftDateKey } from "@/lib/dateKey";
import * as googleCalendar from "@/lib/googleCalendar";
import { currentTargets } from "@/lib/health";
import { ValidationError } from "@/lib/errors";
import { inventoryBrief, listInventory } from "@/lib/inventory";
import type { MealKind, MealPlan, MealPreference, MealSlot, MealStatus, PlannedMeal, ShoppingItem } from "@/generated/prisma/client";

export type { MealKind, MealPreference, MealStatus, PlannedMeal, ShoppingItem };

const SLOTS: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER"];
const KINDS: MealKind[] = ["COOK", "BATCH", "READY"];
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

/* ---------- generation ---------- */

const SYSTEM_PROMPT = `あなたは管理栄養士です。1週間分の献立（朝・昼・夕 × 7日）と、それを作るための買い物リストを設計します。

守ること:
1. 栄養目標は1日ごとに満たす。週の平均で帳尻を合わせるのではなく、毎日がバランスの取れた1日になるようにする。特にたんぱく質と食物繊維は毎日届かせ、食塩相当量は毎日その上限を超えない。
2. 買い物は週に1回だけ。7日分すべての食材が、その1回で買える内容であること。
3. 使い切る。同じ食材を複数の日・複数の料理に散らし、中途半端に余らないように数量を決める。
4. 傷みやすいもの（葉物野菜・生魚・鶏肉）は週の前半に、日持ちするもの（根菜・冷凍・乾物）は後半に配置する。
5. 予算を超えない。買い物リストの概算金額の合計が、指定された週予算以内に収まること。
6. 台所に立つ日を指定された回数までにする。これは1日あたりの調理時間の上限より優先度が高い。毎日15分ずつ作るのではなく、指定された日にまとめて作り、残りの日は作り置きの温め直し（BATCH）か冷凍食品・惣菜（READY）にする。
   - まとめて作る日は buying/調理に時間をかけてよい。その日のCOOKの料理は、その日食べる分だけでなく、後の日のBATCH分も一緒に作る想定で分量を決め、recipeに「○食分作って冷蔵/冷凍」と書く。
   - BATCHの料理には、どの日のどの料理の作り置きかをrecipeに書く。COOK側とBATCH側で食い違わないようにする。
   - BATCHとREADYのprepMinutesは温め直しにかかる実際の時間（3〜10分程度）にする。
   - 作り置きは冷蔵で3日、冷凍で1週間を目安にする。それを超える日に置かない。
7. 冷凍食品・惣菜（READY）は指定された食数まで使ってよい。使う場合は、栄養目標を壊さないもの（たんぱく質が取れる・食塩が多すぎない）を選び、titleには一般的な商品の種類（例「冷凍の焼き魚」「冷凍うどん」）を書く。買い物リストにも入れる。
8. 苦手な食材は使わない。アレルギーの食材は、微量でも、出汁や調味料としても絶対に使わない。
9. 日本の家庭で普通に手に入る食材と、現実的な価格にする。
10. 栄養価は1食あたりの実際の量に基づいて見積もる。適当な丸め値ではなく、材料から計算した値にすること。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "meals": [
        {
          "slot": "BREAKFAST",
          "kind": "COOK",
          "title": "料理名",
          "recipe": "材料（分量つき）と作り方。120字以内で簡潔に。作り置きを使う場合はその旨も。",
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

kindは COOK（その日に作る）/ BATCH（作り置きを食べる）/ READY（冷凍食品・惣菜）のいずれか。

daysは7日分、各日のmealsはBREAKFAST・LUNCH・DINNERの3つを必ず含めること。

recipeは1食120字以内。7日×3食の全体が出力の上限に収まらないと、献立として読み取れずに失敗する。文章の長さより、7日分が最後まで出力されることを優先すること。`;

interface RawMeal {
  slot?: unknown;
  kind?: unknown;
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
  const shoppingDay = shoppingDayFor(weekStartDateKey, preference.shoppingWeekday);
  const daysBefore = Math.round(
    (Date.parse(`${weekStartDateKey}T00:00:00Z`) - Date.parse(`${shoppingDay}T00:00:00Z`)) / 86_400_000,
  );

  const composition = targetsNow.composition;
  const stock = await listInventory(ownerSub);
  const brief = [
    `対象の7日間: ${dates.join(", ")}`,
    `買い物日: ${shoppingDay}（この日に1回だけ買い物をする）`,
    ...(shoppingDay !== dates[0]
      ? [`  ※ 買い物は週が始まる${daysBefore}日前です。傷みやすいものは、買った日から数えて何日もつかで配置してください。`]
      : []),
    "",
    ...(composition && composition.current.leanMassKg !== null
      ? [
          "",
          "体組成（体組成計の直近7日平均）:",
          `  体重 ${composition.current.weightKg?.toFixed(1)} kg / 体脂肪率 ${composition.current.bodyFatPercent?.toFixed(1)}% / 除脂肪量 ${composition.current.leanMassKg.toFixed(1)} kg`,
          composition.targetBodyFatPercent !== null
            ? `  目標の体脂肪率 ${composition.targetBodyFatPercent}%（${
                composition.plan?.direction === "lose_fat"
                  ? "脂肪を減らす局面"
                  : composition.plan?.direction === "gain_lean"
                    ? "除脂肪量を増やす局面"
                    : "維持する局面"
              }）`
            : "",
          "  たんぱく質の目標は除脂肪量から計算しています。筋肉を保つことが最優先で、カロリーを削るために下げてよい項目ではありません。",
        ].filter((line) => line !== "")
      : []),
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
    `台所に立つ日: 週 ${preference.cookSessionsPerWeek} 日まで（この日以外はCOOKの料理を置かない）`,
    `  → ${dates[0]}（週の初日）を1回目のまとめ調理の日にする`,
    `冷凍食品・惣菜（READY）: 週 ${preference.readyMadeMealsPerWeek} 食まで`,
    `まとめ調理をしない日の調理時間: 1食あたり10分以内（温め直しのみ）`,
    `まとめ調理の日の調理時間: 1日あたり合計 ${Math.max(preference.weekdayCookMinutes, 60)} 分まで`,
    preference.dislikes ? `苦手・避けたいもの: ${preference.dislikes}` : "苦手な食材: 特になし",
    preference.allergies ? `アレルギー（絶対に使わない）: ${preference.allergies}` : "アレルギー: なし",
    "",
    // What's already at home, so the week uses it up before buying more of
    // the same — and the shopping list doesn't ask for what's in the fridge.
    "家にある食材（冷蔵庫在庫。まずこれを使い、買い物リストには入れない）:",
    inventoryBrief(stock),
  ].join("\n");

  const { value, truncated } = await askForJson(ownerSub, SYSTEM_PROMPT, brief);
  const parsed = value as { days?: unknown; shopping?: unknown };

  // A regenerated week starts unlogged: what was eaten belonged to the
  // meals that were replaced, not to these.
  const meals: Array<Omit<PlannedMeal, "id" | "planId" | "googleEventId" | "status" | "replacementNote">> = [];
  const days = Array.isArray(parsed.days) ? parsed.days : [];
  // Why rows were thrown away, kept so a failure can say what happened.
  // "Couldn't read the reply" twice in a row with no further detail is not
  // something anyone can act on.
  const rejected = { dates: new Set<string>(), slots: new Set<string>(), untitled: 0, mealsSeen: 0 };
  for (const rawDay of days) {
    const day = rawDay as { date?: unknown; meals?: unknown };
    const dateKey = str(day.date);
    if (!dates.includes(dateKey)) {
      rejected.dates.add(dateKey || "(空)");
      continue; // a date the model invented — never silently re-homed
    }
    for (const rawMeal of Array.isArray(day.meals) ? day.meals : []) {
      rejected.mealsSeen++;
      const m = rawMeal as RawMeal;
      const slot = str(m.slot).toUpperCase() as MealSlot;
      if (!SLOTS.includes(slot)) {
        rejected.slots.add(str(m.slot) || "(空)");
        continue;
      }
      const title = str(m.title);
      if (!title) {
        rejected.untitled++;
        continue;
      }
      const rawKind = str(m.kind).toUpperCase() as MealKind;
      meals.push({
        dateKey,
        slot,
        // An unlabelled meal counts as cooked — the pessimistic reading,
        // so a model that omits the field can't quietly under-report how
        // many evenings this plan actually costs.
        kind: KINDS.includes(rawKind) ? rawKind : "COOK",
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
  if (meals.length === 0) {
    const why = [
      `日=${days.length}`,
      `食事=${rejected.mealsSeen}`,
      rejected.dates.size > 0 ? `対象外の日付=${[...rejected.dates].slice(0, 3).join("/")}（対象は ${dates[0]}〜${dates[6]}）` : null,
      rejected.slots.size > 0 ? `不明なslot=${[...rejected.slots].slice(0, 3).join("/")}` : null,
      rejected.untitled > 0 ? `料理名なし=${rejected.untitled}` : null,
      truncated ? "返答が途中で切れた" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new AiJsonError(truncated ? "truncated" : "invalidResponse", `使える献立が1つもありませんでした（${why}）`);
  }

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
        targetSaltMaxG: t.saltMaxG,
        cookSessionsPerWeek: preference.cookSessionsPerWeek,
        readyMadeMealsPerWeek: preference.readyMadeMealsPerWeek,
        weekdayCookMinutes: preference.weekdayCookMinutes,
        budgetYen: preference.weeklyBudgetYen,
        promptSummary: brief,
        meals: { create: meals },
        shoppingItems: { create: shopping },
      },
      include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] }, shoppingItems: { orderBy: { sortOrder: "asc" } } },
    });
  });

  const { meals: planMeals, shoppingItems, ...rest } = plan;
  const view = buildView(rest as MealPlan, planMeals, shoppingItems);
  const warnings = [...view.warnings];
  // A cut-off reply is reported, never smoothed over: the days that did
  // arrive are usable, and the ones that didn't are already named above by
  // checkAgainstBrief. Saying why they're missing turns a puzzling gap
  // into an instruction — regenerate, or shorten the brief.
  if (truncated) warnings.unshift("AIの返答が長さの上限で途中で切れたため、一部が入っていません。もう一度作り直すと揃うことがあります。");
  if (shoppingItems.length === 0) warnings.push("買い物リストが入っていません（返答が途中で切れた可能性があります）。");

  return { view: { ...view, warnings }, warnings };
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
