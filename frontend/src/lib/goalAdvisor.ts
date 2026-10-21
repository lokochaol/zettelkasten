import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import type { ChatProgress, ProgressItem } from "@/lib/chatProgress";
import { partialString } from "@/lib/chatProgress";
import { ValidationError } from "@/lib/errors";
import { addChange, EVENT_KINDS, getPlanOverview, observe, PLAN_DATE_KEY, PLAN_TIME, type PlanOverview } from "@/lib/goalPlan";

/**
 * The goal advisor: a conversation about the plan that ends in concrete
 * changes to it — a phase moved, a cycle target narrowed, the standard
 * Wednesday rearranged, a question to check by a date.
 *
 * Same shape as the meal planner and the trainer: the model proposes, this
 * file checks every proposed change against what exists (it refers to
 * things by short refs — G1, P3, S7 — that are resolved to real rows here),
 * the owner sees each change spelled out, and only "反映する" writes them,
 * all at once, with a line in the change log for each.
 *
 * The same conversation is where a plan is made in the first place: the
 * model interviews (vision, where things stand, constraints, each area,
 * the first 12 weeks, the week's hours) and, once there's enough, writes
 * the plan out whole as a document like the owner's roadmap. That document
 * is applied by reading it into the plan (goalPlanImport) — as a rewrite of
 * the whole plan or merged in — and kept as a version of the 計画書.
 */

/** Enough of the conversation for a planning interview to keep its thread. */
const HISTORY_TURNS = 40;
const HISTORY_CHARS = 1500;
/** Long enough for a pasted page of notes or an existing plan. */
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_DOCUMENT_CHARS = 80_000;
/** The current 計画書 as the model reads it. */
const DOCUMENT_CONTEXT_CHARS = 40_000;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

export type OpType =
  | "goal.update"
  | "goal.add"
  | "phase.add"
  | "phase.update"
  | "phase.remove"
  | "outcome.update"
  | "outcome.add"
  | "slots.replace"
  | "event.add"
  | "event.update"
  | "event.remove"
  | "check.add"
  | "check.update"
  | "task.add"
  | "task.update"
  | "experiment.add";

/** A change as checked and resolved: real ids, clean values, and the line
 * that says what it does. */
export interface ResolvedOp {
  type: OpType;
  targetId: string | null;
  data: Record<string, unknown>;
  /** What it is now ("" for something new). */
  before: string;
  /** What it becomes. */
  after: string;
}

export interface AdvisorProposal {
  reason: string;
  ops: ResolvedOp[];
  /**
   * The whole plan written out as a document (計画書) — when the plan is
   * being made from scratch or rewritten as a whole. Applied through the
   * document import (goalPlanImport), previewed first; not through ops.
   */
  document?: string;
}

export interface AdvisorMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposal: AdvisorProposal | null;
  applied: boolean;
  dismissed: boolean;
}

export function toMessageView(m: Prisma.GoalAdvisorMessageGetPayload<object>): AdvisorMessageView {
  return {
    id: m.id,
    role: m.role === "USER" ? "USER" : "ASSISTANT",
    content: m.content,
    proposal: (m.proposal as unknown as AdvisorProposal | null) ?? null,
    applied: m.appliedAt !== null,
    dismissed: m.dismissedAt !== null,
  };
}

export async function listMessages(ownerSub: string) {
  return prisma.goalAdvisorMessage.findMany({ where: { ownerSub }, orderBy: { createdAt: "asc" }, take: 200 });
}

/* ---------- what the advisor reads ---------- */

/** The plan as the advisor sees it, with a short ref for everything it may
 * change. The maps turn the refs back into rows. */
export function briefOf(ov: PlanOverview, extra: { observation: string; logs: string; review: string; experiments: string }) {
  const refs = new Map<string, { kind: string; id: string }>();
  const ref = (prefix: string, kind: string, id: string, i: number) => {
    const r = `${prefix}${i + 1}`;
    refs.set(r, { kind, id });
    return r;
  };
  const goals = ov.goals.filter((g) => g.status === "ACTIVE");
  const goalRef = new Map<string, string>();
  const lines: string[] = [];
  lines.push(`計画: ${ov.plan.title || "（題名なし）"}`);
  if (ov.plan.vision) lines.push("目指す姿:", ov.plan.vision.slice(0, 1500));
  lines.push("", "目標（領域）:");
  let phaseIndex = 0;
  goals.forEach((g, i) => {
    const r = ref("G", "goal", g.id, i);
    goalRef.set(g.id, r);
    lines.push(`- ${r} ${g.title} ／ 週${g.weeklyHours}h（通勤${g.commuteHours}h） ／ 目指す状態: ${g.statement.slice(0, 200)} ／ 進め方: ${g.approach.slice(0, 200)}`);
    for (const m of g.milestones) {
      const pr = ref("P", "phase", m.id, phaseIndex++);
      lines.push(`    - ${pr} ${m.label} ${m.startDateKey ?? "?"}〜${m.dueDateKey ?? "?"}${m.condition ? ` ／ 次へ進む条件: ${m.condition.slice(0, 200)}` : ""}${m.done ? " ／ 済" : ""}`);
    }
  });
  const g = (id: string | null) => (id ? (goalRef.get(id) ?? "") : "");
  const cycle = ov.cycles.find((c) => c.id === ov.currentCycleId);
  if (cycle) {
    lines.push("", `今の実行期間: ${cycle.label} ${cycle.fromDateKey}〜${cycle.toDateKey}（区切り: ${cycle.phases.map((p) => `${p.label} ${p.fromDateKey}〜${p.toDateKey}`).join(" / ")}）`);
    cycle.outcomes.forEach((o, i) => {
      const r = ref("O", "outcome", o.id, i);
      lines.push(`- ${r} ${g(o.goalId) || o.area}: 目指すもの: ${o.target.slice(0, 300)} ／ 証拠: ${o.evidence.slice(0, 200)} ／ 時間: ${o.hoursNote} ／ 区切りごと: ${o.phaseTexts.join(" | ").slice(0, 400)}`);
    });
  }
  lines.push("", "標準の1週間:");
  for (let d = 0; d < 7; d++) {
    const day = ov.slots.filter((x) => x.weekday === d);
    lines.push(`- ${WEEKDAY[d]}(${d}): ${day.length === 0 ? "（なし）" : day.map((x) => `${x.startTime}〜${x.endTime} ${g(x.goalId)}${x.commute ? "[通勤]" : ""} ${x.label}`).join(" / ")}`);
  }
  lines.push("", "日付のあるもの:");
  ov.events.forEach((e, i) => {
    const r = ref("E", "event", e.id, i);
    lines.push(`- ${r} [${e.kind}] ${e.dateKey}${e.endDateKey ? `〜${e.endDateKey}` : ""} ${e.title} ${g(e.goalId)}${e.confirmed ? " 確定" : " 候補"}${e.done ? " 済" : ""}`);
  });
  lines.push("", "確認事項:");
  ov.checks.forEach((c, i) => {
    const r = ref("C", "check", c.id, i);
    lines.push(`- ${r} ${c.done ? "済" : "未"} ${c.question} ${g(c.goalId)}${c.dueDateKey ? ` 期限${c.dueDateKey}` : ""}${c.answer ? ` ／ 回答: ${c.answer.slice(0, 200)}` : ""}`);
  });
  lines.push("", "タスク:");
  ov.tasks.forEach((t, i) => {
    const r = ref("T", "task", t.id, i);
    lines.push(`- ${r} ${t.done ? "済" : "未"} ${t.text} ${g(t.goalId)}${t.dueDateKey ? ` 期限${t.dueDateKey}` : ""}`);
  });
  if (ov.plan.decisionRules) lines.push("", "判断ルール（本人の計画）:", ov.plan.decisionRules.slice(0, 5000));
  lines.push("", "観測:", extra.observation, "", "最近の日次記録:", extra.logs || "（なし）", "", "直近の週次レビュー:", extra.review || "（なし）", "", "試している改善:", extra.experiments || "（なし）");
  lines.push("", "最近の変更履歴:", ...(ov.changeLog.slice(0, 10).map((c) => `- ${c.dateKey} ${c.after.slice(0, 200)}${c.reason ? ` ／ 理由: ${c.reason.slice(0, 120)}` : ""}`) || []));
  return { text: lines.join("\n"), refs, goalRef };
}

const SYSTEM_PROMPT = `あなたは、この人の目標と計画のアドバイザーです。計画を一から一緒に立てることも、今ある計画を記録と観測にもとづいて直していくこともします。

返し方は3つ。どれにするかは会話の段階で決める:
1. 話すだけ（質問・整理・相談）: ops は空、document は空。
2. 計画の一部を変える: ops に変更を入れる（下の一覧）。document は空。
3. 計画を一から作る／全体を書き直す: document に計画書の全文を入れる。ops は空。
   - 「全体を見直したい」「作り直したい」と言われたとき、または変更が多くの領域・ロードマップ・1週間に及ぶときは 3。
   - 計画書が既にあるなら、それを土台に、変える所だけ変えて全文を書く（残すべき部分を落とさない）。

計画を一から立てるとき（計画が空のとき、または頼まれたとき）は、面談のように順番に聞いていく。1回の返事で聞くのは2〜4個まで。それまでに分かったことを短くまとめてから次を聞く:
  ① 目指す姿と大きな目標（領域ごとに、目指す状態）
  ② 現在地: 年齢・仕事（契約・時間・出社日・通勤）・学業（在籍・単位・条件）・睡眠・家計・大切な人との時間など、事実として分かっていること
  ③ 制約と優先: 動かせない予定、締切、申請期間、使える時間の合計
  ④ 長期ロードマップ: 領域ごとに年度ごとの段階と「次へ進む条件」
  ⑤ 直近の実行期間（基本は12週間、開始は次の月曜）: 領域ごとの到達点・完了と判断する証拠・使う時間、4週ごとの進め方
  ⑥ 週の時間予算（机と通勤中）と168時間の整合、標準の1週間の時間割
  ⑦ 何を計測し、いつ振り返り、何が起きたら何を変えるか
- 分からないことは決めつけず「仮置き」として置き、確認事項に入れる。本人が全部答えなくても、十分になったら「計画書にまとめましょうか」と提案してよい。頼まれたらすぐに書く。
- 成果量・期限は最初の2週間の実績で見直す前提で置く。睡眠や大切な人との時間を削って埋め合わせない。

計画書（document）の書き方。この文書はそのまま読み込まれて、目標・ガントチャート・実行期間・時間割・日付・確認事項になる。Markdownで、次の節をこの順に（無い節は省く）:
  # 題名
  - 作成日・バージョン・最初の実行期間・基準（睡眠・仕事・学習等の時間）
  ## 1. 目指す姿と目標の関係 — 引用（>）で目指す姿。表: | 大きな目標 | 目指す状態 | 当面の進め方 |
  ## 2. 現在地と仮置き — 確認できたこと（表）と、これから確認すること（箇条書き）
  ## 3. 長期ロードマップ — 表: | 領域 | 期間ごとの段階… | 次へ進む条件 | と、mermaid の gantt（dateFormat YYYY-MM-DD、section = 領域、各行「段階名 :id, 開始日, 終了日」）
  ## 4. 直近12週間の到達点 — 期間。表: | 領域 | 12週間で目指すもの | 完了したと判断する証拠 | 使用する時間 |。4週ごとの表: | 領域 | 第1〜4週：月/日〜月/日 | … |。締切・申請期間・授業日の表（日付は年を入れる）
  ## 5. 週の時間予算 — 表: | 領域 | 週の時間 | 机 | 通勤中 | 含めるもの |。168時間の表: | 用途 | 時間／週 | 確定・仮置き |
  ## 6. 標準の1週間 — 表: | 曜日 | 机で取り組む枠 | 通勤中 | 合計 |。枠は「06:00〜07:00 領域：内容」を「／」区切り
  ## 7. 何を計測するか — 領域ごとの残す記録と4〜12週で確認する改善（表）、指標の定義
  ## 8. 振り返りと判断ルール — レビューの周期と日付、「何が起きたら何を変えるか」の表
  ## 9. 確認事項 — 表: | 確認すること | 確認方法 | 計画への影響 | 期限 |
  ## 10. 最初の1週間でやること — チェックリスト
- 領域の名前は、既にある目標（G1…）と同じものはその名前のまま使う。
- 計画書を出すときの reply は、何をどうまとめたか・前と何が変わったかを3〜6文で。

一部を変えるとき（ops）の姿勢:
- 本人の判断ルールに従い、観測（実績時間・実現率・成果物の状態・詰まり）を根拠にする。改善は一度に1つが基本。
- 大きな進路や卒業年月を、単発の好調・不調だけで動かさない。時間を増やすなら、どこを減らすかも示す。
- 過去の予定や記録は書き換えない（変更は今後に対して行う）。
- reply は日本語で、何を読み取り、何をどう変える提案かを2〜5文で。

変更（ops）の種類。ref は下の一覧の記号（G1, P3, O2, E1, C4, T2）。新しいものは ref なし:
- {"type":"goal.update","ref":"G1", "title"?, "statement"?, "approach"?, "weeklyHours"?, "commuteHours"?}
- {"type":"goal.add","title","statement","approach","weeklyHours","commuteHours"}
- {"type":"phase.add","goalRef":"G1","label","startDateKey","dueDateKey","condition"}
- {"type":"phase.update","ref":"P3", "label"?, "startDateKey"?, "dueDateKey"?, "condition"?}
- {"type":"phase.remove","ref":"P3"}
- {"type":"outcome.update","ref":"O2", "target"?, "evidence"?, "hoursNote"?, "phaseTexts"?}
- {"type":"outcome.add","goalRef":"G1","target","evidence","hoursNote","phaseTexts":[]}
- {"type":"slots.replace","weekday": 0〜6（その曜日だけ置き換え）, "slots":[{"startTime":"HH:MM","endTime":"HH:MM","goalRef":"G1","label","commute":false}]}
- {"type":"event.add","kind":"DEADLINE|APPLICATION|EVENT|REVIEW","title","dateKey","endDateKey":null,"goalRef":null,"confirmed":false,"note":""}
- {"type":"event.update","ref":"E1", "title"?, "dateKey"?, "endDateKey"?, "confirmed"?, "done"?, "note"?}
- {"type":"event.remove","ref":"E1"}
- {"type":"check.add","question","method","impact","goalRef":null,"dueDateKey":null}
- {"type":"check.update","ref":"C1", "answer"?, "done"?}
- {"type":"task.add","text","goalRef":null,"dueDateKey":null}
- {"type":"task.update","ref":"T1","done":true}
- {"type":"experiment.add","goalRef":null,"observation","hypothesis","change","evidence","reviewDateKey","keepIf","otherwise"}

日付は YYYY-MM-DD、時刻は HH:MM、曜日は 0=日〜6=土。

出力は次のJSONのみ（前後に文章やコードフェンスを付けない。document の中の改行は \\n で書く）:
{ "reply": "相手への返事", "reason": "変更する根拠（観測したこと）を1〜2文。変更が無ければ空", "ops": [], "document": "" }`;

/* ---------- checking a proposal ---------- */

const s = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const date = (v: unknown) => (v === null ? null : typeof v === "string" && PLAN_DATE_KEY.test(v.trim()) ? v.trim() : undefined);
const hrs = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 && x <= 168 ? Math.round(x * 4) / 4 : undefined;
};
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const list = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${LABELS[k] ?? k}: ${Array.isArray(v) ? v.join(" | ") : v === null ? "なし" : String(v)}`)
    .join(" ／ ");

const LABELS: Record<string, string> = {
  title: "名前", statement: "目指す状態", approach: "進め方", weeklyHours: "週の時間", commuteHours: "通勤中",
  label: "段階", startDateKey: "開始", dueDateKey: "終了", condition: "次へ進む条件", target: "目指すもの",
  evidence: "証拠", hoursNote: "時間", phaseTexts: "区切りごと", dateKey: "日付", endDateKey: "終わり", confirmed: "確定",
  done: "済", note: "メモ", answer: "回答", question: "確認事項", method: "確認方法", impact: "影響", text: "タスク",
  kind: "種類", observation: "観測", hypothesis: "仮説", change: "変更", reviewDateKey: "見直し日", keepIf: "続ける目安", otherwise: "変わらない場合",
};

/**
 * Turns the model's ops into ones that can be applied: each ref resolved
 * against the brief's map and checked to exist in the plan, each value
 * cleaned; anything that doesn't resolve or doesn't validate is dropped,
 * not guessed at. Pure given the overview and the ref map.
 */
export function resolveOps(raw: unknown, ov: PlanOverview, refs: Map<string, { kind: string; id: string }>): ResolvedOp[] {
  const ops: ResolvedOp[] = [];
  const target = (r: unknown, kind: string) => {
    const hit = typeof r === "string" ? refs.get(r.trim()) : undefined;
    return hit && hit.kind === kind ? hit.id : null;
  };
  const goalName = (id: string | null) => (id ? (ov.goals.find((g) => g.id === id)?.title ?? "") : "");
  const phases = ov.goals.flatMap((g) => g.milestones.map((m) => ({ ...m, goalId: g.id })));
  const cycle = ov.cycles.find((c) => c.id === ov.currentCycleId);

  for (const item of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    const o = (item ?? {}) as Record<string, unknown>;
    const type = s(o.type, 30) as OpType | undefined;
    switch (type) {
      case "goal.update": {
        const id = target(o.ref, "goal");
        const goal = ov.goals.find((g) => g.id === id);
        const data = defined({ title: s(o.title, 200), statement: s(o.statement), approach: s(o.approach), weeklyHours: hrs(o.weeklyHours), commuteHours: hrs(o.commuteHours) });
        if (!goal || Object.keys(data).length === 0) break;
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, (goal as unknown as Record<string, unknown>)[k]]));
        ops.push({ type, targetId: goal.id, data, before: `${goal.title}: ${list(before)}`, after: `${goal.title}: ${list(data)}` });
        break;
      }
      case "goal.add": {
        const title = s(o.title, 200);
        if (!title) break;
        const data = { title, statement: s(o.statement) ?? "", approach: s(o.approach) ?? "", weeklyHours: hrs(o.weeklyHours) ?? 0, commuteHours: hrs(o.commuteHours) ?? 0 };
        ops.push({ type, targetId: null, data, before: "", after: `目標を追加: ${list(data)}` });
        break;
      }
      case "phase.add": {
        const goalId = target(o.goalRef, "goal");
        const label = s(o.label, 200);
        const startDateKey = date(o.startDateKey) ?? null;
        const dueDateKey = date(o.dueDateKey) ?? null;
        if (!goalId || !label || (startDateKey && dueDateKey && startDateKey > dueDateKey)) break;
        const data = { goalId, label, startDateKey, dueDateKey, condition: s(o.condition, 2000) ?? "" };
        ops.push({ type, targetId: null, data, before: "", after: `${goalName(goalId)}に段階を追加: ${label} ${startDateKey ?? "?"}〜${dueDateKey ?? "?"}${data.condition ? ` ／ 条件: ${data.condition}` : ""}` });
        break;
      }
      case "phase.update": {
        const id = target(o.ref, "phase");
        const phase = phases.find((p) => p.id === id);
        const data = defined({ label: s(o.label, 200), startDateKey: date(o.startDateKey), dueDateKey: date(o.dueDateKey), condition: s(o.condition, 2000) });
        if (!phase || Object.keys(data).length === 0) break;
        const start = (data.startDateKey as string | null | undefined) ?? phase.startDateKey;
        const due = (data.dueDateKey as string | null | undefined) ?? phase.dueDateKey;
        if (start && due && start > due) break;
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, (phase as unknown as Record<string, unknown>)[k]]));
        ops.push({ type, targetId: phase.id, data, before: `${goalName(phase.goalId)}「${phase.label}」 ${list(before)}`, after: `${goalName(phase.goalId)}「${phase.label}」 ${list(data)}` });
        break;
      }
      case "phase.remove": {
        const id = target(o.ref, "phase");
        const phase = phases.find((p) => p.id === id);
        if (!phase) break;
        ops.push({ type, targetId: phase.id, data: {}, before: `${goalName(phase.goalId)}「${phase.label}」 ${phase.startDateKey ?? "?"}〜${phase.dueDateKey ?? "?"}`, after: "段階を削除" });
        break;
      }
      case "outcome.update": {
        const id = target(o.ref, "outcome");
        const outcome = cycle?.outcomes.find((x) => x.id === id);
        const phaseTexts = Array.isArray(o.phaseTexts) ? o.phaseTexts.map((t) => s(t, 2000) ?? "") : undefined;
        const data = defined({ target: s(o.target), evidence: s(o.evidence), hoursNote: s(o.hoursNote, 500), phaseTexts });
        if (!outcome || Object.keys(data).length === 0) break;
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, (outcome as unknown as Record<string, unknown>)[k]]));
        const name = goalName(outcome.goalId) || outcome.area;
        ops.push({ type, targetId: outcome.id, data, before: `${name}: ${list(before)}`, after: `${name}: ${list(data)}` });
        break;
      }
      case "outcome.add": {
        if (!cycle) break;
        const goalId = target(o.goalRef, "goal");
        const tgt = s(o.target);
        if (!tgt) break;
        const data = {
          cycleId: cycle.id,
          goalId,
          target: tgt,
          evidence: s(o.evidence) ?? "",
          hoursNote: s(o.hoursNote, 500) ?? "",
          phaseTexts: Array.isArray(o.phaseTexts) ? o.phaseTexts.map((t) => s(t, 2000) ?? "") : [],
        };
        ops.push({ type, targetId: null, data, before: "", after: `${goalName(goalId) || "実行期間"}の到達点を追加: ${tgt}` });
        break;
      }
      case "slots.replace": {
        const weekday = Number(o.weekday);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) break;
        const slots = (Array.isArray(o.slots) ? o.slots.slice(0, 20) : []).flatMap((x) => {
          const r = (x ?? {}) as Record<string, unknown>;
          const startTime = s(r.startTime, 5) ?? "";
          const endTime = s(r.endTime, 5) ?? "";
          if (!PLAN_TIME.test(startTime) || !PLAN_TIME.test(endTime) || startTime >= endTime) return [];
          return [{ startTime, endTime, goalId: target(r.goalRef, "goal"), label: s(r.label, 200) ?? "", commute: r.commute === true }];
        });
        const fmt = (xs: { startTime: string; endTime: string; goalId: string | null; label: string; commute: boolean }[]) =>
          xs.length === 0 ? "（なし）" : xs.map((x) => `${x.startTime}〜${x.endTime} ${goalName(x.goalId)}${x.commute ? "（通勤）" : ""} ${x.label}`.trim()).join(" / ");
        const current = ov.slots.filter((x) => x.weekday === weekday);
        ops.push({ type, targetId: null, data: { weekday, slots }, before: `${WEEKDAY[weekday]}曜: ${fmt(current)}`, after: `${WEEKDAY[weekday]}曜: ${fmt(slots)}` });
        break;
      }
      case "event.add": {
        const title = s(o.title, 300);
        const dateKey = date(o.dateKey);
        const endDateKey = date(o.endDateKey) ?? null;
        if (!title || !dateKey || (endDateKey && endDateKey < dateKey)) break;
        const kind = (s(o.kind, 20) ?? "").toUpperCase();
        const data = {
          kind: (EVENT_KINDS as readonly string[]).includes(kind) ? kind : "EVENT",
          title,
          dateKey,
          endDateKey,
          goalId: target(o.goalRef, "goal"),
          confirmed: o.confirmed === true,
          note: s(o.note, 2000) ?? "",
        };
        ops.push({ type, targetId: null, data, before: "", after: `日付を追加: ${dateKey}${endDateKey ? `〜${endDateKey}` : ""} ${title}` });
        break;
      }
      case "event.update": {
        const id = target(o.ref, "event");
        const event = ov.events.find((e) => e.id === id);
        const data = defined({ title: s(o.title, 300), dateKey: date(o.dateKey) ?? undefined, endDateKey: date(o.endDateKey), confirmed: bool(o.confirmed), done: bool(o.done), note: s(o.note, 2000) });
        if (!event || Object.keys(data).length === 0) break;
        const before = Object.fromEntries(Object.keys(data).map((k) => [k, (event as unknown as Record<string, unknown>)[k]]));
        ops.push({ type, targetId: event.id, data, before: `${event.title}: ${list(before)}`, after: `${event.title}: ${list(data)}` });
        break;
      }
      case "event.remove": {
        const id = target(o.ref, "event");
        const event = ov.events.find((e) => e.id === id);
        if (!event) break;
        ops.push({ type, targetId: event.id, data: {}, before: `${event.dateKey} ${event.title}`, after: "日付を削除" });
        break;
      }
      case "check.add": {
        const question = s(o.question, 1000);
        if (!question) break;
        const data = { question, method: s(o.method, 2000) ?? "", impact: s(o.impact, 2000) ?? "", goalId: target(o.goalRef, "goal"), dueDateKey: date(o.dueDateKey) ?? null };
        ops.push({ type, targetId: null, data, before: "", after: `確認事項を追加: ${question}${data.dueDateKey ? `（${data.dueDateKey}まで）` : ""}` });
        break;
      }
      case "check.update": {
        const id = target(o.ref, "check");
        const check = ov.checks.find((c) => c.id === id);
        const data = defined({ answer: s(o.answer), done: bool(o.done) });
        if (!check || Object.keys(data).length === 0) break;
        ops.push({ type, targetId: check.id, data, before: `${check.question}: ${check.done ? "済" : "未"}`, after: `${check.question}: ${list(data)}` });
        break;
      }
      case "task.add": {
        const text = s(o.text, 1000);
        if (!text) break;
        const data = { text, goalId: target(o.goalRef, "goal"), dueDateKey: date(o.dueDateKey) ?? null };
        ops.push({ type, targetId: null, data, before: "", after: `タスクを追加: ${text}${data.dueDateKey ? `（${data.dueDateKey}まで）` : ""}` });
        break;
      }
      case "task.update": {
        const id = target(o.ref, "task");
        const task = ov.tasks.find((t) => t.id === id);
        const done = bool(o.done);
        if (!task || done === undefined) break;
        ops.push({ type, targetId: task.id, data: { done }, before: `${task.text}: ${task.done ? "済" : "未"}`, after: `${task.text}: ${done ? "済" : "未"}` });
        break;
      }
      case "experiment.add": {
        const change = s(o.change, 3000);
        if (!change) break;
        const data = {
          goalId: target(o.goalRef, "goal"),
          observation: s(o.observation, 3000) ?? "",
          hypothesis: s(o.hypothesis, 3000) ?? "",
          change,
          evidence: s(o.evidence, 3000) ?? "",
          reviewDateKey: date(o.reviewDateKey) ?? null,
          keepIf: s(o.keepIf, 3000) ?? "",
          otherwise: s(o.otherwise, 3000) ?? "",
        };
        ops.push({ type, targetId: null, data, before: "", after: `改善を試す: ${change}${data.reviewDateKey ? `（${data.reviewDateKey}に見直し）` : ""}` });
        break;
      }
      default:
        break;
    }
  }
  return ops;
}

/* ---------- the conversation ---------- */

function progressFrom(text: string): ChatProgress {
  const items: ProgressItem[] = [...text.matchAll(/"type"\s*:\s*"([a-z.]+)"/g)].map((m) => ({ dateKey: "", slot: null, title: m[1] }));
  // A plan document being written: its headings, as they come.
  const doc = /"document"\s*:\s*"/.exec(text);
  if (doc) {
    for (const m of text.slice(doc.index).matchAll(/\\n(#{1,2} [^\\]{1,80})/g)) items.push({ dateKey: "", slot: null, title: m[1].replace(/^#+ /, "") });
  }
  return { stage: "writing", reply: partialString(text, "reply"), items };
}

async function context(ownerSub: string, todayKey: string) {
  const [ov, obs, logs, review] = await Promise.all([
    getPlanOverview(ownerSub, todayKey),
    observe(ownerSub, todayKey),
    prisma.goalDailyLog.findMany({ where: { ownerSub }, orderBy: { dateKey: "desc" }, take: 7 }),
    prisma.goalReview.findFirst({ where: { ownerSub, kind: "WEEKLY" }, orderBy: { dateKey: "desc" } }),
  ]);
  const name = (id: string) => ov.goals.find((g) => g.id === id)?.title ?? id;
  const observation = [
    ...obs.weeks.slice(-4).map(
      (w) =>
        `- 週${w.weekStartDateKey}${w.special ? "（特別週）" : ""}${w.recorded ? "" : "（記録不足）"}: ${w.goals
          .map((x) => `${name(x.goalId)} ${x.actual}/${x.planned}h${x.rate !== null ? `(${Math.round(x.rate * 100)}%)` : ""}`)
          .join("、") || "記録なし"}`,
    ),
    ...obs.alerts.map((a) => `- 注意: ${a.kind} ${JSON.stringify(a).slice(0, 200)}`),
    ...obs.deliverables.slice(0, 10).map((d) => `- 成果物: ${d.title}（${d.status}）${d.condition ? ` 完了条件: ${d.condition}` : ""}`),
  ].join("\n");
  const logsText = logs
    .map((l) => {
      const h = Object.entries((l.hours ?? {}) as Record<string, number>).map(([k, v]) => `${name(k)}${v}h`).join(" ");
      return `- ${l.dateKey}${l.special ? "（特別）" : ""}: ${h || "0h"} ／ 進んだ: ${l.progress.slice(0, 150)} ／ 詰まり: ${l.blocker.slice(0, 150)} ／ 次: ${l.next.slice(0, 100)}`;
    })
    .join("\n");
  const r = (review?.data ?? {}) as Record<string, string>;
  const reviewText = review ? `週${review.dateKey}: 詰まり: ${r.blocker ?? ""} ／ 仮説: ${r.hypothesis ?? ""} ／ 変えること: ${r.change ?? ""}` : "";
  const experiments = obs.experiments.map((x) => `- ${x.change}（見直し${x.reviewDateKey ?? "未定"}）`).join("\n");
  return { ov, brief: briefOf(ov, { observation, logs: logsText, review: reviewText, experiments }) };
}

export async function sendMessage(ownerSub: string, text: string, todayKey: string, onProgress?: (p: ChatProgress) => void) {
  const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new ValidationError("mealChatInvalid", "message is empty");
  const [{ ov, brief }, history] = await Promise.all([
    context(ownerSub, todayKey),
    prisma.goalAdvisorMessage.findMany({ where: { ownerSub }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS }),
  ]);
  const userMessage = await prisma.goalAdvisorMessage.create({ data: { ownerSub, role: "USER", content } });
  onProgress?.({ stage: "context", reply: "", items: [] });
  const prompt = [
    `今日: ${todayKey}`,
    "",
    ov.goals.some((g) => g.status === "ACTIVE") ? brief.text : "計画はまだ空です（目標・期間・1週間・記録のいずれも無い）。",
    "",
    "現在の計画書:",
    ov.document ? ov.document.markdown.slice(0, DOCUMENT_CONTEXT_CHARS) : "（まだ無い）",
    "",
    "これまでの会話:",
    ...(history.length === 0
      ? ["  （なし）"]
      : [...history].reverse().map((m) => {
          const doc = (m.proposal as unknown as AdvisorProposal | null)?.document;
          const note = doc ? `（計画書を提示・${m.appliedAt ? "反映済み" : m.dismissedAt ? "見送り" : "未反映"}）` : "";
          return `  ${m.role === "USER" ? "相手" : "あなた"}: ${m.content.slice(0, HISTORY_CHARS)}${note}`;
        })),
    "",
    `相手の新しいメッセージ: ${content}`,
  ].join("\n");

  let reply: string;
  let proposal: AdvisorProposal;
  try {
    let writing = false;
    const { value } = await askForJson(
      ownerSub,
      SYSTEM_PROMPT,
      prompt,
      32000,
      undefined,
      onProgress &&
        ((p) => {
          if (p.kind === "thinking") {
            if (!writing) onProgress({ stage: "thinking", reply: "", items: [] });
            return;
          }
          writing = true;
          onProgress(progressFrom(p.text));
        }),
    );
    const o = (value ?? {}) as Record<string, unknown>;
    reply = (s(o.reply, 4000) ?? "") || "（返事が空でした）";
    const document = s(o.document, MAX_DOCUMENT_CHARS) ?? "";
    // A plan document is a rewrite on its own; ops alongside it would apply twice.
    proposal = looksLikePlan(document)
      ? { reason: s(o.reason, 2000) ?? "", ops: [], document }
      : { reason: s(o.reason, 2000) ?? "", ops: resolveOps(o.ops, ov, brief.refs) };
    onProgress?.({ stage: "saving", reply, items: [] });
  } catch (e) {
    await prisma.goalAdvisorMessage.delete({ where: { id: userMessage.id } });
    throw e;
  }
  await prisma.goalAdvisorMessage.create({
    data: {
      ownerSub,
      role: "ASSISTANT",
      content: reply,
      proposal: proposal.ops.length > 0 || proposal.document ? (proposal as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  return listMessages(ownerSub);
}

/**
 * Applies a proposal: every change in one transaction, each target checked
 * again (it may have been edited or deleted since), and a change-log line
 * per change with its before, after and the proposal's reason. A proposal
 * applies once.
 */
export async function applyProposal(ownerSub: string, messageId: string, todayKey: string): Promise<number> {
  const message = await prisma.goalAdvisorMessage.findFirst({ where: { id: messageId, ownerSub } });
  const proposal = message?.proposal as unknown as AdvisorProposal | null;
  if (!message || !proposal || proposal.document || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  }
  let applied = 0;
  await prisma.$transaction(async (tx) => {
    const ownGoal = async (id: unknown) =>
      typeof id === "string" && id ? ((await tx.goal.findFirst({ where: { id, ownerSub }, select: { id: true } }))?.id ?? null) : null;
    for (const op of proposal.ops) {
      const d = op.data as Record<string, unknown>;
      let done = true;
      switch (op.type) {
        case "goal.update":
          done = (await tx.goal.updateMany({ where: { id: op.targetId!, ownerSub }, data: d })).count > 0;
          break;
        case "goal.add": {
          const last = await tx.goal.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
          await tx.goal.create({ data: { ownerSub, ...(d as { title: string }), reviewedOnDateKey: todayKey, sortOrder: (last?.sortOrder ?? -1) + 1 } });
          break;
        }
        case "phase.add": {
          const goalId = await ownGoal(d.goalId);
          if (!goalId) {
            done = false;
            break;
          }
          const count = await tx.goalMilestone.count({ where: { goalId } });
          await tx.goalMilestone.create({
            data: { goalId, label: String(d.label), startDateKey: (d.startDateKey as string | null) ?? null, dueDateKey: (d.dueDateKey as string | null) ?? null, condition: String(d.condition ?? ""), sortOrder: count },
          });
          break;
        }
        case "phase.update":
          done = (await tx.goalMilestone.updateMany({ where: { id: op.targetId!, goal: { ownerSub } }, data: d })).count > 0;
          break;
        case "phase.remove":
          done = (await tx.goalMilestone.deleteMany({ where: { id: op.targetId!, goal: { ownerSub } } })).count > 0;
          break;
        case "outcome.update":
          done = (await tx.goalCycleOutcome.updateMany({ where: { id: op.targetId!, cycle: { ownerSub } }, data: d as Prisma.GoalCycleOutcomeUpdateManyMutationInput })).count > 0;
          break;
        case "outcome.add": {
          const cycle = await tx.goalCycle.findFirst({ where: { id: String(d.cycleId), ownerSub }, include: { outcomes: true } });
          if (!cycle) {
            done = false;
            break;
          }
          await tx.goalCycleOutcome.create({
            data: {
              cycleId: cycle.id,
              goalId: await ownGoal(d.goalId),
              target: String(d.target),
              evidence: String(d.evidence ?? ""),
              hoursNote: String(d.hoursNote ?? ""),
              phaseTexts: (d.phaseTexts ?? []) as Prisma.InputJsonValue,
              sortOrder: cycle.outcomes.length,
            },
          });
          break;
        }
        case "slots.replace": {
          const weekday = Number(d.weekday);
          await tx.goalWeekSlot.deleteMany({ where: { ownerSub, weekday } });
          const slots = (d.slots as { startTime: string; endTime: string; goalId: string | null; label: string; commute: boolean }[]) ?? [];
          for (const x of slots) {
            await tx.goalWeekSlot.create({ data: { ownerSub, weekday, startTime: x.startTime, endTime: x.endTime, goalId: await ownGoal(x.goalId), label: x.label, commute: x.commute } });
          }
          break;
        }
        case "event.add":
          await tx.goalEvent.create({ data: { ownerSub, ...(d as { title: string; dateKey: string }), goalId: await ownGoal(d.goalId) } });
          break;
        case "event.update":
          done = (await tx.goalEvent.updateMany({ where: { id: op.targetId!, ownerSub }, data: d })).count > 0;
          break;
        case "event.remove":
          done = (await tx.goalEvent.deleteMany({ where: { id: op.targetId!, ownerSub } })).count > 0;
          break;
        case "check.add":
          await tx.goalCheck.create({ data: { ownerSub, ...(d as { question: string }), goalId: await ownGoal(d.goalId) } });
          break;
        case "check.update": {
          const data: Prisma.GoalCheckUpdateManyMutationInput = {};
          if (typeof d.answer === "string") data.answer = d.answer;
          if (typeof d.done === "boolean") data.doneAt = d.done ? new Date() : null;
          done = (await tx.goalCheck.updateMany({ where: { id: op.targetId!, ownerSub }, data })).count > 0;
          break;
        }
        case "task.add": {
          const last = await tx.goalTask.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
          await tx.goalTask.create({ data: { ownerSub, ...(d as { text: string }), goalId: await ownGoal(d.goalId), sortOrder: (last?.sortOrder ?? -1) + 1 } });
          break;
        }
        case "task.update":
          done = (await tx.goalTask.updateMany({ where: { id: op.targetId!, ownerSub }, data: { doneAt: d.done ? new Date() : null } })).count > 0;
          break;
        case "experiment.add":
          await tx.goalExperiment.create({ data: { ownerSub, ...(d as { change: string }), goalId: await ownGoal(d.goalId) } });
          break;
      }
      if (!done) continue;
      applied++;
      await addChange(ownerSub, { dateKey: todayKey, before: op.before, after: op.after, reason: proposal.reason, checkDateKey: null }, "ADVISOR", tx);
    }
    await tx.goalAdvisorMessage.update({ where: { id: messageId }, data: { appliedAt: new Date() } });
  }, TRANSACTION_OPTIONS);
  return applied;
}

/** A plan document worth reading in: long enough, with headings. */
export function looksLikePlan(document: string): boolean {
  return document.length >= 200 && /^#{1,3} /m.test(document);
}

/** The plan document a message proposed, still open — to be read in by the import. */
export async function openDocument(ownerSub: string, messageId: string): Promise<string> {
  const message = await prisma.goalAdvisorMessage.findFirst({ where: { id: messageId, ownerSub } });
  const document = (message?.proposal as unknown as AdvisorProposal | null)?.document;
  if (!message || !document || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  }
  return document;
}

/** Marks a proposed plan document as applied, once the import has written it. */
export async function markApplied(ownerSub: string, messageId: string): Promise<void> {
  await prisma.goalAdvisorMessage.updateMany({ where: { id: messageId, ownerSub, appliedAt: null }, data: { appliedAt: new Date() } });
}

/** Starts the conversation over. The plan and its change log stay. */
export async function clearConversation(ownerSub: string): Promise<void> {
  await prisma.goalAdvisorMessage.deleteMany({ where: { ownerSub } });
}

export async function dismissProposal(ownerSub: string, messageId: string): Promise<void> {
  const message = await prisma.goalAdvisorMessage.findFirst({ where: { id: messageId, ownerSub } });
  if (!message || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be dismissed");
  }
  await prisma.goalAdvisorMessage.update({ where: { id: messageId }, data: { dismissedAt: new Date() } });
}
