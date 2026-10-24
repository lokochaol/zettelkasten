import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import type { ChatProgress, ProgressItem } from "@/lib/chatProgress";
import { partialString } from "@/lib/chatProgress";
import { ValidationError } from "@/lib/errors";
import { GOAL_COLORS } from "@/lib/goalColors";
import { titleKey } from "@/lib/goals";
import { toRoutine, type Routine } from "@/lib/routine";
import { ITEM_STATUSES, STEP_KINDS, type DayRow, type WeekRow } from "@/lib/goalSubPlan";
import { addChange, EVENT_KINDS, phasesFor, PLAN_DATE_KEY, PLAN_TIME, savePlanDocument, type CyclePhase, type LifeBudgetLine } from "@/lib/goalPlan";

/**
 * Reading a goals document (Markdown, a pasted page) into the plan.
 *
 * The document is read twice at once, by two prompts with smaller jobs:
 * one for the shape of the plan (vision, goals with their budgets, records
 * and roadmap phases, the 168-hour week, the decision rules), one for how
 * it's run (the current cycle, the standard week, dates, open questions,
 * first tasks). Each answer is checked here field by field, and nothing is
 * written until the owner has looked at what was read and applies it.
 */

const MAX_SOURCE = 200_000;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

export interface DraftPhase {
  label: string;
  startDateKey: string | null;
  dueDateKey: string | null;
  condition: string;
}

export interface DraftGoal {
  title: string;
  statement: string;
  approach: string;
  weeklyHours: number;
  commuteHours: number;
  budgetNote: string;
  keepRecord: string;
  improveCheck: string;
  phases: DraftPhase[];
}

export interface DraftOutcome {
  goal: string | null;
  area: string;
  target: string;
  evidence: string;
  hoursNote: string;
  phaseTexts: string[];
}

export interface DraftCycle {
  label: string;
  fromDateKey: string;
  toDateKey: string;
  phases: CyclePhase[];
  outcomes: DraftOutcome[];
}

export interface DraftSlot {
  weekday: number;
  startTime: string;
  endTime: string;
  goal: string | null;
  label: string;
  commute: boolean;
}

export interface DraftEvent {
  kind: string;
  title: string;
  dateKey: string;
  endDateKey: string | null;
  goal: string | null;
  confirmed: boolean;
  note: string;
}

export interface DraftCheck {
  question: string;
  method: string;
  impact: string;
  goal: string | null;
  dueDateKey: string | null;
}

export interface DraftTask {
  text: string;
  goal: string | null;
  dueDateKey: string | null;
}

export interface DraftItem {
  group: string;
  code: string;
  title: string;
  kind: string;
  size: number;
  status: string;
  record: string;
  periodLabel: string;
  fromDateKey: string | null;
  toDateKey: string | null;
  note: string;
}

export interface DraftStep {
  /** The item's code or title, as the document names it; null for the plan itself. */
  item: string | null;
  label: string;
  kind: string;
  startDateKey: string | null;
  dateKey: string;
  backupDateKey: string | null;
  note: string;
}

/** An area's detailed plan, as read (see goalSubPlan). */
export interface DraftSubPlan {
  goal: string | null;
  title: string;
  summary: string;
  unitLabel: string;
  targetTotal: number;
  baseDone: number;
  items: DraftItem[];
  steps: DraftStep[];
  weekColumns: string[];
  weeks: WeekRow[];
  days: DayRow[];
}

export interface PlanDraft {
  /** "plan": the whole plan. "area": a detailed plan for one area — it
   * touches only that area. */
  scope: "plan" | "area";
  /** The area an "area" document is about. */
  area: string | null;
  subPlans: DraftSubPlan[];
  summary: string;
  title: string;
  vision: string;
  baseline: string;
  decisionRules: string;
  lifeBudget: LifeBudgetLine[];
  /** The daily frame, when the document gives one. */
  routine: Routine | null;
  goals: DraftGoal[];
  cycle: DraftCycle | null;
  slots: DraftSlot[];
  events: DraftEvent[];
  checks: DraftCheck[];
  tasks: DraftTask[];
}

/* ---------- prompts ---------- */

const COMMON = `あなたは、目標と計画の文書（Markdown）を、アプリのデータ構造に移す係です。
本人が書いた言葉をそのまま、正しい場所に移してください。要約・言い換え・創作はしない。文書に無いことは作らない。
日付は YYYY-MM-DD、時刻は HH:MM（24時間）。曜日は 0=日 1=月 2=火 3=水 4=木 5=金 6=土。
複数行のテキストは Markdown（箇条書きは "- "）。表は、意味が分かる形の箇条書きにしてよい。
返答はJSONオブジェクトのみ（前後に文章やコードフェンスを付けない）。`;

const SHAPE_PROMPT = `${COMMON}

担当: 計画の骨格。
- scope: 文書が計画の全体（複数の領域・人生全体の目標）なら "plan"。1つの領域だけの細かい計画（例: 大学の履修計画、ある資格の学習計画）なら "area"
- area: scope が "area" のとき、その領域の名前（短く。例:「大学・建築」）。"plan" なら null
- title: 文書の題名
- vision: 「目指す姿」など、計画全体の目的（引用文も含めて）
- baseline: 作成日・バージョン・実行期間・基準・計画の性格など、計画の前提（箇条書き）。「現在地」「これから確認すること」の要点も含めてよい
- goals: scope が "area" なら、その領域1件だけ（phases は空、週の時間予算が書いてあれば weeklyHours）。"plan" なら大きな目標（領域）ごとに1件。目標の表・時間予算の表・ロードマップの表・ガントチャートのsection・指標の表に出てくる領域をまとめる。同じ領域を二重にしない（例:「IT」と「ITの専門性」は1件）。時間予算にだけ出る領域（英語・管理など）も1件にする
  - title: 領域の名前（短く。例:「大学・建築」）
  - statement: 目指す状態
  - approach: 当面の進め方
  - weeklyHours: 週の時間予算（時間、数値）。無ければ 0
  - commuteHours: そのうち通勤中の時間。無ければ 0
  - budgetNote: 予算に含めるもの
  - keepRecord: 継続して残す最小限の記録
  - improveCheck: 4〜12週で確認する改善
  - phases: ロードマップの段階。ガントチャートの棒と、年度ごとの表の各列を、その領域の段階にする。{ "label", "startDateKey", "dueDateKey", "condition"（次へ進む条件。無ければ空） }。ガントの section が複数の領域をまとめている場合（例:「IT・経済的安定」）は、内容に合う領域へ振り分ける
- lifeBudget: 1週間168時間の内訳 [{ "label", "hours", "note" }]
- routine: 生活の基本。書いてあれば { "bed": 就寝 "HH:MM", "wake": 起床 "HH:MM", "days": [{ "weekday", "work": 仕事の日なら true, "start", "end": 勤務時間, "office": 出社なら true, "commuteMinutes": 片道の通勤分 }] }（7曜日分）。無ければ null
- decisionRules: 「何が起きたら、何を変えるか」の判断ルールと、改善の実験の進め方（Markdown）

出力:
{ "scope": "plan", "area": null, "summary": "読み取った内容を一文で", "title": "", "vision": "", "baseline": "", "goals": [ { "title": "", "statement": "", "approach": "", "weeklyHours": 0, "commuteHours": 0, "budgetNote": "", "keepRecord": "", "improveCheck": "", "phases": [ { "label": "", "startDateKey": "YYYY-MM-DD", "dueDateKey": "YYYY-MM-DD", "condition": "" } ] } ], "lifeBudget": [ { "label": "", "hours": 0, "note": "" } ], "routine": null, "decisionRules": "" }`;

const RUN_PROMPT = `${COMMON}

担当: 計画の運用。
- cycle: 直近の実行期間（例: 12週間）。{ "label", "fromDateKey", "toDateKey", "phases": 期間の区切り（例: 4週間ごと） [{ "label", "fromDateKey", "toDateKey" }], "outcomes": 領域ごとの到達点 [{ "goal": 領域の名前, "target": 目指すもの, "evidence": 完了と判断する証拠, "hoursNote": 使用する時間, "phaseTexts": 区切りごとの進め方（phases と同じ順と数） }] }。無ければ null
- slots: 標準の1週間の時間枠。机の枠は時刻どおりに1つずつ。{ "weekday", "startTime", "endTime", "goal": 領域の名前, "label": やること, "commute": 通勤中なら true }。通勤中の学習のように時刻が書かれていないものは、出社日の通勤時間帯（仕事の始まる前）に仮の時刻で置き、commute を true にする
- events: 日付のあるもの。{ "kind": "DEADLINE"（締切）/ "APPLICATION"（申請期間。dateKey〜endDateKey）/ "EVENT"（授業日などの予定。複数日は日ごとに1件）/ "REVIEW"（レビューの確認日）, "title", "dateKey", "endDateKey" または null, "goal": 領域の名前 または null, "confirmed": 確定していれば true（候補・仮は false）, "note" }
- checks: 計画を確定するための確認事項。{ "question", "method": 確認方法, "impact": 計画への影響, "goal": 領域の名前 または null, "dueDateKey": 期限があれば }
- 文書に科目・課題ごとの台帳や工程表がある場合、その科目の授業日・各課題の提出目標・初稿/点検日は events に入れない（別の担当が詳細計画として扱う）。申請期間・振込・登録締切・一般の締切・レビュー日は events に入れる
- tasks: 「最初に着手するもの」のようなチェックリスト。{ "text", "goal": 領域の名前 または null, "dueDateKey": 期限があれば }

出力:
{ "cycle": { "label": "", "fromDateKey": "", "toDateKey": "", "phases": [], "outcomes": [] }, "slots": [], "events": [], "checks": [], "tasks": [] }`;

const DETAIL_PROMPT = `${COMMON}

担当: 領域ごとの詳細計画（科目・課題の台帳と工程）。文書に、科目・課題・モジュールなどを1行ずつ並べた台帳や、課題ごとの初稿・点検・提出目標、授業（スクーリング）日程、週ごとの実行表、日ごとの実行表があれば、ここに移す。無ければ subPlans は []。
- subPlans: 詳細計画ごとに1件（ふつうは1件）
  - goal: どの領域の計画か（例:「大学・建築」）
  - title: 計画の名前（文書の題名など）
  - summary: 目的と前提を2〜4文で（文書の言葉で）
  - unitLabel: 台帳の大きさの単位（例:「単位」）。無ければ空
  - targetTotal: 目標の合計（例: 卒業に必要な124）。無ければ 0
  - baseDone: 台帳の行に無いが既に済んでいる分（例: 入学時の認定30単位）。無ければ 0
  - items: 台帳の全行。表の節ごとに group（例:「登録中」「専門必修」「選択必修」「自由選択」）。{ "group", "code", "title", "kind"（S/T・必修 など）, "size"（単位数など。数値）, "status", "record"（現在の評価・記録をそのまま）, "periodLabel"（学期・目標配置の言葉。例:「2027前期」）, "fromDateKey", "toDateKey"（目標配置が日付で分かるときだけ）, "note"（高評価のために残すもの・準備） }
    - status: 修得済み・完了 → "DONE"、合格だが未認定 → "PASSED"、提出済み → "SUBMITTED"、学習中・今期取り組む → "IN_PROGRESS"、登録済みだが未着手 → "REGISTERED"、未登録・将来 → "PLANNED"、見送り → "DROPPED"
  - steps: 日付のある工程。{ "item": 対応する台帳の code か title（計画全体の工程なら null）, "label", "kind", "startDateKey"（期間なら開始日。点なら null）, "dateKey"（終了日・その日）, "backupDateKey"（遅れた場合の予備目標があれば）, "note" }
    - kind: 作業期間 → "WORK"（ガントの棒もこれ）、初稿・仮下書き → "DRAFT"、点検・検算 → "CHECK"、提出目標・締切・必着 → "DUE"、授業・スクーリング（複数日は日ごとに1件） → "SESSION"、判定・判断の日 → "DECISION"、その他 → "OTHER"
    - ガントチャートの棒と milestone、課題ごとの表、SCの表、判断の日を漏らさない
  - weekColumns: 週ごとの実行表の列見出し（期間の列を除く）
  - weeks: 週ごとの実行表の全行。{ "label"（例:「1」「準備」）, "fromDateKey", "toDateKey", "cells": weekColumns と同じ順・数の文字列（表の文をそのまま。太字記号は外す） }
  - days: 日ごとの実行表の全行。{ "dateKey", "time"（時間・配分）, "work"（実作業）, "output"（残す成果物） }

出力:
{ "subPlans": [ { "goal": "", "title": "", "summary": "", "unitLabel": "", "targetTotal": 0, "baseDone": 0, "items": [], "steps": [], "weekColumns": [], "weeks": [], "days": [] } ] }`;

/* ---------- checking the answers ---------- */

const s = (v: unknown, max = 20_000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const date = (v: unknown) => (typeof v === "string" && PLAN_DATE_KEY.test(v.trim()) ? v.trim() : null);
const hours = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 0 && x <= 168 ? Math.round(x * 4) / 4 : 0;
};
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const goalRef = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

function parseShape(value: unknown) {
  const o = obj(value);
  const seen = new Set<string>();
  const goals: DraftGoal[] = arr(o.goals, 40).flatMap((g) => {
    const r = obj(g);
    const title = s(r.title, 200);
    if (!title || seen.has(titleKey(title))) return [];
    seen.add(titleKey(title));
    const phases = arr(r.phases, 30).flatMap((p) => {
      const pr = obj(p);
      const label = s(pr.label, 200);
      let startDateKey = date(pr.startDateKey);
      const dueDateKey = date(pr.dueDateKey);
      if (startDateKey && dueDateKey && startDateKey > dueDateKey) startDateKey = null;
      return label ? [{ label, startDateKey, dueDateKey, condition: s(pr.condition, 2000) }] : [];
    });
    const weeklyHours = hours(r.weeklyHours);
    return [
      {
        title,
        statement: s(r.statement),
        approach: s(r.approach),
        weeklyHours,
        commuteHours: Math.min(weeklyHours, hours(r.commuteHours)),
        budgetNote: s(r.budgetNote, 2000),
        keepRecord: s(r.keepRecord, 2000),
        improveCheck: s(r.improveCheck, 2000),
        phases,
      },
    ];
  });
  const lifeBudget = arr(o.lifeBudget, 30).flatMap((l) => {
    const r = obj(l);
    const label = s(r.label, 100);
    return label ? [{ label, hours: hours(r.hours), note: s(r.note, 500) }] : [];
  });
  const scope: "plan" | "area" = o.scope === "area" ? "area" : "plan";
  return {
    scope,
    area: scope === "area" ? goalRef(o.area) ?? goals[0]?.title ?? null : null,
    summary: s(o.summary, 500),
    title: s(o.title, 200),
    vision: s(o.vision),
    baseline: s(o.baseline),
    decisionRules: s(o.decisionRules, 50_000),
    lifeBudget,
    routine: o.routine && typeof o.routine === "object" ? toRoutine(o.routine) : null,
    goals,
  };
}

function parseRun(value: unknown) {
  const o = obj(value);
  let cycle: DraftCycle | null = null;
  const c = obj(o.cycle);
  const from = date(c.fromDateKey);
  const to = date(c.toDateKey);
  if (from && to && from <= to) {
    const phases = arr(c.phases, 12).flatMap((p) => {
      const r = obj(p);
      const a = date(r.fromDateKey);
      const b = date(r.toDateKey);
      return a && b && a <= b ? [{ label: s(r.label, 100), fromDateKey: a, toDateKey: b }] : [];
    });
    const usePhases = phases.length > 0 ? phases : phasesFor(from, to);
    cycle = {
      label: s(c.label, 200),
      fromDateKey: from,
      toDateKey: to,
      phases: usePhases,
      outcomes: arr(c.outcomes, 30).flatMap((x) => {
        const r = obj(x);
        const target = s(r.target, 5000);
        const goal = goalRef(r.goal);
        if (!target && !goal) return [];
        const texts = arr(r.phaseTexts, usePhases.length).map((t) => s(t, 2000));
        return [{ goal, area: goal ?? "", target, evidence: s(r.evidence, 5000), hoursNote: s(r.hoursNote, 500), phaseTexts: texts }];
      }),
    };
  }
  const slots: DraftSlot[] = arr(o.slots, 120).flatMap((x) => {
    const r = obj(x);
    const weekday = Number(r.weekday);
    const startTime = s(r.startTime, 5);
    const endTime = s(r.endTime, 5);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !PLAN_TIME.test(startTime) || !PLAN_TIME.test(endTime) || startTime >= endTime) return [];
    return [{ weekday, startTime, endTime, goal: goalRef(r.goal), label: s(r.label, 200), commute: r.commute === true }];
  });
  const events: DraftEvent[] = arr(o.events, 100).flatMap((x) => {
    const r = obj(x);
    const title = s(r.title, 300);
    const dateKey = date(r.dateKey);
    if (!title || !dateKey) return [];
    let endDateKey = date(r.endDateKey);
    if (endDateKey && endDateKey < dateKey) endDateKey = null;
    const kind = s(r.kind, 20).toUpperCase();
    return [
      {
        kind: (EVENT_KINDS as readonly string[]).includes(kind) ? kind : "EVENT",
        title,
        dateKey,
        endDateKey,
        goal: goalRef(r.goal),
        confirmed: r.confirmed === true,
        note: s(r.note, 2000),
      },
    ];
  });
  const checks: DraftCheck[] = arr(o.checks, 60).flatMap((x) => {
    const r = obj(x);
    const question = s(r.question, 1000);
    return question ? [{ question, method: s(r.method, 2000), impact: s(r.impact, 2000), goal: goalRef(r.goal), dueDateKey: date(r.dueDateKey) }] : [];
  });
  const tasks: DraftTask[] = arr(o.tasks, 60).flatMap((x) => {
    const r = obj(x);
    const text = s(r.text, 1000);
    return text ? [{ text, goal: goalRef(r.goal), dueDateKey: date(r.dueDateKey) }] : [];
  });
  return { cycle, slots, events, checks, tasks };
}

const amount = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 0 && x <= 10_000 ? Math.round(x * 100) / 100 : 0;
};

function parseDetail(value: unknown): DraftSubPlan[] {
  return arr(obj(value).subPlans, 10).flatMap((x) => {
    const r = obj(x);
    const title = s(r.title, 200);
    if (!title) return [];
    const items: DraftItem[] = arr(r.items, 120).flatMap((y) => {
      const i = obj(y);
      const t = s(i.title, 300);
      if (!t) return [];
      let fromDateKey = date(i.fromDateKey);
      const toDateKey = date(i.toDateKey);
      if (fromDateKey && toDateKey && fromDateKey > toDateKey) fromDateKey = null;
      const status = s(i.status, 20).toUpperCase();
      return [
        {
          group: s(i.group, 100),
          code: s(i.code, 40),
          title: t,
          kind: s(i.kind, 60),
          size: amount(i.size),
          status: (ITEM_STATUSES as readonly string[]).includes(status) ? status : "PLANNED",
          record: s(i.record, 1000),
          periodLabel: s(i.periodLabel, 300),
          fromDateKey,
          toDateKey,
          note: s(i.note, 3000),
        },
      ];
    });
    const steps: DraftStep[] = arr(r.steps, 400).flatMap((y) => {
      const st = obj(y);
      const label = s(st.label, 300);
      const dateKey = date(st.dateKey);
      if (!label || !dateKey) return [];
      let startDateKey = date(st.startDateKey);
      if (startDateKey && startDateKey > dateKey) startDateKey = null;
      let backupDateKey = date(st.backupDateKey);
      if (backupDateKey && backupDateKey < dateKey) backupDateKey = null;
      const kind = s(st.kind, 20).toUpperCase();
      return [{ item: goalRef(st.item), label, kind: (STEP_KINDS as readonly string[]).includes(kind) ? kind : startDateKey ? "WORK" : "OTHER", startDateKey, dateKey, backupDateKey, note: s(st.note, 2000) }];
    });
    const weekColumns = arr(r.weekColumns, 12).map((c) => s(c, 100));
    const weeks: WeekRow[] = arr(r.weeks, 80).map((y) => {
      const w = obj(y);
      return { label: s(w.label, 100), fromDateKey: date(w.fromDateKey), toDateKey: date(w.toDateKey), cells: arr(w.cells, 12).map((c) => s(c, 1500)) };
    });
    const days: DayRow[] = arr(r.days, 60).flatMap((y) => {
      const d = obj(y);
      const dateKey = date(d.dateKey);
      return dateKey ? [{ dateKey, time: s(d.time, 300), work: s(d.work, 2000), output: s(d.output, 1000) }] : [];
    });
    return [{ goal: goalRef(r.goal), title, summary: s(r.summary, 5000), unitLabel: s(r.unitLabel, 20), targetTotal: amount(r.targetTotal), baseDone: amount(r.baseDone), items, steps, weekColumns, weeks, days }];
  });
}

/** Checks a whole draft — the browser sends it back to be applied, so it
 * is checked again rather than trusted. */
export function parsePlanDraft(value: unknown): PlanDraft {
  const o = obj(value);
  const shape = parseShape(o);
  const run = parseRun(o);
  return { ...shape, ...run, subPlans: parseDetail(o) };
}

/**
 * Which goal a name from the second reading means. The two readings name
 * areas a little differently ("IT" / "ITの専門性", "英語・修士" / "英語"), so
 * this tries the exact name, then either name containing the other, then
 * the most shared characters.
 */
export function matchGoalTitle(name: string, titles: string[]): string | null {
  const key = titleKey(name);
  if (!key) return null;
  const keys = titles.map((t) => ({ t, k: titleKey(t) }));
  const exact = keys.find((x) => x.k === key);
  if (exact) return exact.t;
  const contains = keys.filter((x) => x.k.includes(key) || key.includes(x.k)).sort((a, b) => Math.abs(a.k.length - key.length) - Math.abs(b.k.length - key.length));
  if (contains.length > 0) return contains[0].t;
  // Split on the separators areas are named with ("・", "／") and match a part.
  const parts = name.split(/[・／/、,＆&]+/).map((p) => titleKey(p)).filter((p) => p.length >= 2);
  for (const part of parts) {
    const hit = keys.find((x) => x.k.includes(part) || part.includes(x.k));
    if (hit) return hit.t;
  }
  return null;
}

/* ---------- reading ---------- */

function progressFromShape(text: string): ChatProgress {
  const start = text.search(/"goals"\s*:\s*\[/);
  const items: ProgressItem[] = [];
  if (start !== -1) {
    // Goal titles come first in each goal; phases use "label", not "title".
    for (const m of text.slice(start).matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      items.push({ dateKey: "", slot: null, title: partialString(`{"t":"${m[1]}"}`, "t") });
    }
  }
  return { stage: "writing", reply: partialString(text, "summary"), items };
}

export async function draftPlanImport(ownerSub: string, text: string, todayKey: string, onProgress?: (p: ChatProgress) => void): Promise<PlanDraft> {
  const source = text.trim();
  if (!source) throw new ValidationError("goalImportEmpty", "nothing to import");
  if (source.length > MAX_SOURCE) throw new ValidationError("goalImportTooLong", "import text too long");
  onProgress?.({ stage: "context", reply: "", items: [] });
  const existing = await prisma.goal.findMany({ where: { ownerSub, status: "ACTIVE" }, select: { title: true }, orderBy: { sortOrder: "asc" } });
  const brief = [
    `今日: ${todayKey}`,
    existing.length > 0 ? `既にある領域（同じ領域を指すときはこの名前を使う）: ${existing.map((g) => g.title).join("、")}` : "",
    "",
    "文書:",
    source,
  ].join("\n");
  let writing = false;
  const [shapeReply, runReply, detailReply] = await Promise.all([
    askForJson(
      ownerSub,
      SHAPE_PROMPT,
      brief,
      16000,
      undefined,
      onProgress &&
        ((p) => {
          if (p.kind === "thinking") {
            if (!writing) onProgress({ stage: "thinking", reply: "", items: [] });
            return;
          }
          writing = true;
          onProgress(progressFromShape(p.text));
        }),
    ),
    askForJson(ownerSub, RUN_PROMPT, brief, 16000),
    askForJson(ownerSub, DETAIL_PROMPT, brief, 64000),
  ]);
  const shape = parseShape(shapeReply.value);
  const run = parseRun(runReply.value);
  const subPlans = parseDetail(detailReply.value);
  if (shape.goals.length === 0 && !shape.vision && !run.cycle && run.slots.length === 0 && subPlans.length === 0) {
    throw new AiJsonError(shapeReply.truncated || runReply.truncated ? "truncated" : "invalidResponse", "nothing readable");
  }
  // Point the second reading's area names at the first reading's goals.
  const titles = [...shape.goals.map((g) => g.title), ...(shape.area ? [shape.area] : [])];
  const fix = (name: string | null) => (name ? (matchGoalTitle(name, titles) ?? name) : null);
  const draft: PlanDraft = {
    ...shape,
    cycle: run.cycle ? { ...run.cycle, outcomes: run.cycle.outcomes.map((o) => ({ ...o, goal: fix(o.goal) })) } : null,
    slots: run.slots.map((x) => ({ ...x, goal: fix(x.goal) })),
    events: run.events.map((x) => ({ ...x, goal: fix(x.goal) })),
    checks: run.checks.map((x) => ({ ...x, goal: fix(x.goal) })),
    tasks: run.tasks.map((x) => ({ ...x, goal: fix(x.goal) })),
    subPlans: subPlans.map((p) => ({ ...p, goal: fix(p.goal) ?? shape.area })),
  };
  onProgress?.({ stage: "saving", reply: draft.summary, items: [] });
  return draft;
}

/* ---------- applying ---------- */

export interface ImportCounts {
  goalsCreated: number;
  goalsUpdated: number;
  phases: number;
  slots: number;
  events: number;
  checks: number;
  tasks: number;
  archived: number;
  subPlans: number;
  items: number;
  steps: number;
}

/**
 * Writes an import in.
 *
 *   - The plan's own texts are replaced by the document's where it has them.
 *   - A goal whose name is already here is updated (its phases added to,
 *     not replaced); a new name makes a new goal with the next colour.
 *     With `archiveOthers`, active goals the document doesn't name go to
 *     the archive — for a document that is now the whole plan.
 *   - The cycle is added (or, with the same dates, has its targets
 *     replaced); the standard week, when the document has one, replaces
 *     the current one; dates, questions and tasks are added, skipping ones
 *     already here.
 *   - The change log records the import.
 */
export interface ApplyOptions {
  archiveOthers: boolean;
  /**
   * The document is the whole plan from now on (a rewrite): goals it doesn't
   * name are archived, and the unfinished phases, tasks, open questions and
   * coming dates it no longer has are replaced by its own. What's done and
   * what's recorded stays.
   */
  replace?: boolean;
  /** The document it was read from, kept as a version of the 計画書. */
  document?: { markdown: string; source: "ADVISOR" | "IMPORT" };
}

export async function applyPlanImport(ownerSub: string, input: unknown, todayKey: string, options: ApplyOptions): Promise<ImportCounts> {
  const draft = parsePlanDraft(input);
  const replace = options.replace === true;
  const area = draft.scope === "area";
  // An area's document never archives the other areas.
  const archiveOthers = !area && (options.archiveOthers || replace);
  const counts: ImportCounts = { goalsCreated: 0, goalsUpdated: 0, phases: 0, slots: 0, events: 0, checks: 0, tasks: 0, archived: 0, subPlans: 0, items: 0, steps: 0 };
  await prisma.$transaction(async (tx) => {
    // The plan's own texts belong to the whole plan, not to one area's document.
    const planData = area ? {} : {
      ...(draft.title ? { title: draft.title } : {}),
      ...(draft.vision ? { vision: draft.vision } : {}),
      ...(draft.baseline ? { baseline: draft.baseline } : {}),
      ...(draft.decisionRules ? { decisionRules: draft.decisionRules } : {}),
      ...(draft.lifeBudget.length > 0 ? { lifeBudget: draft.lifeBudget as unknown as Prisma.InputJsonValue } : {}),
      ...(draft.routine ? { routine: draft.routine as unknown as Prisma.InputJsonValue } : {}),
    };
    await tx.goalPlan.upsert({ where: { ownerSub }, create: { ownerSub, ...planData }, update: planData });

    const existing = await tx.goal.findMany({ where: { ownerSub }, include: { milestones: true }, orderBy: { sortOrder: "asc" } });
    const byKey = new Map(existing.map((g) => [titleKey(g.title), g]));
    let order = existing.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
    const usedColors = new Set(existing.map((g) => g.color).filter(Boolean));
    const nextColor = () => {
      const c = GOAL_COLORS.find((x) => !usedColors.has(x.name)) ?? GOAL_COLORS[usedColors.size % GOAL_COLORS.length];
      usedColors.add(c.name);
      return c.name;
    };
    const idByTitle = new Map<string, string>();
    const named = new Set<string>();
    // An area's document is about one goal: the one it names, matched to
    // what's here; its phases stay as the roadmap has them.
    const existingTitles = existing.map((g) => g.title);
    const areaName = area ? (draft.area ?? draft.goals[0]?.title ?? draft.subPlans[0]?.goal ?? null) : null;
    const areaTitle = areaName ? (matchGoalTitle(areaName, existingTitles) ?? areaName) : null;
    const goalsToWrite = area
      ? areaTitle
        ? [{ ...(draft.goals.find((g) => matchGoalTitle(g.title, [areaTitle]) !== null) ?? { ...BLANK_GOAL, title: areaTitle }), title: areaTitle, phases: [] }]
        : []
      : draft.goals;
    for (const g of goalsToWrite) {
      const fields = {
        statement: g.statement,
        approach: g.approach,
        weeklyHours: g.weeklyHours,
        commuteHours: g.commuteHours,
        budgetNote: g.budgetNote,
        keepRecord: g.keepRecord,
        improveCheck: g.improveCheck,
      };
      const found = byKey.get(titleKey(g.title));
      let goalId: string;
      let have: { label: string; startDateKey: string | null; dueDateKey: string | null }[] = [];
      if (found) {
        goalId = found.id;
        have = found.milestones;
        if (replace && g.phases.length > 0) {
          // The document's phases stand in for the open ones; finished ones are history.
          await tx.goalMilestone.deleteMany({ where: { goalId, doneAt: null } });
          have = found.milestones.filter((m) => m.doneAt !== null);
        }
        // Only what the document says; a blank there leaves the field.
        const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => (typeof v === "number" ? v > 0 : v !== "")));
        await tx.goal.update({ where: { id: goalId }, data: { ...set, status: "ACTIVE", ...(found.color ? {} : { color: nextColor() }) } });
        counts.goalsUpdated++;
      } else {
        goalId = (await tx.goal.create({ data: { ownerSub, title: g.title, ...fields, color: nextColor(), reviewedOnDateKey: todayKey, sortOrder: order++ } })).id;
        counts.goalsCreated++;
      }
      idByTitle.set(g.title, goalId);
      named.add(goalId);
      const fresh = g.phases.filter((p) => !have.some((h) => h.label === p.label && h.startDateKey === p.startDateKey && h.dueDateKey === p.dueDateKey));
      if (fresh.length > 0) {
        await tx.goalMilestone.createMany({
          data: fresh.map((p, i) => ({
            goalId,
            label: p.label,
            startDateKey: p.startDateKey,
            dueDateKey: p.dueDateKey,
            condition: p.condition,
            sortOrder: have.length + i,
          })),
        });
        counts.phases += fresh.length;
      }
    }
    if (archiveOthers) {
      const others = existing.filter((g) => g.status === "ACTIVE" && !named.has(g.id)).map((g) => g.id);
      if (others.length > 0) {
        await tx.goal.updateMany({ where: { id: { in: others } }, data: { status: "ARCHIVED" } });
        counts.archived = others.length;
      }
    }
    const allGoals = await tx.goal.findMany({ where: { ownerSub }, select: { id: true, title: true } });
    const resolve = (name: string | null) => {
      if (!name) return null;
      const exact = idByTitle.get(name);
      if (exact) return exact;
      const t = matchGoalTitle(name, allGoals.map((g) => g.title));
      return t ? (allGoals.find((g) => g.title === t)?.id ?? null) : null;
    };

    const areaGoalId = areaTitle ? (idByTitle.get(areaTitle) ?? null) : null;

    if (draft.cycle && !area) {
      const c = draft.cycle;
      const same = await tx.goalCycle.findFirst({ where: { ownerSub, fromDateKey: c.fromDateKey, toDateKey: c.toDateKey } });
      const cycleId = same
        ? (await tx.goalCycle.update({ where: { id: same.id }, data: { label: c.label, phases: c.phases as unknown as Prisma.InputJsonValue } })).id
        : (await tx.goalCycle.create({ data: { ownerSub, label: c.label, fromDateKey: c.fromDateKey, toDateKey: c.toDateKey, phases: c.phases as unknown as Prisma.InputJsonValue } })).id;
      await tx.goalCycleOutcome.deleteMany({ where: { cycleId } });
      if (c.outcomes.length > 0) {
        await tx.goalCycleOutcome.createMany({
          data: c.outcomes.map((o, i) => {
            const goalId = resolve(o.goal);
            return {
              cycleId,
              goalId,
              area: goalId ? "" : o.area,
              target: o.target,
              evidence: o.evidence,
              hoursNote: o.hoursNote,
              phaseTexts: o.phaseTexts as unknown as Prisma.InputJsonValue,
              sortOrder: i,
            };
          }),
        });
      }
    }

    if (area && areaGoalId) {
      // The area's own blocks of the week, in place of the ones it had.
      const own = draft.slots.filter((x) => !x.goal || resolve(x.goal) === areaGoalId);
      if (own.length > 0) {
        await tx.goalWeekSlot.deleteMany({ where: { ownerSub, goalId: areaGoalId } });
        await tx.goalWeekSlot.createMany({
          data: own.map((x) => ({ ownerSub, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime, goalId: areaGoalId, label: x.label, commute: x.commute })),
        });
        counts.slots = own.length;
      }
    } else if (draft.slots.length > 0) {
      await tx.goalWeekSlot.deleteMany({ where: { ownerSub } });
      await tx.goalWeekSlot.createMany({
        data: draft.slots.map((x) => ({ ownerSub, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime, goalId: resolve(x.goal), label: x.label, commute: x.commute })),
      });
      counts.slots = draft.slots.length;
    }

    if (replace && (!area || areaGoalId)) {
      // For an area, only what's tied to that area is replaced.
      const scoped = area ? { goalId: areaGoalId } : {};
      const keepEvent = (e: { title: string; dateKey: string }) => draft.events.some((x) => x.title === e.title && x.dateKey === e.dateKey);
      const future = await tx.goalEvent.findMany({ where: { ownerSub, ...scoped, done: false, dateKey: { gte: todayKey } }, select: { id: true, title: true, dateKey: true } });
      const dropEvents = future.filter((e) => !keepEvent(e)).map((e) => e.id);
      if (dropEvents.length > 0) await tx.goalEvent.deleteMany({ where: { id: { in: dropEvents } } });
      if (draft.tasks.length > 0) await tx.goalTask.deleteMany({ where: { ownerSub, ...scoped, doneAt: null, text: { notIn: draft.tasks.map((t) => t.text) } } });
      if (draft.checks.length > 0) await tx.goalCheck.deleteMany({ where: { ownerSub, ...scoped, doneAt: null, question: { notIn: draft.checks.map((c) => c.question) } } });
    }

    const [events, checks, tasks] = await Promise.all([
      tx.goalEvent.findMany({ where: { ownerSub }, select: { title: true, dateKey: true } }),
      tx.goalCheck.findMany({ where: { ownerSub }, select: { question: true } }),
      tx.goalTask.findMany({ where: { ownerSub }, select: { text: true, sortOrder: true } }),
    ]);
    const newEvents = draft.events.filter((e) => !events.some((x) => x.title === e.title && x.dateKey === e.dateKey));
    if (newEvents.length > 0) {
      await tx.goalEvent.createMany({
        data: newEvents.map((e) => ({ ownerSub, goalId: resolve(e.goal), kind: e.kind, title: e.title, dateKey: e.dateKey, endDateKey: e.endDateKey, confirmed: e.confirmed, note: e.note })),
      });
    }
    counts.events = newEvents.length;
    const newChecks = draft.checks.filter((c) => !checks.some((x) => x.question === c.question));
    if (newChecks.length > 0) {
      await tx.goalCheck.createMany({
        data: newChecks.map((c) => ({ ownerSub, goalId: resolve(c.goal), question: c.question, method: c.method, impact: c.impact, dueDateKey: c.dueDateKey })),
      });
    }
    counts.checks = newChecks.length;
    const newTasks = draft.tasks.filter((t) => !tasks.some((x) => x.text === t.text));
    const lastTask = tasks.reduce((m, t) => Math.max(m, t.sortOrder), -1);
    if (newTasks.length > 0) {
      await tx.goalTask.createMany({
        data: newTasks.map((t, i) => ({ ownerSub, goalId: resolve(t.goal), text: t.text, dueDateKey: t.dueDateKey, sortOrder: lastTask + 1 + i })),
      });
    }
    counts.tasks = newTasks.length;

    let firstSubPlanId: string | null = null;
    for (const sp of draft.subPlans) {
      const goalId = area ? areaGoalId : resolve(sp.goal);
      const id = await writeSubPlan(tx, ownerSub, goalId, sp, replace, counts);
      firstSubPlanId ??= id;
    }

    await addChange(
      ownerSub,
      {
        dateKey: todayKey,
        before: "",
        after: `${area ? `${areaTitle ?? ""}の詳細計画を${replace ? "書き換え" : "取り込み"}: 科目・項目${counts.items}、工程${counts.steps}、` : replace ? "計画を全体で書き換え: " : "文書から取り込み: "}目標 新規${counts.goalsCreated}・更新${counts.goalsUpdated}、段階${counts.phases}、時間枠${counts.slots}、日付${counts.events}、確認事項${counts.checks}、タスク${counts.tasks}${counts.archived ? `、アーカイブ${counts.archived}` : ""}`,
        reason: draft.title || draft.summary,
        checkDateKey: null,
      },
      options.document?.source === "ADVISOR" ? "ADVISOR" : "IMPORT",
      tx,
    );
    if (options.document && (!area || firstSubPlanId)) {
      await savePlanDocument(ownerSub, options.document.markdown, options.document.source, replace ? "FULL" : "MERGE", tx, area ? firstSubPlanId : null);
    }
  }, TRANSACTION_OPTIONS);
  return counts;
}

const ITEM_FIELDS = ["group", "code", "title", "kind", "size", "status", "record", "periodLabel", "fromDateKey", "toDateKey", "note"] as const satisfies readonly (keyof DraftItem)[];

const BLANK_GOAL: DraftGoal = { title: "", statement: "", approach: "", weeklyHours: 0, commuteHours: 0, budgetNote: "", keepRecord: "", improveCheck: "", phases: [] };

/**
 * Writes one detailed plan. A plan with the same name under the same goal
 * is the same plan: rewritten whole with `replace`, otherwise its items are
 * updated by code (or title), new ones and new steps added. Returns its id.
 */
async function writeSubPlan(tx: Prisma.TransactionClient, ownerSub: string, goalId: string | null, sp: DraftSubPlan, replace: boolean, counts: ImportCounts): Promise<string> {
  const same = (await tx.goalSubPlan.findMany({ where: { ownerSub, goalId }, include: { items: true, steps: true } })).find((p) => titleKey(p.title) === titleKey(sp.title));
  const fields = {
    title: sp.title,
    ...(sp.summary ? { summary: sp.summary } : {}),
    ...(sp.unitLabel ? { unitLabel: sp.unitLabel } : {}),
    ...(sp.targetTotal > 0 ? { targetTotal: sp.targetTotal } : {}),
    ...(sp.baseDone > 0 ? { baseDone: sp.baseDone } : {}),
    ...(sp.weeks.length > 0 ? { weekColumns: sp.weekColumns as unknown as Prisma.InputJsonValue, weeks: sp.weeks as unknown as Prisma.InputJsonValue } : {}),
    ...(sp.days.length > 0 ? { days: sp.days as unknown as Prisma.InputJsonValue } : {}),
  };
  let planId: string;
  let items: (DraftItem & { id: string; sortOrder: number })[] = [];
  let steps: { itemId: string | null; label: string; dateKey: string }[] = [];
  if (same) {
    planId = same.id;
    await tx.goalSubPlan.update({ where: { id: planId }, data: fields });
    if (replace) {
      await tx.goalItemStep.deleteMany({ where: { subPlanId: planId } });
      await tx.goalItem.deleteMany({ where: { subPlanId: planId } });
    } else {
      items = same.items;
      steps = same.steps;
    }
  } else {
    const last = await tx.goalSubPlan.findFirst({ where: { ownerSub }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    planId = (await tx.goalSubPlan.create({ data: { ownerSub, goalId, ...fields, sortOrder: (last?.sortOrder ?? -1) + 1 } })).id;
    counts.subPlans++;
  }
  // The ledger is written in two statements, whatever its length: on the
  // hosted database every query is a network round trip, and one per item
  // ran a 30-course ledger past the request's time limit.
  const key = (code: string, title: string) => (code ? `c:${code}` : `t:${titleKey(title)}`);
  const byKey = new Map(items.map((i) => [key(i.code, i.title), i]));
  let order = items.reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1;
  const created: (DraftItem & { id: string; subPlanId: string; sortOrder: number })[] = [];
  const changedById = new Map<string, DraftItem & { id: string }>();
  for (const it of sp.items) {
    const k = key(it.code, it.title);
    const found = byKey.get(k) ?? byKey.get(key("", it.title));
    if (found) {
      // Only what the document actually changed is written back.
      const next = { ...found, ...it };
      if (changedById.has(found.id) || ITEM_FIELDS.some((f) => found[f] !== it[f])) changedById.set(found.id, next);
      byKey.set(k, next);
    } else {
      const row = { ...it, id: randomUUID(), subPlanId: planId, sortOrder: order++ };
      created.push(row);
      byKey.set(k, row);
      byKey.set(key("", it.title), row);
    }
    counts.items++;
  }
  if (created.length > 0) await tx.goalItem.createMany({ data: created });
  const changed = [...changedById.values()];
  if (changed.length > 0) {
    const col = <K extends keyof DraftItem>(f: K) => changed.map((c) => c[f]);
    await tx.$executeRaw`
      UPDATE goal_item AS g SET
        "group" = v.grp, code = v.code, title = v.title, kind = v.kind, size = v.size, status = v.status,
        record = v.record, period_label = v.period_label, from_date_key = v.from_date_key, to_date_key = v.to_date_key, note = v.note
      FROM unnest(
        ${changed.map((c) => c.id)}::text[], ${col("group")}::text[], ${col("code")}::text[], ${col("title")}::text[], ${col("kind")}::text[],
        ${col("size")}::float8[], ${col("status")}::text[], ${col("record")}::text[], ${col("periodLabel")}::text[],
        ${col("fromDateKey")}::text[], ${col("toDateKey")}::text[], ${col("note")}::text[]
      ) AS v(id, grp, code, title, kind, size, status, record, period_label, from_date_key, to_date_key, note)
      WHERE g.id = v.id AND g.sub_plan_id = ${planId}`;
  }
  // A step names its item by code or title, as the document does.
  const all = [...new Map([...byKey.values()].map((i) => [i.id, i])).values()];
  const itemOf = (name: string | null) => {
    if (!name) return null;
    const n = titleKey(name);
    const hit = all.find((i) => (i.code && titleKey(i.code) === n) || titleKey(i.title) === n);
    if (hit) return hit.id;
    const t = matchGoalTitle(name, all.map((i) => i.title));
    return t ? (all.find((i) => i.title === t)?.id ?? null) : null;
  };
  const fresh = sp.steps
    .map((st, i) => ({ subPlanId: planId, itemId: itemOf(st.item), label: st.label, kind: st.kind, startDateKey: st.startDateKey, dateKey: st.dateKey, backupDateKey: st.backupDateKey, note: st.note, sortOrder: i }))
    .filter((st) => !steps.some((x) => x.label === st.label && x.dateKey === st.dateKey && x.itemId === st.itemId));
  if (fresh.length > 0) await tx.goalItemStep.createMany({ data: fresh });
  counts.steps += fresh.length;
  return planId;
}

/* ---------- the mermaid gantt, read without the model ---------- */

export interface GanttSection {
  section: string;
  bars: { label: string; startDateKey: string; dueDateKey: string }[];
}

/**
 * Reads a ```mermaid gantt block: sections and their bars, with dates
 * given either as start and end, or start and a length in days. The import
 * itself leaves this to the model (it has to decide which goal a bar
 * belongs to); this is for showing a document's chart on its own, and is
 * what the tests check the model's dates against.
 */
export function parseMermaidGantt(markdown: string): GanttSection[] {
  const block = /```mermaid\s*\n\s*gantt([\s\S]*?)```/.exec(markdown)?.[1];
  if (!block) return [];
  const out: GanttSection[] = [];
  let current: GanttSection | null = null;
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line || /^(title|dateFormat|axisFormat|excludes|todayMarker)\b/.test(line)) continue;
    const section = /^section\s+(.+)$/.exec(line);
    if (section) {
      current = { section: section[1].trim(), bars: [] };
      out.push(current);
      continue;
    }
    const bar = /^(.+?)\s*:\s*(.+)$/.exec(line);
    if (!bar || !current) continue;
    const parts = bar[2].split(",").map((p) => p.trim());
    const dates = parts.filter((p) => PLAN_DATE_KEY.test(p));
    const length = parts.find((p) => /^\d+d$/.test(p));
    if (dates.length >= 2) current.bars.push({ label: bar[1].trim(), startDateKey: dates[0], dueDateKey: dates[1] });
    else if (dates.length === 1 && length) {
      const end = new Date(`${dates[0]}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + Number(length.slice(0, -1)) - 1);
      current.bars.push({ label: bar[1].trim(), startDateKey: dates[0], dueDateKey: end.toISOString().slice(0, 10) });
    }
  }
  return out;
}
