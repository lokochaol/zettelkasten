import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { currentTargets } from "@/lib/health";
import { guessLocation, inventoryBrief, isLocation, listInventory } from "@/lib/inventory";
import { getPreference } from "@/lib/mealPlanning";
import type { MealChatMessage, MealKind, MealSlot, PlannedMeal, StorageLocation } from "@/generated/prisma/client";

export type { MealChatMessage };

/**
 * The conversation a week's meals are made in, and changed in.
 *
 * It starts before there are any meals: "plan next week — I cook on Monday
 * and Thursday, eating out on Friday" gets a proposal for the whole week.
 * Then the same conversation carries every change after it — a different
 * dinner on the 14th, the chicken sold out so it's pork, eggs used up.
 * What to buy follows from the settled meals and the inventory, so it isn't
 * proposed here: the purchase list is made from them afterwards
 * (src/lib/purchaseList.ts).
 *
 * A proposal is only a proposal. It's stored with the assistant's reply and
 * shown as a card; nothing in the plan or the inventory changes until it's
 * applied. Applying the first one creates the week's plan; meals land in the
 * same plan the calendar reads, so applying is what "reflects it in the
 * calendar" means.
 *
 * Stored per owner and week, so it survives a reload — and a login that
 * runs out — in the middle of the supermarket.
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
  /** What it replaces, as it was when proposed — for the card's "before".
   * Empty when the slot had nothing in it yet. */
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
 * `changeable` maps "dateKey|slot" to the current title of every slot the
 * proposal may fill: today onward, either empty ("") or holding a meal
 * still PLANNED — not one already eaten, skipped or swapped. A meal for any
 * other slot is dropped rather than applied, whatever the model said. Numbers are clamped
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

const SYSTEM_PROMPT = `あなたは管理栄養士で、この人の献立の担当です。会話しながら1週間の献立を一緒に作り、その後も日ごとの変更や買い物中の相談を受けて組み直します。

相談の例:
- 献立づくり: 「この週の献立を作って」「月曜と木曜にまとめて作る。金曜の夜は外食」「平日の朝はパンで簡単に」
- 日ごとの変更: 「14日の夕食を魚にして」「水曜は帰りが遅いので夜は温めるだけに」
- 買い物・在庫: 「鶏むね肉が売り切れで豚こまを買った」「卵を使い切った」

すること:
- 相手の話に合わせて、献立（meals）と家にある食材の変化（inventory）を提案する。買い物リストは献立と在庫から別に作るので、買う物は提案しなくてよい。
- 「空き」になっている食事は新しく埋めてよい。献立づくりを頼まれたら、空きの食事をまとめて提案する（朝・昼・夕を日ごとにすべて）。
- 変更は必要な食事だけにする。変えなくてよい食事は meals に含めない。「変更してよい食事」に挙がっていない食事は絶対に変えない。
- 在庫の変化は、相手の話から確実に分かるものだけを inventory に入れる（買った物は add、使い切った・捨てた物は remove、量が変わった物は set）。推測で在庫を消さない。
- 情報が足りなくて決められないことがあれば、meals は空にして reply で短く質問してよい。ただし、決められる範囲は提案する。
- 相談が質問だけで、何も変える必要がなければ meals・inventory は空の配列にする。
- reply は日本語で、何をどう提案したかを2〜4文で簡潔に。

献立のルール:
1. 栄養目標は1日ごとに満たす。週の平均で帳尻を合わせない。特にたんぱく質と食物繊維は毎日届かせ、食塩相当量は毎日その上限を超えない。
2. 家にある食材（在庫）を優先して使い、使い切る。同じ食材を複数の日・料理に散らして余らせない。
3. 傷みやすいもの（葉物・生魚・鶏肉）は早めの日に、日持ちするもの（根菜・冷凍・乾物）は後の日に置く。
4. 週の食費に収まる食材と量にする。
5. 台所に立つ日は指定された回数まで。その日にまとめて作り、残りの日は作り置きの温め直し（BATCH）か冷凍食品・惣菜（READY）にする。
   - まとめて作る日のCOOKの料理は、後の日のBATCH分も一緒に作る想定で分量を決め、recipeに「○食分作って冷蔵/冷凍」と書く。
   - BATCHの料理には、どの日のどの料理の作り置きかをrecipeに書く。作り置きは冷蔵3日・冷凍1週間を目安にし、それを超える日に置かない。
   - BATCHとREADYのprepMinutesは温め直しにかかる実際の時間（3〜10分）にする。
6. 冷凍食品・惣菜（READY）は指定された食数まで。栄養目標を壊さないものを選び、titleには一般的な商品の種類（例「冷凍の焼き魚」）を書く。
7. 外食や予定がある食事は、title を「外食」などにして kind を READY、栄養は一般的な見積もりにする。
8. トレーニングの日は、たんぱく質を3食に分けて確保し、トレーニング前後の食事に炭水化物を寄せる。
9. 苦手な食材は使わない。アレルギーの食材は、微量でも、出汁や調味料としても絶対に使わない。
10. 栄養価は材料と分量から計算した1食あたりの値にする。
11. recipe は材料（分量つき）と作り方を120字以内で。1週間分を出すときも最後まで出力されることを優先する。

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

slot は BREAKFAST / LUNCH / DINNER、kind は COOK（その日に作る）/ BATCH（作り置きを食べる）/ READY（冷凍食品・惣菜・外食）、location は FRIDGE（冷蔵）/ FREEZER（冷凍）/ PANTRY（常温）のいずれか。`;

const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: "朝", LUNCH: "昼", DINNER: "夕" };

export async function listMessages(ownerSub: string, weekStartDateKey: string): Promise<MealChatMessage[]> {
  return prisma.mealChatMessage.findMany({ where: { ownerSub, weekStartDateKey }, orderBy: { createdAt: "asc" } });
}

async function findPlan(ownerSub: string, weekStartDateKey: string) {
  return prisma.mealPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { meals: { orderBy: [{ dateKey: "asc" }, { slot: "asc" }] } },
  });
}

/**
 * Every slot a proposal may fill, keyed "dateKey|slot" → current title ("" if
 * empty): the week's days from today on, each slot either empty or holding a
 * meal still PLANNED.
 */
export function changeableSlots(
  weekStartDateKey: string,
  meals: Pick<PlannedMeal, "dateKey" | "slot" | "title" | "status">[],
  todayKey: string,
): Map<string, string> {
  const byKey = new Map(meals.map((m) => [`${m.dateKey}|${m.slot}`, m]));
  const out = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    const dateKey = shiftDateKey(weekStartDateKey, i);
    if (dateKey < todayKey) continue;
    for (const slot of SLOTS) {
      const meal = byKey.get(`${dateKey}|${slot}`);
      if (!meal) out.set(`${dateKey}|${slot}`, "");
      else if (meal.status === "PLANNED") out.set(`${dateKey}|${slot}`, meal.title);
    }
  }
  return out;
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
  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStartDateKey, i));
  const [plan, targetsNow, preference, stock, purchase, training, history] = await Promise.all([
    findPlan(ownerSub, weekStartDateKey),
    currentTargets(ownerSub, todayKey),
    getPreference(ownerSub),
    listInventory(ownerSub),
    prisma.purchaseList.findUnique({ where: { ownerSub }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    prisma.trainingSession.findMany({
      where: { plan: { ownerSub }, dateKey: { gte: dates[0], lte: dates[6] }, status: { not: "SKIPPED" } },
      orderBy: { dateKey: "asc" },
    }),
    prisma.mealChatMessage.findMany({ where: { ownerSub, weekStartDateKey }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS }),
  ]);
  // The targets the week is planned against: the ones the plan was made
  // with once there is one, today's until then.
  const targets = plan
    ? { kcal: plan.targetKcal, proteinG: plan.targetProteinG, fiberG: plan.targetFiberG, saltMaxG: plan.targetSaltMaxG }
    : targetsNow
      ? { kcal: targetsNow.targets.targetKcal, proteinG: targetsNow.targets.proteinG, fiberG: targetsNow.targets.fiberG, saltMaxG: targetsNow.targets.saltMaxG }
      : null;
  if (!targets) throw new ValidationError("healthProfileMissing", "Fill in the health profile first — there are no targets to plan against");

  const userMessage = await prisma.mealChatMessage.create({ data: { ownerSub, weekStartDateKey, role: "USER", content } });

  const meals = plan?.meals ?? [];
  const changeable = changeableSlots(weekStartDateKey, meals, todayKey);
  const mealLine = (m: PlannedMeal) =>
    `  ${m.dateKey} ${SLOT_LABEL[m.slot]}(${m.slot}) ${m.title} [${m.kind}] ${m.kcal}kcal P${Math.round(m.proteinG)}g`;
  const empty = [...changeable].filter(([, title]) => title === "").map(([key]) => key.replace("|", " "));
  const brief = [
    `今日: ${todayKey}`,
    `この週: ${dates[0]} 〜 ${dates[6]}`,
    "",
    "1日の栄養目標（毎日これを満たす）:",
    `  エネルギー ${targets.kcal} kcal（±100 kcal 以内） / たんぱく質 ${targets.proteinG} g 以上 / 食物繊維 ${targets.fiberG} g 以上 / 食塩 ${targets.saltMaxG} g 未満`,
    "",
    `週の食費: ${preference.weeklyBudgetYen} 円以内`,
    `台所に立つ日: 週 ${preference.cookSessionsPerWeek} 日まで`,
    `冷凍食品・惣菜（READY）: 週 ${preference.readyMadeMealsPerWeek} 食まで`,
    `まとめ調理の日の調理時間: 1日あたり合計 ${Math.max(preference.weekdayCookMinutes, 60)} 分まで / それ以外の日は1食10分以内`,
    preference.dislikes ? `苦手: ${preference.dislikes}` : "苦手: 特になし",
    preference.allergies ? `アレルギー（絶対に使わない）: ${preference.allergies}` : "アレルギー: なし",
    "",
    ...(training.length > 0 ? ["トレーニングの日:", ...training.map((s) => `  ${s.dateKey} ${s.title}（${s.minutes}分）`), ""] : []),
    "変更してよい食事（今日以降でまだ食べていないもの）:",
    ...(meals.filter((m) => changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine).length > 0
      ? meals.filter((m) => changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine)
      : ["  （なし）"]),
    "空き（まだ決まっていない食事。埋めてよい）:",
    ...(empty.length > 0 ? [`  ${empty.join(", ")}`] : ["  （なし）"]),
    "",
    "変更できない食事（食べた・抜いた・済んだ日）:",
    ...(meals.filter((m) => !changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine).length > 0
      ? meals.filter((m) => !changeable.has(`${m.dateKey}|${m.slot}`)).map(mealLine)
      : ["  （なし）"]),
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
  ].join("\n");

  let parsed: { reply: string; proposal: Proposal };
  try {
    // Room for a whole week of meals with recipes in one reply.
    const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 20000);
    parsed = parseChatReply(value, changeable);
  } catch (e) {
    await prisma.mealChatMessage.delete({ where: { id: userMessage.id } });
    throw e;
  }

  await prisma.mealChatMessage.create({
    data: {
      ownerSub,
      weekStartDateKey,
      role: "ASSISTANT",
      content: parsed.reply || "（返事が空でした）",
      proposal: isEmptyProposal(parsed.proposal) ? undefined : (parsed.proposal as unknown as Prisma.InputJsonValue),
    },
  });
  return listMessages(ownerSub, weekStartDateKey);
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
 * Applies a proposal: fills or replaces the meals and changes the stock —
 * all in one transaction, so a half-applied proposal can't exist. The
 * week's plan is created by the first one applied, with the targets and
 * constraints of that moment, the same snapshot a plan always carries.
 *
 * Re-checked at apply time, not trusted from when it was made: a meal eaten
 * in the meantime, or a day that has passed, is left alone. A proposal can
 * be applied once; one already applied or dismissed is refused.
 *
 * Returns whether the week is in Google Calendar, so the caller can rewrite
 * it — otherwise the external calendar would keep showing the meals that
 * were just replaced, and miss the ones just added.
 */
export async function applyProposal(
  ownerSub: string,
  messageId: string,
  todayKey: string,
): Promise<{ calendarNeedsUpdate: boolean }> {
  const message = await prisma.mealChatMessage.findFirst({ where: { id: messageId, ownerSub } });
  const proposal = readProposal(message?.proposal);
  if (!message || !proposal || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  }
  const weekStartDateKey = message.weekStartDateKey;
  const existing = await findPlan(ownerSub, weekStartDateKey);
  const changeable = changeableSlots(weekStartDateKey, existing?.meals ?? [], todayKey);
  const meals = proposal.meals.filter((m) => changeable.has(`${m.dateKey}|${m.slot}`));
  const calendarNeedsUpdate = (existing?.meals ?? []).some((m) => m.googleEventId) && meals.length > 0;

  let planSnapshot: Prisma.MealPlanCreateWithoutMealsInput | null = null;
  if (!existing && meals.length > 0) {
    const [targetsNow, preference] = await Promise.all([currentTargets(ownerSub, todayKey), getPreference(ownerSub)]);
    if (!targetsNow) throw new ValidationError("healthProfileMissing", "Fill in the health profile first");
    const t = targetsNow.targets;
    planSnapshot = {
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
      promptSummary: "",
    };
  }

  await prisma.$transaction(async (tx) => {
    let planId = existing?.id ?? null;
    if (!planId && planSnapshot) {
      // Upsert, not create: two proposals applied at once for a new week
      // must land in one plan, not fail on the unique week.
      planId = (
        await tx.mealPlan.upsert({
          where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
          create: planSnapshot,
          update: {},
        })
      ).id;
    }
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
      await tx.plannedMeal.upsert({
        where: { planId_dateKey_slot: { planId: planId!, dateKey: m.dateKey, slot: m.slot } },
        create: { planId: planId!, dateKey: m.dateKey, slot: m.slot, ...data },
        update: data,
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
  const message = await prisma.mealChatMessage.findFirst({ where: { id: messageId, ownerSub } });
  if (!message || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be dismissed");
  }
  await prisma.mealChatMessage.update({ where: { id: messageId }, data: { dismissedAt: new Date() } });
}
