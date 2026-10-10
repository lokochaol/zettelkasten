import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { inventoryBrief, listInventory } from "@/lib/inventory";
import type { MealSlot, PlannedMeal, ShoppingItem } from "@/generated/prisma/client";

/**
 * The list taken to the shop.
 *
 * The flow it serves: settle the meals first (generate the week, adjust it
 * by chat), then, on the way out, ask for "what do I need from today for
 * the next N days". So it's made on request, from the meals as they stand
 * at that moment and the inventory, and covers whatever days come next —
 * not the calendar week the plan happens to be stored under.
 *
 * Ticking a line works the same as before (inventory.setShoppingItemBought):
 * the items are ShoppingItem rows, just owned by the list instead of a plan.
 */

export const MAX_DAYS = 7;

/** The order a shop is walked in, roughly — and the categories the model is
 * asked to use, so the list groups the same way every time. */
export const CATEGORIES = ["野菜・果物", "肉・魚", "卵・乳製品", "豆腐・大豆製品", "主食", "冷凍食品・惣菜", "調味料・乾物", "その他"];

export interface PurchaseListView {
  id: string;
  fromDateKey: string;
  toDateKey: string;
  note: string;
  createdAt: string;
  /** The meals in these days have changed since the list was made. */
  stale: boolean;
  items: ShoppingItem[];
  estimatedYen: number;
}

const SLOT_ORDER: Record<MealSlot, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: "朝", LUNCH: "昼", DINNER: "夕" };

async function mealsBetween(ownerSub: string, fromDateKey: string, toDateKey: string): Promise<PlannedMeal[]> {
  const meals = await prisma.plannedMeal.findMany({
    where: { plan: { ownerSub }, dateKey: { gte: fromDateKey, lte: toDateKey } },
  });
  return meals.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
}

/** The meals a list stands for, as one string — compared on every read to
 * tell whether the list still matches them. Status is left out on purpose:
 * eating Saturday's breakfast doesn't make the list wrong, changing
 * Sunday's dinner does. */
export function digestOf(meals: Pick<PlannedMeal, "dateKey" | "slot" | "kind" | "title" | "recipe">[]): string {
  return meals.map((m) => `${m.dateKey}|${m.slot}|${m.kind}|${m.title}|${m.recipe}`).join("\n");
}

function toView(
  list: { id: string; fromDateKey: string; toDateKey: string; note: string; createdAt: Date; mealsDigest: string; items: ShoppingItem[] },
  currentDigest: string,
): PurchaseListView {
  return {
    id: list.id,
    fromDateKey: list.fromDateKey,
    toDateKey: list.toDateKey,
    note: list.note,
    createdAt: list.createdAt.toISOString(),
    stale: list.mealsDigest !== currentDigest,
    items: list.items,
    estimatedYen: list.items.reduce((sum, i) => sum + i.estimatedYen, 0),
  };
}

export async function getPurchaseList(ownerSub: string): Promise<PurchaseListView | null> {
  const list = await prisma.purchaseList.findUnique({ where: { ownerSub }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!list) return null;
  const meals = await mealsBetween(ownerSub, list.fromDateKey, list.toDateKey);
  return toView(list, digestOf(meals));
}

/** Done shopping: the list goes. What was ticked is already in the
 * inventory and stays there (the link is cleared, not the stock). */
export async function clearPurchaseList(ownerSub: string): Promise<void> {
  await prisma.purchaseList.deleteMany({ where: { ownerSub } });
}

const SYSTEM_PROMPT = `あなたは管理栄養士で、買い物の段取りを担当します。指定された期間の献立を作るために、店で買う必要があるものだけを買い物リストにまとめます。

守ること:
1. 家にある食材（在庫）は買わない。在庫で足りない分だけを入れる。
2. 各料理の recipe に書かれた材料と分量から必要な量を合計し、店で買う単位（1パック、1袋、1本、300g など）に丸める。同じ食材は1行にまとめる。
3. kind が BATCH の食事は作り置きを食べるだけなので、その料理の材料は買わない（元になる COOK の料理の分で買う）。元の料理が期間より前にすでに作ってある場合も買わない。
4. kind が READY の食事（冷凍食品・惣菜）は、その商品自体を1行として入れる。
5. 調味料・油・米などは、在庫に無く、かつ献立で使うものだけを入れる。
6. category は次のどれかにする: ${CATEGORIES.join(" / ")}
7. estimatedYen は日本のスーパーでの現実的な概算（税込・円）。
8. note には、買うときの注意（傷みやすいので後半の分は後で買ってもよい、など）があれば1〜2文で。無ければ空文字。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "items": [
    { "category": "肉・魚", "name": "鶏むね肉", "quantity": "2枚（約600g）", "estimatedYen": 600 }
  ],
  "note": ""
}`;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads the model's list, keeping only usable lines, grouped in shop order
 * (by category, then as the model listed them). Pure, for testing. */
export function parseListReply(value: unknown): { items: Array<Pick<ShoppingItem, "category" | "name" | "quantity" | "estimatedYen" | "sortOrder">>; note: string } {
  const raw = (value ?? {}) as { items?: unknown; note?: unknown };
  const rows = (Array.isArray(raw.items) ? raw.items : [])
    .map((r) => {
      const item = (r ?? {}) as Record<string, unknown>;
      const category = str(item.category, 40);
      return {
        category: CATEGORIES.includes(category) ? category : "その他",
        name: str(item.name, 100),
        quantity: str(item.quantity, 100),
        estimatedYen: Math.round(num(item.estimatedYen)),
      };
    })
    .filter((i) => i.name);
  const rank = (c: string) => CATEGORIES.indexOf(c);
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.category) - rank(b.r.category) || a.i - b.i);
  return { items: sorted.map(({ r }, i) => ({ ...r, sortOrder: i })), note: str(raw.note, 500) };
}

/**
 * Makes the list for `days` days starting `fromDateKey`, replacing the
 * current one. Lines already ticked on the old list are in the inventory by
 * now, so the model, which is shown the inventory, doesn't ask for them
 * again.
 */
export async function createPurchaseList(ownerSub: string, fromDateKey: string, days: number): Promise<PurchaseListView> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS || !/^\d{4}-\d{2}-\d{2}$/.test(fromDateKey)) {
    throw new ValidationError("purchaseListInvalid", "Days must be 1-7 from a valid date");
  }
  const toDateKey = shiftDateKey(fromDateKey, days - 1);
  const [allMeals, earlier, stock, preference] = await Promise.all([
    mealsBetween(ownerSub, fromDateKey, toDateKey),
    // The cooking just before the window: a BATCH meal inside it may be
    // eating something already made, which isn't to be bought again.
    prisma.plannedMeal.findMany({
      where: { plan: { ownerSub }, dateKey: { gte: shiftDateKey(fromDateKey, -3), lt: fromDateKey }, kind: "COOK" },
      orderBy: { dateKey: "asc" },
    }),
    listInventory(ownerSub),
    prisma.mealPreference.findUnique({ where: { ownerSub } }),
  ]);
  const meals = allMeals.filter((m) => m.status === "PLANNED");
  if (meals.length === 0) throw new ValidationError("purchaseListNoMeals", "No planned meals in those days");

  const mealLine = (m: PlannedMeal) => `  ${m.dateKey} ${SLOT_LABEL[m.slot]} [${m.kind}] ${m.title} — ${m.recipe}`;
  const brief = [
    `期間: ${fromDateKey} 〜 ${toDateKey}（${days}日分）`,
    preference?.allergies ? `アレルギー（絶対に買わない）: ${preference.allergies}` : "",
    "",
    "期間の献立:",
    ...meals.map(mealLine),
    "",
    "期間より前に作った料理（作り置きの元。買わない）:",
    ...(earlier.length === 0 ? ["  （なし）"] : earlier.map(mealLine)),
    "",
    "家にある食材（在庫）:",
    inventoryBrief(stock),
  ]
    .filter((line) => line !== "")
    .join("\n");

  const { value, truncated } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 8000);
  const { items, note } = parseListReply(value);
  if (items.length === 0) {
    throw new AiJsonError(truncated ? "truncated" : "invalidResponse", "買い物リストが1行もありませんでした");
  }

  const list = await prisma.$transaction(async (tx) => {
    await tx.purchaseList.deleteMany({ where: { ownerSub } });
    return tx.purchaseList.create({
      data: { ownerSub, fromDateKey, toDateKey, mealsDigest: digestOf(allMeals), note, items: { create: items } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });
  return toView(list, list.mealsDigest);
}
