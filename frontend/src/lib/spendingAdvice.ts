import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import * as moneyPlan from "@/lib/moneyPlan";
import { monthOf, monthSummary } from "@/lib/expenses";
import type { SpendingAdvice } from "@/generated/prisma/client";

export type { SpendingAdvice };

/**
 * A weekly look at the spending, in the voice of an accountant.
 *
 * The brief is deliberately narrow: name the lines that can actually
 * come down and by how much. General advice about coffee is worth
 * nothing to someone who already knows they buy coffee — what they can't
 * see from inside the week is which three of their own transactions add
 * up to the gap.
 *
 * Everything the model is told is arithmetic done here: the budget, what
 * has gone, what's left, and the week's actual lines. It is asked to
 * choose and explain, never to add up.
 */

export interface AdviceAction {
  category: string;
  action: string;
  monthlySavingYen: number;
}

export interface AdviceView {
  weekStartDateKey: string;
  summary: string;
  actions: AdviceAction[];
  createdAt: Date;
}

/** The week the advice covers: the seven days ending on the day asked
 * about, so it is always "the week just gone". */
export function weekStartFor(dateKey: string): string {
  return shiftDateKey(dateKey, -6);
}

function toView(row: SpendingAdvice): AdviceView {
  const parsed = JSON.parse(row.actionsJson) as AdviceAction[];
  return { weekStartDateKey: row.weekStartDateKey, summary: row.summary, actions: parsed, createdAt: row.createdAt };
}

export async function getAdvice(ownerSub: string, weekStartDateKey: string): Promise<AdviceView | null> {
  const row = await prisma.spendingAdvice.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
  });
  return row ? toView(row) : null;
}

export async function listRecentAdvice(ownerSub: string, limit = 4): Promise<AdviceView[]> {
  const rows = await prisma.spendingAdvice.findMany({
    where: { ownerSub },
    orderBy: { weekStartDateKey: "desc" },
    take: limit,
  });
  return rows.map(toView);
}

const SYSTEM_PROMPT = `あなたは、この家計を担当する会計士です。1週間ぶんの支出を見て、来週から実際に減らせるところを指摘します。

守ること:
1. 一般論を書かない。「外食を減らしましょう」ではなく、渡された明細の中の具体的な行を指して、いくらをどう減らすかを書く。
2. 金額は渡された数字だけを使う。合計や差額を自分で計算し直さない（こちらで計算済みの値を渡している）。
3. 減らせる見込み額（monthlySavingYen）は、その行の実績から無理なく届く範囲にする。希望的な数字を書かない。
4. 固定費・分割払いは今月すぐには変えられない。ただし解約・乗り換え・繰上げで来月以降変わるものは、そう書く。
5. 削れない支出には触れない。食費を生活できない額まで削る提案はしない。
6. 予算内に収まっているカテゴリは、無理に削らない。収まっていると書く。
7. 3〜5件にしぼる。多いほど実行されない。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "summary": "今週の要約。2〜3文。予算に対してどうだったか、来週どこに気をつけるか。",
  "actions": [
    { "category": "食費", "action": "何をどう変えるかを具体的に。1〜2文。", "monthlySavingYen": 4000 }
  ]
}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * Writes the week's advice.
 *
 * Replaces whatever was there for the same week: asking again is asking
 * for a second opinion on the same evidence, not for a second note.
 */
export async function generateAdvice(ownerSub: string, todayKey: string): Promise<AdviceView> {
  const weekStartDateKey = weekStartFor(todayKey);
  const brief = await briefFor(ownerSub, todayKey, weekStartDateKey);
  const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 4000);
  const parsed = value as { summary?: unknown; actions?: unknown };

  const actions: AdviceAction[] = (Array.isArray(parsed.actions) ? parsed.actions : [])
    .map((raw) => {
      const a = raw as { category?: unknown; action?: unknown; monthlySavingYen?: unknown };
      return { category: str(a.category), action: str(a.action), monthlySavingYen: num(a.monthlySavingYen) };
    })
    .filter((a) => a.action);
  const summary = str(parsed.summary);
  if (!summary && actions.length === 0) throw new AiJsonError("invalidResponse", "助言の中身が空でした");

  const row = await prisma.spendingAdvice.upsert({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    create: { ownerSub, weekStartDateKey, summary, actionsJson: JSON.stringify(actions) },
    update: { summary, actionsJson: JSON.stringify(actions), createdAt: new Date() },
  });
  return toView(row);
}

/** Everything the accountant is given. Assembled here so the model is
 * never the thing doing the arithmetic. */
async function briefFor(ownerSub: string, todayKey: string, weekStartDateKey: string): Promise<string> {
  const month = monthOf(todayKey);
  const [plan, summary, week, profile] = await Promise.all([
    moneyPlan.getOrCreateMonthPlan(ownerSub, month),
    monthSummary(ownerSub, todayKey),
    prisma.expense.findMany({
      where: { ownerSub, dateKey: { gte: weekStartDateKey, lte: todayKey } },
      orderBy: [{ dateKey: "asc" }, { amountYen: "desc" }],
      select: { dateKey: true, category: true, amountYen: true, memo: true },
    }),
    moneyPlan.getProfile(ownerSub),
  ]);

  const budgetFor = new Map(plan.budgets.map((b) => [b.category, b.amountYen]));
  const daysLeft = summary.daysInMonth - summary.dayOfMonth;

  return [
    `今日: ${todayKey}（${month}の${summary.dayOfMonth}日目、残り${daysLeft}日）`,
    `手取り: ${profile.monthlyIncomeYen.toLocaleString()}円`,
    `固定費・分割払いの合計: ${plan.projection.commitmentYen.toLocaleString()}円`,
    plan.projection.commitments.map((c) => `  ${c.name} ${c.yen.toLocaleString()}円`).join("\n"),
    `貯金の積立: ${plan.projection.savingYen.toLocaleString()}円`,
    `今月の生活費（上の差引後）: ${plan.projection.discretionaryYen.toLocaleString()}円`,
    plan.projection.belowMinimum ? `※ 生活できる最低額 ${profile.minimumLivingYen.toLocaleString()}円 を下回っている` : "",
    "",
    "今月のカテゴリ別 予算 / 実績:",
    ...plan.budgets.map((b) => {
      const spent = summary.byCategory.find((c) => c.category === b.category)?.spentYen ?? 0;
      const left = b.amountYen - spent;
      return `  ${b.category}: 予算 ${b.amountYen.toLocaleString()}円 / 使用 ${spent.toLocaleString()}円 / 残り ${left.toLocaleString()}円`;
    }),
    ...summary.byCategory
      .filter((c) => !budgetFor.has(c.category))
      .map((c) => `  ${c.category}: 予算なし / 使用 ${c.spentYen.toLocaleString()}円`),
    "",
    `直近7日（${weekStartDateKey}〜${todayKey}）の明細:`,
    week.length === 0
      ? "  （記録なし）"
      : week.map((e) => `  ${e.dateKey} [${e.category}] ${e.memo || "—"} ${e.amountYen.toLocaleString()}円`).join("\n"),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function removeAdvice(ownerSub: string, weekStartDateKey: string): Promise<void> {
  const { count } = await prisma.spendingAdvice.deleteMany({ where: { ownerSub, weekStartDateKey } });
  if (count === 0) throw new ValidationError("moneyPlanNotFound", "Advice not found");
}
