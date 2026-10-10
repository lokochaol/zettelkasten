import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import { ValidationError } from "@/lib/errors";
import { guessLocation, inventoryBrief, isLocation, listInventory } from "@/lib/inventory";
import type { MealChatMessage, MealKind, MealSlot, StorageLocation } from "@/generated/prisma/client";

export type { MealChatMessage };

/**
 * Talking the week's meals through with the planner, mid-week.
 *
 * Plans meet the shop: the chicken was sold out so it's pork, the eggs ran
 * out early, Thursday's dinner isn't going to happen. Said in a sentence,
 * that turns into edits to the plan and the inventory — so the owner says
 * it, and the planner proposes the edits. What to buy follows from those
 * two, so it isn't proposed here: the purchase list is remade from the
 * settled meals afterwards (src/lib/purchaseList.ts).
 *
 * A proposal is only a proposal. It's stored with the assistant's reply and
 * shown as a card; nothing in the plan or the inventory changes
 * until it's applied. Replacement meals land in the same plan the
 * calendar reads, so applying one is what "reflects it in the calendar"
 * means.
 *
 * The conversation is stored per plan, so it survives a reload — and a login
 * that runs out — in the middle of the supermarket.
 */

const SLOTS: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER"];
const KINDS: MealKind[] = ["COOK", "BATCH", "READY"];
/** How much of the conversation goes back to the model each turn. Enough to
 * keep the thread; the plan and the stock are re-sent in full anyway. */
const HISTORY_TURNS = 12;
const MAX_MESSAGE_LENGTH = 2000;

export interface ProposedMeal {
  dateKey: string;
  slot: MealSlot;
  title: string;
  recipe: string;
  kind: MealKind;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  saltG: number;
  prepMinutes: number;
  /** What it replaces, as it was when proposed — for the card's "before". */
  replaces: string;
}

export interface ProposedStock {
  op: "add" | "set" | "remove";
  name: string;
  quantity: string;
  location: StorageLocation;
}

export interface Proposal {
  meals: ProposedMeal[];
  inventory: ProposedStock[];
}

export function isEmptyProposal(p: Proposal): boolean {
  return p.meals.length === 0 && p.inventory.length === 0;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Turns the model's reply into a reply and a proposal that can be trusted.
 *
 * `changeable` maps "dateKey|slot" to the current title of every meal the
 * proposal may replace: today onward, and only meals still PLANNED — not one
 * already eaten, skipped or swapped. A replacement for anything else is
 * dropped rather than applied, whatever the model said. Numbers are clamped
 * non-negative, kinds and locations fall back to safe defaults.
 */
export function parseChatReply(value: unknown, changeable: Map<string, string>): { reply: string; proposal: Proposal } {
  const raw = (value ?? {}) as { reply?: unknown; meals?: unknown; inventory?: unknown; shopping?: unknown };
  const seen = new Set<string>();

  const meals: ProposedMeal[] = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    const item = (m ?? {}) as Record<string, unknown>;
    const dateKey = str(item.dateKey, 10);
    const slot = str(item.slot, 10).toUpperCase() as MealSlot;
    const key = `${dateKey}|${slot}`;
    const title = str(item.title, 100);
    if (!SLOTS.includes(slot) || !changeable.has(key) || !title || seen.has(key)) continue;
    seen.add(key);
    const kind = str(item.kind, 10).toUpperCase() as MealKind;
    meals.push({
      dateKey,
      slot,
      title,
      recipe: str(item.recipe, 400),
      kind: KINDS.includes(kind) ? kind : "COOK",
      kcal: Math.round(num(item.kcal)),
      proteinG: num(item.proteinG),
      fatG: num(item.fatG),
      carbG: num(item.carbG),
      fiberG: num(item.fiberG),
      saltG: num(item.saltG),
      prepMinutes: Math.round(num(item.prepMinutes)),
      replaces: changeable.get(key) ?? "",
    });
  }
  meals.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));

  const inventory: ProposedStock[] = [];
  for (const s of Array.isArray(raw.inventory) ? raw.inventory : []) {
    const item = (s ?? {}) as Record<string, unknown>;
    const op = str(item.op, 10);
    const name = str(item.name, 100);
    if ((op !== "add" && op !== "set" && op !== "remove") || !name) continue;
    const quantity = str(item.quantity, 100);
    inventory.push({
      op,
      name,
      quantity,
      location: isLocation(item.location) ? item.location : guessLocation("", name, quantity),
    });
  }

  return { reply: str(raw.reply, 2000), proposal: { meals, inventory } };
}

const SYSTEM_PROMPT = `あなたは管理栄養士で、この人の今週の献立の担当です。買い物中や調理の前後に相談を受け、必要なら残りの献立を組み直します。

相談の例: 「鶏むね肉が売り切れで豚こまを買った」「卵を使い切った」「木曜の夜は外食になった」「この料理は作る気が起きない」

すること:
- 相手の話に合わせて、残りの献立の差し替えと、家にある食材（在庫）の変化を提案する。買い物リストはこの後に献立と在庫から作り直されるので、買い足しは提案しなくてよい。
- 差し替えは必要な食事だけにする。変えなくてよい食事は meals に含めない。「変更してよい食事」に挙がっていない食事は絶対に変えない。
- 差し替えた日も1日の栄養目標を満たすようにする（特にたんぱく質）。家にある食材を優先して使う。
- 在庫の変化は、相手の話から確実に分かるものだけを inventory に入れる（買った物は add、使い切った・捨てた物は remove、量が変わった物は set）。推測で在庫を消さない。
- 相談が質問だけで、何も変える必要がなければ meals・inventory は空の配列にする。
- reply は日本語で、何をどう変える提案かを2〜4文で簡潔に。変える必要がないならその理由を短く。
- 苦手な食材は使わない。アレルギーの食材は絶対に使わない。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "reply": "相手への返事",
  "meals": [
    { "dateKey": "YYYY-MM-DD", "slot": "DINNER", "kind": "COOK", "title": "料理名", "recipe": "材料（分量つき）と作り方。120字以内。", "kcal": 520, "proteinG": 32, "fatG": 15, "carbG": 55, "fiberG": 6, "saltG": 1.8, "prepMinutes": 20 }
  ],
  "inventory": [
    { "op": "add", "name": "豚こま切れ肉", "quantity": "300g", "location": "FRIDGE" }
  ]
}

slot は BREAKFAST / LUNCH / DINNER、kind は COOK / BATCH / READY、location は FRIDGE（冷蔵）/ FREEZER（冷凍）/ PANTRY（常温）のいずれか。`;

const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: "朝", LUNCH: "昼", DINNER: "夕" };

export async function listMessages(ownerSub: string, planId: string): Promise<MealChatMessage[]> {
  return prisma.mealChatMessage.findMany({
    where: { planId, plan: { ownerSub } },
    orderBy: { createdAt: "asc" },
  });
}

async function requirePlan(ownerSub: string, weekStartDateKey: string) {
  const plan = await prisma.mealPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] } },
  });
  if (!plan) throw new ValidationError("mealPlanNotFound", "There is no plan for that week");
  return plan;
}

/** Every meal a proposal may replace, keyed "dateKey|slot" → current title. */
function changeableMeals(meals: { dateKey: string; slot: MealSlot; title: string; status: string }[], todayKey: string) {
  return new Map(
    meals.filter((m) => m.dateKey >= todayKey && m.status === "PLANNED").map((m) => [`${m.dateKey}|${m.slot}`, m.title]),
  );
}

/**
 * Sends one message and stores both it and the planner's reply. The reply's
 * proposal (if it proposes anything) is stored with it, unapplied.
 *
 * If the model can't be reached the owner's message is taken back out, so
 * the conversation doesn't fill with questions that never got answers — the
 * screen keeps the text in the box to send again. AiJsonError propagates.
 */
export async function sendMessage(
  ownerSub: string,
  weekStartDateKey: string,
  text: string,
  todayKey: string,
): Promise<MealChatMessage[]> {
  const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new ValidationError("mealChatInvalid", "message is empty");
  const plan = await requirePlan(ownerSub, weekStartDateKey);
  const [preference, stock, purchase, history] = await Promise.all([
    prisma.mealPreference.findUnique({ where: { ownerSub } }),
    listInventory(ownerSub),
    prisma.purchaseList.findUnique({ where: { ownerSub }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    prisma.mealChatMessage.findMany({ where: { planId: plan.id }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS }),
  ]);

  const userMessage = await prisma.mealChatMessage.create({ data: { planId: plan.id, role: "USER", content } });

  const changeable = changeableMeals(plan.meals, todayKey);
  const mealLine = (m: (typeof plan.meals)[number]) =>
    `  ${m.dateKey} ${SLOT_LABEL[m.slot]}(${m.slot}) ${m.title} [${m.kind}] ${m.kcal}kcal P${Math.round(m.proteinG)}g`;
  const brief = [
    `今日: ${todayKey}`,
    `この週: ${plan.weekStartDateKey} から7日間`,
    "",
    "1日の栄養目標:",
    `  エネルギー ${plan.targetKcal} kcal / たんぱく質 ${plan.targetProteinG} g 以上 / 食物繊維 ${plan.targetFiberG} g 以上 / 食塩 ${plan.targetSaltMaxG} g 未満`,
    `週の食費: ${plan.budgetYen} 円`,
    preference?.dislikes ? `苦手: ${preference.dislikes}` : "",
    preference?.allergies ? `アレルギー（絶対に使わない）: ${preference.allergies}` : "",
    "",
    "変更してよい食事（今日以降でまだ食べていないもの）:",
    ...(changeable.size === 0
      ? ["  （なし）"]
      : plan.meals.filter((m) => changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine)),
    "",
    "変更できない食事（食べた・抜いた・済んだ日）:",
    ...plan.meals.filter((m) => !changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine),
    "",
    "家にある食材（在庫）:",
    inventoryBrief(stock),
    "",
    ...(purchase
      ? [
          `購入予定リスト（${purchase.fromDateKey}〜${purchase.toDateKey}の分。✓は買えたもの）:`,
          ...purchase.items.map((i) => `  ${i.checked ? "✓" : "□"} ${i.name} ${i.quantity}`),
        ]
      : ["購入予定リスト: まだ作っていない"]),
    "",
    "これまでの会話:",
    ...(history.length === 0
      ? ["  （なし）"]
      : [...history].reverse().map((m) => `  ${m.role === "USER" ? "相手" : "あなた"}: ${m.content}`)),
    "",
    `相手の新しいメッセージ: ${content}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  let parsed: { reply: string; proposal: Proposal };
  try {
    const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 12000);
    parsed = parseChatReply(value, changeable);
  } catch (e) {
    await prisma.mealChatMessage.delete({ where: { id: userMessage.id } });
    throw e;
  }

  await prisma.mealChatMessage.create({
    data: {
      planId: plan.id,
      role: "ASSISTANT",
      content: parsed.reply || "（返事が空でした）",
      proposal: isEmptyProposal(parsed.proposal) ? undefined : (parsed.proposal as unknown as PrismaTypes.InputJsonValue),
    },
  });
  return listMessages(ownerSub, plan.id);
}

function readProposal(value: unknown): Proposal | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<Proposal>;
  return {
    meals: Array.isArray(p.meals) ? p.meals : [],
    inventory: Array.isArray(p.inventory) ? p.inventory : [],
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Applies a proposal: replaces the meals and changes the stock — all in one
 * transaction, so a half-applied proposal can't exist.
 *
 * Re-checked at apply time, not trusted from when it was made: a meal eaten
 * in the meantime, or a day that has passed, is left alone. A proposal can
 * be applied once; one already applied or dismissed is refused.
 *
 * Returns whether any replaced meal had been written to Google Calendar, so
 * the caller can rewrite those events — otherwise the external calendar
 * would keep showing the meals that were just replaced.
 */
export async function applyProposal(
  ownerSub: string,
  messageId: string,
  todayKey: string,
): Promise<{ calendarNeedsUpdate: boolean }> {
  const message = await prisma.mealChatMessage.findFirst({
    where: { id: messageId, plan: { ownerSub } },
    include: { plan: { include: { meals: true } } },
  });
  const proposal = readProposal(message?.proposal);
  if (!message || !proposal || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  }
  const changeable = changeableMeals(message.plan.meals, todayKey);
  const meals = proposal.meals.filter((m) => changeable.has(`${m.dateKey}|${m.slot}`));
  const replacedKeys = new Set(meals.map((m) => `${m.dateKey}|${m.slot}`));
  const calendarNeedsUpdate = message.plan.meals.some(
    (m) => m.googleEventId && replacedKeys.has(`${m.dateKey}|${m.slot}`),
  );

  await prisma.$transaction(async (tx) => {
    for (const m of meals) {
      const data = {
        title: m.title,
        recipe: m.recipe,
        kind: m.kind,
        kcal: m.kcal,
        proteinG: m.proteinG,
        fatG: m.fatG,
        carbG: m.carbG,
        fiberG: m.fiberG,
        saltG: m.saltG,
        prepMinutes: m.prepMinutes,
        status: "PLANNED" as const,
        replacementNote: "",
      };
      await tx.plannedMeal.update({
        where: { planId_dateKey_slot: { planId: message.planId, dateKey: m.dateKey, slot: m.slot } },
        data,
      });
    }

    if (proposal.inventory.length > 0) {
      const stock = await tx.inventoryItem.findMany({ where: { ownerSub } });
      for (const s of proposal.inventory) {
        const matches = stock.filter((i) => sameName(i.name, s.name));
        if (s.op === "remove") {
          if (matches.length > 0) await tx.inventoryItem.deleteMany({ where: { id: { in: matches.map((i) => i.id) } } });
        } else if (s.op === "set" && matches.length > 0) {
          await tx.inventoryItem.update({ where: { id: matches[0].id }, data: { quantity: s.quantity, location: s.location } });
        } else {
          await tx.inventoryItem.create({ data: { ownerSub, name: s.name, quantity: s.quantity, location: s.location } });
        }
      }
    }

    await tx.mealChatMessage.update({ where: { id: messageId }, data: { appliedAt: new Date() } });
  });
  return { calendarNeedsUpdate };
}

export async function dismissProposal(ownerSub: string, messageId: string): Promise<void> {
  const message = await prisma.mealChatMessage.findFirst({ where: { id: messageId, plan: { ownerSub } } });
  if (!message || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be dismissed");
  }
  await prisma.mealChatMessage.update({ where: { id: messageId }, data: { dismissedAt: new Date() } });
}
