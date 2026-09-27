import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { getPreference, weekStartFor } from "@/lib/mealPlanning";
import type { CoopOrder, CoopOrderItem, ShoppingItem } from "@/generated/prisma/client";

export type { CoopOrder, CoopOrderItem };

/**
 * Turning a week's shopping list into a Coop Deli order.
 *
 * Proposal only, and deliberately so: eフレンズ has no external ordering
 * API, and nothing here logs in on the owner's behalf. What it can do is
 * the part that's actually tedious — working out, a fortnight ahead, what
 * the week needs, in quantities a weekly delivery makes sense in, by the
 * day the order closes. The owner types it in.
 *
 * Names stay generic ("鶏むね肉") rather than catalogue codes. The app
 * cannot see this week's catalogue, and a made-up product number is a lie
 * that arrives as the wrong box.
 */

/**
 * The first week Coop can still supply.
 *
 * Not a fixed "two weeks out": that sounds right and is wrong about half
 * the time. The deadline is what decides it — with a week's lead and a
 * delivery that has to land before the week begins, the order for a week
 * starting Monday closes up to thirteen days earlier, so the week after
 * next can already be shut. So the weeks are walked forward until one is
 * found whose deadline hasn't passed. The current week is never a
 * candidate: it is being eaten.
 */
export function targetWeekStart(
  todayKey: string,
  shoppingWeekday: number,
  deliveryWeekday: number,
  orderLeadDays: number,
): string {
  const thisWeek = weekStartFor(todayKey, shoppingWeekday);
  for (let week = 1; week <= 8; week++) {
    const candidate = shiftDateKey(thisWeek, week * 7);
    if (deliveryDatesFor(candidate, deliveryWeekday, orderLeadDays).orderByDateKey >= todayKey) return candidate;
  }
  // Only reachable with an absurd lead time; the caller still needs a week
  // to point at, and the eighth is as good an answer as any.
  return shiftDateKey(thisWeek, 8 * 7);
}

export interface DeliveryDates {
  deliveryDateKey: string;
  orderByDateKey: string;
}

/**
 * When the van comes for a given week, and when the order closes.
 *
 * The delivery is placed on or before the week it feeds, never inside it:
 * food that arrives on Wednesday cannot be Monday's dinner. So the search
 * runs backwards from the week's first day.
 */
export function deliveryDatesFor(
  weekStartDateKey: string,
  deliveryWeekday: number,
  orderLeadDays: number,
): DeliveryDates {
  const startWeekday = new Date(`${weekStartDateKey}T00:00:00Z`).getUTCDay();
  const back = (startWeekday - deliveryWeekday + 7) % 7;
  const deliveryDateKey = shiftDateKey(weekStartDateKey, -back);
  return { deliveryDateKey, orderByDateKey: shiftDateKey(deliveryDateKey, -orderLeadDays) };
}

export interface CoopOrderView {
  order: CoopOrder;
  items: CoopOrderItem[];
  /** The delivery total — what the owner is committing to. Items marked
   * "buy locally" are excluded, because they aren't part of the order. */
  estimatedYen: number;
  /** Days left before the order closes, from the day asked about. Negative
   * once it has closed, which the UI says out loud rather than showing a
   * list that can no longer be ordered. */
  daysUntilDeadline: number;
}

function view(order: CoopOrder & { items: CoopOrderItem[] }, todayKey: string): CoopOrderView {
  const { items, ...rest } = order;
  return {
    order: rest as CoopOrder,
    items,
    estimatedYen: items.filter((i) => i.chosen && !i.localInstead).reduce((sum, i) => sum + i.estimatedYen, 0),
    daysUntilDeadline: daysBetween(todayKey, order.orderByDateKey),
  };
}

/** Whole days from one day key to another. Both are calendar days, so this
 * is subtraction on dates and never touches a clock. */
export function daysBetween(fromDateKey: string, toDateKey: string): number {
  return Math.round((Date.parse(`${toDateKey}T00:00:00Z`) - Date.parse(`${fromDateKey}T00:00:00Z`)) / 86_400_000);
}

export async function getOrder(ownerSub: string, weekStartDateKey: string, todayKey: string): Promise<CoopOrderView | null> {
  const order = await prisma.coopOrder.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  return order ? view(order, todayKey) : null;
}

export async function setItemChosen(ownerSub: string, itemId: string, chosen: boolean): Promise<void> {
  const item = await prisma.coopOrderItem.findFirst({ where: { id: itemId, order: { ownerSub } }, select: { id: true } });
  if (!item) throw new ValidationError("coopOrderNotFound", "Order item not found");
  await prisma.coopOrderItem.update({ where: { id: itemId }, data: { chosen } });
}

/* ---------- proposing ---------- */

const SYSTEM_PROMPT = `あなたは、1週間分の献立の買い物リストを、生協（コープデリ）の週1回の宅配で注文する形に組み直す担当です。

前提:
- 宅配は週に1回。注文は配達の1週間ほど前に締め切られる。
- 商品はパック単位で届く。「にんじん 1本」ではなく「にんじん 1袋（3本）」のように、実際に届く単位にまとめる。
- 商品カタログは参照できないので、商品名は一般的な食材名で書く。商品コードや固有の商品名は絶対に書かない。
- 価格はスーパーの相場からの概算でよい。

判断すること:
1. 週1回の宅配に向かないものは localInstead を true にして、理由を短く書く。具体的には、葉物野菜や豆腐のように配達日から日持ちしない生鮮品、使う日に買った方がよいもの、少量すぎて宅配の枠を使うのがもったいないもの。リストから消さずに残すこと（買う必要はあるので）。
2. 同じ食材が複数行に分かれていれば1行にまとめ、数量を合算する。
3. パック単位に切り上げた結果、献立より多く届くものは quantity にその旨を書く（例: 「1袋（3本）※献立では2本」）。
4. 常温で日持ちするもの（米・乾物・調味料・冷凍）は、宅配の得意分野なので優先して入れる。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "items": [
    { "category": "肉・魚", "name": "鶏むね肉", "quantity": "2kg（冷凍）", "estimatedYen": 1400, "localInstead": false, "reason": "" }
  ],
  "note": "注文全体についての短い補足。無ければ空文字。"
}`;

interface RawItem {
  category?: unknown;
  name?: unknown;
  quantity?: unknown;
  estimatedYen?: unknown;
  localInstead?: unknown;
  reason?: unknown;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface ProposeResult {
  view: CoopOrderView;
  /** False when no AI key is configured and the list is a plain copy of the
   * week's shopping list. The difference matters to the reader, so it's
   * carried out to the UI rather than smoothed over. */
  refined: boolean;
}

/**
 * Builds (or rebuilds) the proposed order for a week.
 *
 * The week's meal plan is the input, so there is always something concrete
 * behind the order — this never invents a week's food on its own. Without
 * an AI key the shopping list is copied across unchanged, which is less
 * useful but still true; with one, it's consolidated into delivery-sized
 * quantities and the awkward items are flagged.
 */
export async function proposeOrder(ownerSub: string, weekStartDateKey: string, todayKey: string): Promise<ProposeResult> {
  const preference = await getPreference(ownerSub);
  const plan = await prisma.mealPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { shoppingItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!plan) throw new ValidationError("coopPlanMissing", "Generate the week's plan first — there is nothing to order");
  if (plan.shoppingItems.length === 0) {
    throw new ValidationError("coopPlanMissing", "That week's plan has no shopping list");
  }

  const dates = deliveryDatesFor(weekStartDateKey, preference.coopDeliveryWeekday, preference.coopOrderLeadDays);
  let items = fallbackItems(plan.shoppingItems);
  let note = "";
  let refined = false;

  try {
    const parsed = (await askForJson(ownerSub, SYSTEM_PROMPT, briefFor(plan.shoppingItems, weekStartDateKey, dates))) as {
      items?: unknown;
      note?: unknown;
    };
    const proposed = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((raw, i) => {
        const item = raw as RawItem;
        return {
          category: str(item.category) || "その他",
          name: str(item.name),
          quantity: str(item.quantity),
          estimatedYen: Math.round(num(item.estimatedYen)),
          localInstead: item.localInstead === true,
          reason: str(item.reason),
          chosen: true,
          sortOrder: i,
        };
      })
      .filter((i) => i.name);
    if (proposed.length === 0) throw new AiJsonError("invalidResponse", "the proposal contained no items");
    items = proposed;
    note = str(parsed.note);
    refined = true;
  } catch (e) {
    // No key configured is an ordinary state for this app — the owner may
    // simply not have set one up — and the copied list is still worth
    // having. Anything else is a real failure and should be seen.
    if (!(e instanceof AiJsonError && e.code === "notConfigured")) throw e;
  }

  const order = await prisma.$transaction(async (tx) => {
    await tx.coopOrder.deleteMany({ where: { ownerSub, weekStartDateKey } });
    return tx.coopOrder.create({
      data: {
        ownerSub,
        weekStartDateKey,
        orderByDateKey: dates.orderByDateKey,
        deliveryDateKey: dates.deliveryDateKey,
        refined,
        note,
        items: { create: items },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });

  return { view: view(order, todayKey), refined };
}

function fallbackItems(shoppingItems: ShoppingItem[]) {
  return shoppingItems.map((item, i) => ({
    category: item.category,
    name: item.name,
    quantity: item.quantity,
    estimatedYen: item.estimatedYen,
    localInstead: false,
    reason: "",
    chosen: true,
    sortOrder: i,
  }));
}

function briefFor(shoppingItems: ShoppingItem[], weekStartDateKey: string, dates: DeliveryDates): string {
  return [
    `対象の週: ${weekStartDateKey} から7日間`,
    `配達日: ${dates.deliveryDateKey}（この日に届く。週が始まる前）`,
    `注文締切: ${dates.orderByDateKey}`,
    "",
    "その週の買い物リスト:",
    ...shoppingItems.map((i) => `  [${i.category}] ${i.name} ${i.quantity} 約${i.estimatedYen}円`),
  ].join("\n");
}

/**
 * The order as plain text, for pasting into eフレンズ's own memo or a
 * notes app. There is no API to submit to, so the deliverable is text the
 * owner can carry — which is a small thing that decides whether the
 * feature gets used at all.
 */
export function orderText(view: CoopOrderView): string {
  const ordering = view.items.filter((i) => i.chosen && !i.localInstead);
  const local = view.items.filter((i) => i.chosen && i.localInstead);
  const lines = [
    `コープデリ注文メモ（${view.order.deliveryDateKey} 配達 / 締切 ${view.order.orderByDateKey}）`,
    "",
    ...ordering.map((i) => `・${i.name} ${i.quantity}（約${i.estimatedYen.toLocaleString()}円）`),
    "",
    `概算合計 ${view.estimatedYen.toLocaleString()}円`,
  ];
  if (local.length > 0) {
    lines.push("", "店で買うもの:", ...local.map((i) => `・${i.name} ${i.quantity}${i.reason ? `（${i.reason}）` : ""}`));
  }
  if (view.order.note) lines.push("", view.order.note);
  return lines.join("\n");
}
