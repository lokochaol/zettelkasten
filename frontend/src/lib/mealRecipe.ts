import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { getPreference } from "@/lib/mealPlanning";
import { cleanRecipeUrl, recipeSearchLinks, toRecipeDetail, type RecipeDetail } from "@/lib/mealRecipeText";
import type { MealKind, MealSlot, MealStatus, PlannedMeal } from "@/generated/prisma/client";

/**
 * The recipe a meal is cooked from.
 *
 * The plan carries one short line per meal — enough to plan and shop with,
 * not enough to stand at the stove with. So when the owner opens a meal to
 * cook it, the model writes the full recipe for that meal on request:
 * ingredients for the portions actually being made (tonight plus the
 * batch meals that come out of the same pot), numbered steps, and how to
 * keep the rest. Stored on the meal, so it's written once and read in the
 * kitchen without waiting.
 *
 * The owner can also pin a recipe page of their own, and search links are
 * offered for when they'd rather follow someone else's — links to a search,
 * never a recipe URL the model made up.
 */

export interface MealRef {
  id: string;
  dateKey: string;
  slot: MealSlot;
  title: string;
  kind: MealKind;
}

export interface RecipeView {
  id: string;
  dateKey: string;
  slot: MealSlot;
  kind: MealKind;
  status: MealStatus;
  title: string;
  /** The plan's short line. */
  summary: string;
  prepMinutes: number;
  kcal: number;
  detail: RecipeDetail | null;
  recipeUrl: string;
  /** For a batch meal, the dish it was cooked as — where the real recipe is. */
  source: MealRef | null;
  /** For a cooked dish, the later meals eaten out of the same pot. */
  batches: MealRef[];
  searchLinks: { label: string; url: string }[];
}

export type { RecipeDetail };

const ref = (m: PlannedMeal): MealRef => ({ id: m.id, dateKey: m.dateKey, slot: m.slot, title: m.title, kind: m.kind });

const SLOT_ORDER: Record<MealSlot, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
const order = (a: PlannedMeal, b: PlannedMeal) => a.dateKey.localeCompare(b.dateKey) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];

/** The core of a dish's name, for matching "鶏むね肉の照り焼き（作り置き）" to "鶏むね肉の照り焼き". */
function core(title: string): string {
  return title
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/作り置き|残り|温め直し|リメイク|の?再加熱/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Which cooked dish a batch meal comes out of, and which batch meals a
 * cooked dish feeds. The planner writes the link into the batch meal's
 * short line ("月曜夕食の○○の作り置き"), so a cooked dish counts as the
 * source when its name is in the batch meal's line or title. The latest
 * such dish cooked before the batch meal wins.
 */
export function linkBatches(meals: PlannedMeal[]): Map<string, string> {
  const sorted = [...meals].sort(order);
  const sourceOf = new Map<string, string>();
  for (const [i, m] of sorted.entries()) {
    if (m.kind !== "BATCH") continue;
    const text = `${m.title} ${m.recipe}`.replace(/\s+/g, "");
    const own = core(m.title);
    for (let j = i - 1; j >= 0; j--) {
      const c = sorted[j];
      if (c.kind !== "COOK") continue;
      const name = core(c.title);
      if (name.length >= 2 && (text.includes(name) || (own.length >= 2 && (name.includes(own) || own.includes(name))))) {
        sourceOf.set(m.id, c.id);
        break;
      }
    }
  }
  return sourceOf;
}

async function mealWithNeighbours(ownerSub: string, mealId: string) {
  const meal = await prisma.plannedMeal.findFirst({ where: { id: mealId, plan: { ownerSub } }, include: { plan: true } });
  if (!meal) throw new ValidationError("mealNotFound", "No such meal");
  // A batch can be eaten in the week after it was cooked, so read across
  // the neighbouring weeks too.
  const around = await prisma.plannedMeal.findMany({
    where: {
      plan: { ownerSub },
      dateKey: { gte: shiftDateKey(meal.dateKey, -7), lte: shiftDateKey(meal.dateKey, 7) },
    },
  });
  const sourceOf = linkBatches(around);
  const sourceId = sourceOf.get(meal.id);
  const source = sourceId ? (around.find((m) => m.id === sourceId) ?? null) : null;
  const batches = around.filter((m) => sourceOf.get(m.id) === meal.id).sort(order);
  return { meal, source, batches };
}

export async function getRecipe(ownerSub: string, mealId: string, locale: "ja" | "en" = "ja"): Promise<RecipeView> {
  const { meal, source, batches } = await mealWithNeighbours(ownerSub, mealId);
  return {
    id: meal.id,
    dateKey: meal.dateKey,
    slot: meal.slot,
    kind: meal.kind,
    status: meal.status,
    title: meal.title,
    summary: meal.recipe,
    prepMinutes: meal.prepMinutes,
    kcal: meal.kcal,
    detail: toRecipeDetail(meal.recipeDetail),
    recipeUrl: meal.recipeUrl,
    source: source ? ref(source) : null,
    batches: batches.map(ref),
    searchLinks: recipeSearchLinks(source && meal.kind === "BATCH" ? source.title : meal.title, locale),
  };
}

export async function setRecipeUrl(ownerSub: string, mealId: string, url: string): Promise<void> {
  const clean = cleanRecipeUrl(url);
  const { count } = await prisma.plannedMeal.updateMany({ where: { id: mealId, plan: { ownerSub } }, data: { recipeUrl: clean } });
  if (count === 0) throw new ValidationError("mealNotFound", "No such meal");
}

const SLOT_JA: Record<MealSlot, string> = { BREAKFAST: "朝食", LUNCH: "昼食", DINNER: "夕食" };

const SYSTEM_PROMPT = `あなたは家庭料理のレシピを書く管理栄養士です。献立の1品について、台所でそのまま見ながら作れるレシピを書きます。

ルール:
1. 献立の短いメモ（材料と作り方の要約）と栄養値に沿う。料理を別の物に変えない。メモにある材料・分量を基準にする。
2. 材料は「今回作る分量」で書く。今回の調理で後の作り置き（BATCH）の分も作る場合は、その食数を合わせた量にし、servings に「○食分（今回1食・残り○食は冷蔵/冷凍）」のように書く。
3. 作る物が作り置きの温め直し（BATCH）なら、温め方・盛り付け・足すと良い物を steps に書く。材料は温める物と足す物だけ。
4. 出来合い（READY）なら、買う物と、手を加えるなら簡単な一手間を書く。
5. 調理時間は指定の分数に収まる手順にする。並行できる作業は「〜している間に」と書く。
6. 分量は家庭の計量（g、大さじ・小さじ、個、本、枚）。火加減と時間を具体的に（中火で3分など）。
7. アレルギーの食材は使わない。苦手な物は避ける。
8. storage には残りの保存方法と日持ち、温め直し方を書く。残りが出ないなら空文字。
9. 実在するレシピサイトのURLは書かない。

出力はJSONのみ:
{ "servings": "何食分か", "ingredients": [{ "name": "鶏むね肉", "amount": "300g" }], "steps": ["手順1", "手順2"], "tips": ["コツ"], "storage": "保存と温め直し" }`;

/** Writes (or rewrites) the full recipe for one meal and stores it. */
export async function writeRecipe(ownerSub: string, mealId: string, request = ""): Promise<RecipeDetail> {
  const { meal, source, batches } = await mealWithNeighbours(ownerSub, mealId);
  const preference = await getPreference(ownerSub);
  const line = (m: PlannedMeal) => `${m.dateKey} ${SLOT_JA[m.slot]} ${m.title}（${m.kind}）: ${m.recipe}`;
  const brief = [
    `作る料理: ${meal.dateKey} ${SLOT_JA[meal.slot]} 「${meal.title}」 種類 ${meal.kind}`,
    `献立のメモ: ${meal.recipe || "（なし）"}`,
    `1食分の栄養: ${meal.kcal} kcal / たんぱく質 ${meal.proteinG}g / 脂質 ${meal.fatG}g / 炭水化物 ${meal.carbG}g / 食物繊維 ${meal.fiberG}g / 塩分 ${meal.saltG}g`,
    `調理時間の目安: ${meal.prepMinutes}分`,
    `食べる人数: 1人（1食＝1人分）`,
    batches.length > 0
      ? `この調理から作り置きで食べる後の食事（${batches.length}食）:\n${batches.map((b) => `- ${line(b)}`).join("\n")}`
      : "この調理から作り置きで食べる後の食事: なし",
    source ? `元の料理（この食事はこれの作り置き）:\n- ${line(source)}` : "",
    `アレルギー: ${preference.allergies || "なし"}`,
    `苦手な物: ${preference.dislikes || "なし"}`,
    request.trim() ? `相手からの希望: ${request.trim().slice(0, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 6000);
  const detail = toRecipeDetail(value);
  if (!detail) throw new ValidationError("mealRecipeEmpty", "The recipe came back empty");
  await prisma.plannedMeal.update({ where: { id: meal.id }, data: { recipeDetail: detail as unknown as Prisma.InputJsonValue } });
  return detail;
}
