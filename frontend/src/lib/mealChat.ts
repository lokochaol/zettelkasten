import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import { progressReporter, type ChatProgress } from "@/lib/chatProgress";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { currentTargets } from "@/lib/health";
import { inventoryBrief, listInventory } from "@/lib/inventory";
import { kitchenLine, kitchenWarnings } from "@/lib/kitchenTime";
import { kitchenDays } from "@/lib/kitchenSchedule";
import { getPreference } from "@/lib/mealPlanning";
import {
  applyPurchaseProposal,
  CATEGORIES,
  parsePurchaseProposal,
  type PurchaseProposal,
} from "@/lib/purchaseList";
import type { MealChatMessage, MealKind, MealSlot, PlannedMeal } from "@/generated/prisma/client";

export type { MealChatMessage };

/**
 * The conversation a week's meals are made in, and changed in.
 *
 * It starts before there are any meals: "plan next week — I cook on Monday
 * and Thursday, eating out on Friday" gets a proposal for the whole week.
 * Then the same conversation carries every change after it — a different
 * dinner on the 14th, the chicken sold out so it's pork.
 * The purchase list can be changed from here too — "put Thursday's
 * shopping on the list", "drop the leeks" — as part of the same proposal,
 * applied with the same button. It can also still be made from the button
 * under the meals (src/lib/purchaseList.ts).
 *
 * The chat reads the inventory but never changes it. Stock moves only when
 * the owner ticks something bought on the purchase list, or edits it by
 * hand: a model inferring "you must have 2 kg of rice now" from a
 * conversation put things in the fridge list that weren't in the fridge.
 *
 * A proposal is only a proposal. It's stored with the assistant's reply and
 * shown as a card; nothing in the plan changes until it's applied. Applying the first one creates the week's plan; meals land in the
 * same plan the calendar reads, so applying is what "reflects it in the
 * calendar" means.
 *
 * Stored per owner and week, so it survives a reload — and a login that
 * runs out — in the middle of the supermarket.
 */


const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const SLOTS: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER"];
const KINDS: MealKind[] = ["COOK", "BATCH", "READY"];
/** How much of the conversation goes back to the model each turn. Enough to
 * keep the thread; the plan and the stock are re-sent in full anyway. */
const HISTORY_TURNS = 12;
const MAX_MESSAGE_LENGTH = 2000;
/** Prisma's default is 5 seconds — tight for a week of writes over the
 * network to the hosted database. */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

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

export interface Proposal {
  meals: ProposedMeal[];
  /** Where the week, with these meals in it, asks more of the kitchen than the days allow. */
  kitchenWarnings?: string[];
  /** A change to the purchase list, applied with the meals. */
  purchase?: PurchaseProposal | null;
}

export function isEmptyProposal(p: Proposal): boolean {
  return p.meals.length === 0 && !p.purchase;
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
export function parseChatReply(
  value: unknown,
  changeable: Map<string, string>,
  /** Whether there's a list to edit, and today, for the purchase part. */
  purchaseCtx: { hasList: boolean; todayKey: string } = { hasList: false, todayKey: "" },
): { reply: string; proposal: Proposal } {
  const raw = (value ?? {}) as { reply?: unknown; meals?: unknown; purchase?: unknown };
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

  return { reply: str(raw.reply, 2000), proposal: { meals, purchase: parsePurchaseProposal(raw.purchase, purchaseCtx) } };
}

const SYSTEM_PROMPT = `あなたは管理栄養士で、この人の献立の担当です。会話しながら1週間の献立を一緒に作り、その後も日ごとの変更や買い物中の相談を受けて組み直します。

相談の例:
- 献立づくり: 「この週の献立を作って」「月曜と木曜にまとめて作る。金曜の夜は外食」「平日の朝はパンで簡単に」
- 日ごとの変更: 「14日の夕食を魚にして」「水曜は帰りが遅いので夜は温めるだけに」
- 買い物中: 「鶏むね肉が売り切れで豚こまを買った」（買ったものに合わせて献立を組み直す）

すること:
- 相手の話に合わせて、献立（meals）を提案する。在庫（家にある食材）は本人が自分で記録するので、在庫の変更は提案しない。
- 購入予定リスト（買い物リスト）を作る・直すように頼まれたら、purchase で提案する。頼まれていなければ purchase は null にする。
  - 新しく作る（「木曜の買い物をまとめて」など）: newList に期間（fromDateKey〜toDateKey、7日以内）を入れ、add にその期間の献立に必要な物をすべて入れる。今あるリストは置き換わる。
  - 今のリストを直す（「ネギはいらない」「キャベツを足して」「卵は2パックに」など）: newList は null にし、add（足す物）・remove（消す物の品名）・change（量を変える物の品名と量）を使う。✓の付いた買えた物は変えない。
  - 買う物の決め方: 期間の献立の recipe の材料と分量から必要量を合計し、店で買う単位に丸める。在庫にある物は入れない。BATCH の食事の材料は元の COOK の料理の分で買うので入れない。READY は商品そのものを1行にする。
  - category は次のどれか: ${CATEGORIES.join(" / ")}。estimatedYen は日本のスーパーでの税込の概算（円）。
- 「空き」になっている食事は新しく埋めてよい。献立づくりを頼まれたら、空きの食事をまとめて提案する（朝・昼・夕を日ごとにすべて）。
- 変更は必要な食事だけにする。変えなくてよい食事は meals に含めない。「変更してよい食事」に挙がっていない食事は絶対に変えない。
- 情報が足りなくて決められないことがあれば、meals は空にして reply で短く質問してよい。ただし、決められる範囲は提案する。
- 相談が質問だけで、何も変える必要がなければ meals は空の配列にする。
- reply は日本語で、何をどう提案したかを2〜4文で簡潔に。

献立のルール:
1. 栄養目標は1日ごとに満たす。週の平均で帳尻を合わせない。特にたんぱく質と食物繊維は毎日届かせ、食塩相当量は毎日その上限を超えない。
2. 家にある食材（在庫）を優先して使い、使い切る。同じ食材を複数の日・料理に散らして余らせない。
3. 傷みやすいもの（葉物・生魚・鶏肉）は早めの日に、日持ちするもの（根菜・冷凍・乾物）は後の日に置く。
4. 週の食費に収まる食材と量にする。
5. 台所に立つ日と時間は「日ごとの予定と台所」に合わせる。
   - 調理（COOK）は、台所の上限が0分の日には置かない。台所に立つ日は週の回数まで。上限の大きい日・夕食前（または朝食前）の空きが多い日を選ぶ。
   - その日の prepMinutes の合計（温め直しも含む）を、その日の台所の上限以内にする。夕食の COOK の prepMinutes は「夕食前2時間の空き」以内、朝食の COOK は「朝食前2時間の空き」以内にする。
   - 空きの少ない日（出社で帰宅が遅い・夜に学習の枠がある日など）は、BATCH か READY にして1食10分以内にする。
   - その日にまとめて作り、残りの日は作り置きの温め直し（BATCH）か冷凍食品・惣菜（READY）にする。作り置きは、空きの少ない日の前に作る。
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
  "purchase": null
}

purchase を提案するときの形（使わない項目は空の配列）:
"purchase": {
  "newList": { "fromDateKey": "YYYY-MM-DD", "toDateKey": "YYYY-MM-DD" },
  "add": [ { "category": "肉・魚", "name": "鶏もも肉", "quantity": "2枚（約600g）", "estimatedYen": 700 } ],
  "remove": [ "長ねぎ" ],
  "change": [ { "name": "卵", "quantity": "2パック" } ],
  "note": "買うときの注意があれば1文で"
}

slot は BREAKFAST / LUNCH / DINNER、kind は COOK（その日に作る）/ BATCH（作り置きを食べる）/ READY（冷凍食品・惣菜・外食）のいずれか。`;

const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: "朝", LUNCH: "昼", DINNER: "夕" };

/** A message as the screen gets it: plain values only, the proposal read
 * out of its JSON column. */
export interface MealChatMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposal: Proposal | null;
  applied: boolean;
  dismissed: boolean;
}

export function toMessageView(m: MealChatMessage): MealChatMessageView {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    proposal: (m.proposal as unknown as Proposal | null) ?? null,
    applied: m.appliedAt !== null,
    dismissed: m.dismissedAt !== null,
  };
}

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
  /** Reports where the request is and what the model has written so far
   * (src/lib/chatProgress.ts); the reply is streamed when this is given. */
  onProgress?: (p: ChatProgress) => void,
): Promise<MealChatMessage[]> {
  const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new ValidationError("mealChatInvalid", "message is empty");
  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStartDateKey, i));
  const [plan, targetsNow, preference, stock, purchase, training, history, kitchen] = await Promise.all([
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
    getPreference(ownerSub).then((p) => kitchenDays(ownerSub, dates, p)),
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
  onProgress?.({ stage: "context", reply: "", items: [] });

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
    `台所に立つ日（COOK の日）: 週 ${preference.cookSessionsPerWeek} 日まで`,
    `冷凍食品・惣菜（READY）: 週 ${preference.readyMadeMealsPerWeek} 食まで`,
    `食事の時刻: 朝 ${hhmm(preference.breakfastMinutes)} / 昼 ${hhmm(preference.lunchMinutes)} / 夕 ${hhmm(preference.dinnerMinutes)}（調理はこの時刻の前に済ませる）`,
    "",
    "日ごとの予定と台所（上限はこの人が決めた、その曜日に台所に立てる分数）:",
    ...kitchen.map((d) => `  ${kitchenLine(d)}`),
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
    const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 20000, undefined, onProgress && progressReporter(onProgress, "meals"));
    parsed = parseChatReply(value, changeable, { hasList: purchase !== null, todayKey });
    if (parsed.proposal.meals.length > 0) {
      // The week as it would be with these meals in it, checked against the days.
      const proposed = new Map(parsed.proposal.meals.map((m) => [`${m.dateKey}|${m.slot}`, m]));
      const week = [...meals.filter((m) => !proposed.has(`${m.dateKey}|${m.slot}`)), ...parsed.proposal.meals];
      parsed.proposal.kitchenWarnings = kitchenWarnings(week, kitchen);
    }
    onProgress?.({ stage: "saving", reply: parsed.reply, items: [] });
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
    purchase: p.purchase ?? null,
    kitchenWarnings: Array.isArray(p.kitchenWarnings) ? p.kitchenWarnings : [],
  };
}

/**
 * Applies a proposal: fills or replaces the meals, and changes the purchase
 * list if it proposes that — all in one transaction, so a half-applied proposal can't exist. The
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
  // Read before the transaction: the purchase part sets aside what's at home.
  const stock = proposal.purchase ? await listInventory(ownerSub) : [];

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
      kitchenMinutes: preference.kitchenMinutes as Prisma.InputJsonValue,
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
    // A whole week is 21 meals. Written as a few
    // bulk statements rather than one query per row: on the production
    // database each query is a network round trip, and one at a time a full
    // week ran past the transaction's time limit and was rolled back.
    if (meals.length > 0) {
      // Every target slot is empty or PLANNED (checked above), so clearing
      // and re-creating is a replace. The calendar event id is carried over,
      // so the next sync updates the existing event instead of adding one.
      const eventIds = new Map((existing?.meals ?? []).map((m) => [`${m.dateKey}|${m.slot}`, m.googleEventId]));
      await tx.plannedMeal.deleteMany({
        where: { planId: planId!, OR: meals.map((m) => ({ dateKey: m.dateKey, slot: m.slot })) },
      });
      await tx.plannedMeal.createMany({
        data: meals.map((m) => ({
          planId: planId!,
          dateKey: m.dateKey,
          slot: m.slot,
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
          googleEventId: eventIds.get(`${m.dateKey}|${m.slot}`) ?? null,
        })),
      });
    }

    if (proposal.purchase) await applyPurchaseProposal(tx, ownerSub, proposal.purchase, stock);

    await tx.mealChatMessage.update({ where: { id: messageId }, data: { appliedAt: new Date() } });
  }, TRANSACTION_OPTIONS);
  return { calendarNeedsUpdate };
}

export async function dismissProposal(ownerSub: string, messageId: string): Promise<void> {
  const message = await prisma.mealChatMessage.findFirst({ where: { id: messageId, ownerSub } });
  if (!message || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be dismissed");
  }
  await prisma.mealChatMessage.update({ where: { id: messageId }, data: { dismissedAt: new Date() } });
}
