import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import type { ChatProgress, ProgressItem } from "@/lib/chatProgress";
import { partialString } from "@/lib/chatProgress";
import { localTimeUtc, shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import * as googleCalendar from "@/lib/googleCalendar";
import * as mealPlanning from "@/lib/mealPlanning";
import * as training from "@/lib/training";
import { goalColor } from "@/lib/goalColors";
import { weekStartOn, weekStartWeekday, todayPlan } from "@/lib/goalPlan";
import { minutesOfTime, timeOfMinutes, toRoutine, type Routine } from "@/lib/routine";

/**
 * One day's plan, the last step from the goals to the day itself: the
 * day's blocks — sleep, work and the commute, the goals' blocks, meals,
 * appointments already in the calendar — laid out on the clock.
 *
 *   draft    built from the routine (sleep, work, commute), the standard
 *            week's blocks for that weekday, the meal plan, the calendar's
 *            own events, and the detailed plans' row for the day;
 *   consult  the advisor proposes the whole day again from what's due,
 *            what the week still needs, and what the owner says; applying
 *            replaces the blocks;
 *   write    the blocks go into Google Calendar (or the app's own time
 *            blocks when it isn't linked). Writing again updates the same
 *            events — the ones written are remembered by their time and title.
 */

export const BLOCK_KINDS = ["SLEEP", "WORK", "COMMUTE", "GOAL", "MEAL", "EVENT", "LIFE", "BREAK", "OTHER"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface DayBlock {
  id: string;
  /** "HH:MM"; end may be "24:00". */
  start: string;
  end: string;
  title: string;
  kind: BlockKind;
  goalId: string | null;
  note: string;
  /** An appointment from the calendar itself — shown, never written back. */
  fixed: boolean;
  /** Whether "write to the calendar" includes it. */
  push: boolean;
}

export interface DayPlanView {
  dateKey: string;
  /** False while it's only the draft, not saved. */
  saved: boolean;
  blocks: DayBlock[];
  note: string;
  pushedTo: string;
  pushedAt: string | null;
  routine: Routine;
  routineSet: boolean;
  /** What the day holds that the blocks are built from. */
  context: {
    dayRows: { title: string; goalId: string | null; time: string; work: string; output: string }[];
    steps: { label: string; itemTitle: string; kind: string; dateKey: string; goalId: string | null }[];
    training: { title: string; minutes: number }[];
    calendar: "linked" | "not_linked" | "unavailable";
    /** The day's planned meals, so a meal block can open its recipe. */
    meals: { id: string; title: string; kind: string }[];
  };
  goals: { id: string; title: string; hex: string }[];
}

const MAX_BLOCKS = 60;
const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_TURNS = 16;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

let counter = 0;
const newId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const kindOf = (v: unknown): BlockKind => ((BLOCK_KINDS as readonly string[]).includes(String(v).toUpperCase()) ? (String(v).toUpperCase() as BlockKind) : "OTHER");

/** Blocks from storage, the browser or the model, checked and in order. */
export function toBlocks(value: unknown, goalIds: Set<string>): DayBlock[] {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_BLOCKS)
    .flatMap((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const start = s(r.start, 5);
      const end = s(r.end, 5);
      const title = s(r.title, 200);
      if (!TIME.test(start) || !TIME.test(end) || start === "24:00" || minutesOfTime(end) <= minutesOfTime(start) || !title) return [];
      const kind = kindOf(r.kind);
      const goalId = typeof r.goalId === "string" && goalIds.has(r.goalId) ? r.goalId : null;
      return [
        {
          id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : newId(),
          start,
          end,
          title,
          kind,
          goalId,
          note: s(r.note, 1000),
          fixed: r.fixed === true,
          push: typeof r.push === "boolean" ? r.push : kind !== "SLEEP" && r.fixed !== true,
        },
      ];
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

async function goalsOf(ownerSub: string) {
  const rows = await prisma.goal.findMany({ where: { ownerSub }, select: { id: true, title: true, color: true, status: true, weeklyHours: true }, orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((g, i) => ({ ...g, hex: goalColor(g.color, i).hex }));
}

async function calendarEvents(ownerSub: string, dateKey: string, timeZone: string) {
  try {
    return { state: "linked" as const, events: await googleCalendar.listDayEvents(ownerSub, dateKey, timeZone) };
  } catch (e) {
    if (e instanceof googleCalendar.GoogleCalendarNotLinkedError) return { state: "not_linked" as const, events: [] };
    return { state: "unavailable" as const, events: [] };
  }
}

/** The day built from what's known, before anyone has talked it over. */
async function draft(ownerSub: string, dateKey: string, timeZone: string, routine: Routine, pushedIds: Set<string>) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const day = routine.days.find((d) => d.weekday === weekday)!;
  const blocks: Omit<DayBlock, "id">[] = [];
  const add = (start: number, end: number, title: string, kind: BlockKind, extra: Partial<DayBlock> = {}) => {
    if (end > start) blocks.push({ start: timeOfMinutes(start), end: timeOfMinutes(end), title, kind, goalId: null, note: "", fixed: false, push: kind !== "SLEEP", ...extra });
  };
  const bed = minutesOfTime(routine.bed);
  const wake = minutesOfTime(routine.wake);
  if (bed > wake) {
    add(0, wake, "睡眠", "SLEEP");
    add(bed, 1440, "睡眠", "SLEEP");
  } else add(bed, wake, "睡眠", "SLEEP");
  if (day.work) {
    const start = minutesOfTime(day.start);
    const end = minutesOfTime(day.end);
    add(start, end, day.office ? "仕事（出社）" : "仕事（在宅）", "WORK");
    if (day.office && day.commuteMinutes > 0) {
      add(start - day.commuteMinutes, start, "通勤", "COMMUTE");
      add(end, end + day.commuteMinutes, "通勤", "COMMUTE");
    }
  }

  const [slots, meals, cal, plan, sessions, ownBlocks] = await Promise.all([
    prisma.goalWeekSlot.findMany({ where: { ownerSub, weekday }, orderBy: { startTime: "asc" } }),
    mealPlanning.scheduledMealsForDay(ownerSub, dateKey, timeZone).catch(() => []),
    calendarEvents(ownerSub, dateKey, timeZone),
    todayPlan(ownerSub, dateKey),
    training.sessionsBetween(ownerSub, dateKey, dateKey).catch(() => []),
    // Time set aside by hand on the calendar (not the ones this plan wrote).
    prisma.timeBlock.findMany({ where: { ownerSub, dateKey, source: "" } }),
  ]);
  const titleOf = new Map(plan.goals.map((g) => [g.id, g.title]));
  for (const slot of slots) {
    const row = plan.dayRows.find((r) => r.goalId === slot.goalId);
    const due = plan.steps.filter((st) => st.goalId === slot.goalId && st.dateKey === dateKey);
    const note = [row ? `${row.row.work}` : "", ...due.map((st) => `${st.itemTitle} ${st.label}`)].filter(Boolean).join(" ／ ");
    add(minutesOfTime(slot.startTime), minutesOfTime(slot.endTime), slot.label || (slot.goalId ? (titleOf.get(slot.goalId) ?? "") : "") || "目標", "GOAL", {
      goalId: slot.goalId,
      note: `${slot.commute ? "通勤中 " : ""}${note}`.trim(),
    });
  }
  for (const m of meals) add(localMinutes(m.start, timeZone), localMinutes(m.end, timeZone) || 1440, m.meal.title, "MEAL");
  if (meals.length === 0 && day.work) add(720, 780, "昼休み", "MEAL");
  for (const e of cal.events) {
    if (e.allDay || !e.start || !e.end || pushedIds.has(e.id)) continue;
    add(localMinutes(e.start, timeZone), localMinutes(e.end, timeZone) || 1440, e.title, "EVENT", { fixed: true, push: false, note: e.location ?? "" });
  }
  for (const tb of ownBlocks) add(tb.startMinutes, Math.min(1440, tb.startMinutes + tb.durationMinutes), tb.title, "EVENT", { fixed: true, push: false });
  return {
    blocks: blocks.map((b) => ({ ...b, id: newId() })).sort((a, b) => a.start.localeCompare(b.start)),
    cal,
    plan,
    sessions,
    meals: meals.map((m) => m.meal),
  };
}

type Pushed = { key: string; eventId: string }[];
const pushedOf = (v: unknown): Pushed =>
  (Array.isArray(v) ? v : []).flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    return typeof r.key === "string" && typeof r.eventId === "string" ? [{ key: r.key, eventId: r.eventId }] : [];
  });
const keyOf = (b: Pick<DayBlock, "start" | "end" | "title">) => `${b.start}|${b.end}|${b.title}`;

export async function getDayPlan(ownerSub: string, dateKey: string, timeZone: string): Promise<DayPlanView> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new ValidationError("goalInvalid", "bad date");
  const [row, planRow, goals] = await Promise.all([
    prisma.goalDayPlan.findUnique({ where: { ownerSub_dateKey: { ownerSub, dateKey } } }),
    prisma.goalPlan.findUnique({ where: { ownerSub }, select: { routine: true } }),
    goalsOf(ownerSub),
  ]);
  const routine = toRoutine(planRow?.routine);
  const pushedIds = new Set(pushedOf(row?.pushed).map((p) => p.eventId));
  const d = await draft(ownerSub, dateKey, timeZone, routine, pushedIds);
  const ids = new Set(goals.map((g) => g.id));
  return {
    dateKey,
    saved: row !== null,
    blocks: row ? toBlocks(row.blocks, ids) : d.blocks,
    note: row?.note ?? "",
    pushedTo: row?.pushedTo ?? "",
    pushedAt: row?.pushedAt?.toISOString() ?? null,
    routine,
    routineSet: !!planRow?.routine && Object.keys(planRow.routine as object).length > 0,
    context: {
      dayRows: d.plan.dayRows.map((r) => ({ title: r.title, goalId: r.goalId, ...r.row })),
      steps: d.plan.steps.filter((st) => st.dateKey <= shiftDateKey(dateKey, 3)).map((st) => ({ label: st.label, itemTitle: st.itemTitle, kind: st.kind, dateKey: st.dateKey, goalId: st.goalId })),
      training: d.sessions.map((x) => ({ title: x.title, minutes: x.minutes })),
      calendar: d.cal.state,
      meals: d.meals.map((m) => ({ id: m.id, title: m.title, kind: m.kind })),
    },
    goals: goals.filter((g) => g.status === "ACTIVE").map((g) => ({ id: g.id, title: g.title, hex: g.hex })),
  };
}

export async function saveDayPlan(ownerSub: string, dateKey: string, blocks: unknown, note: string, timeZone: string): Promise<DayPlanView> {
  const ids = new Set((await prisma.goal.findMany({ where: { ownerSub }, select: { id: true } })).map((g) => g.id));
  const clean = toBlocks(blocks, ids);
  const data = { blocks: clean as unknown as Prisma.InputJsonValue, note: s(note, 3000) };
  await prisma.goalDayPlan.upsert({ where: { ownerSub_dateKey: { ownerSub, dateKey } }, create: { ownerSub, dateKey, ...data }, update: data });
  return getDayPlan(ownerSub, dateKey, timeZone);
}

/** Starts the day over from the draft. What was written to the calendar is still remembered. */
export async function redraftDayPlan(ownerSub: string, dateKey: string, timeZone: string): Promise<DayPlanView> {
  const row = await prisma.goalDayPlan.findUnique({ where: { ownerSub_dateKey: { ownerSub, dateKey } } });
  const planRow = await prisma.goalPlan.findUnique({ where: { ownerSub }, select: { routine: true } });
  const d = await draft(ownerSub, dateKey, timeZone, toRoutine(planRow?.routine), new Set(pushedOf(row?.pushed).map((p) => p.eventId)));
  return saveDayPlan(ownerSub, dateKey, d.blocks, row?.note ?? "", timeZone);
}

/* ---------- writing it into the calendar ---------- */

export interface PushResult {
  target: "google" | "app";
  written: number;
  removed: number;
  failed: number;
}

/**
 * Writes the day's blocks into the calendar — the last step of the day's
 * plan, done the evening before or that morning. Google Calendar when
 * it's linked and writable; otherwise the app's own time blocks.
 */
export async function pushDayPlan(ownerSub: string, dateKey: string, timeZone: string): Promise<PushResult> {
  const view = await getDayPlan(ownerSub, dateKey, timeZone);
  const row = await prisma.goalDayPlan.findUnique({ where: { ownerSub_dateKey: { ownerSub, dateKey } } });
  const blocks = view.blocks.filter((b) => b.push && !b.fixed);
  const goalTitle = new Map(view.goals.map((g) => [g.id, g.title]));
  // A meal block carries the meal's recipe, so the event is enough to cook from.
  const mealRows = await prisma.plannedMeal.findMany({ where: { id: { in: view.context.meals.map((m) => m.id) } } });
  const mealOf = (b: DayBlock) => (b.kind === "MEAL" ? mealRows.find((m) => m.title === b.title) : undefined);
  const before = pushedOf(row?.pushed);
  let target: "google" | "app" = view.context.calendar === "linked" ? "google" : "app";
  let written = 0;
  let removed = 0;
  let failed = 0;
  const pushed: Pushed = [];

  if (target === "google") {
    try {
      for (const b of blocks) {
        const key = keyOf(b);
        const existing = before.find((p) => p.key === key)?.eventId ?? null;
        try {
          const eventId = await googleCalendar.upsertEvent(
            ownerSub,
            {
              summary: b.title,
              description: [b.goalId ? goalTitle.get(b.goalId) : "", b.note, mealOf(b) ? mealPlanning.mealEventDescription(mealOf(b)!) : "", "（1日の計画から）"]
                .filter(Boolean)
                .join("\n"),
              start: localTimeUtc(dateKey, minutesOfTime(b.start), timeZone),
              end: localTimeUtc(dateKey, minutesOfTime(b.end), timeZone),
              timeZone,
            },
            existing,
          );
          pushed.push({ key, eventId });
          written++;
        } catch (e) {
          if (e instanceof googleCalendar.GoogleCalendarAuthError) throw e;
          failed++;
        }
      }
      for (const p of before) {
        if (pushed.some((x) => x.eventId === p.eventId)) continue;
        try {
          await googleCalendar.deleteEvent(ownerSub, p.eventId);
          removed++;
        } catch {
          failed++;
        }
      }
    } catch (e) {
      // Read-only or revoked: the day still gets written, here in the app.
      if (!(e instanceof googleCalendar.GoogleCalendarAuthError)) throw e;
      target = "app";
      written = 0;
      pushed.length = 0;
    }
  }

  if (target === "app") {
    await prisma.$transaction([
      prisma.timeBlock.deleteMany({ where: { ownerSub, dateKey, source: "DAY_PLAN" } }),
      prisma.timeBlock.createMany({
        data: blocks.map((b) => ({
          ownerSub,
          dateKey,
          startMinutes: minutesOfTime(b.start),
          durationMinutes: Math.max(5, minutesOfTime(b.end) - minutesOfTime(b.start)),
          title: b.title,
          source: "DAY_PLAN",
        })),
      }),
    ]);
    written = blocks.length;
  }

  const data = {
    blocks: view.blocks as unknown as Prisma.InputJsonValue,
    pushed: (target === "google" ? pushed : before) as unknown as Prisma.InputJsonValue,
    pushedTo: target,
    pushedAt: new Date(),
  };
  await prisma.goalDayPlan.upsert({ where: { ownerSub_dateKey: { ownerSub, dateKey } }, create: { ownerSub, dateKey, ...data }, update: data });
  return { target, written, removed, failed };
}

/* ---------- talking the day over ---------- */

export interface DayProposal {
  reason: string;
  blocks: DayBlock[];
}
export interface DayMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposal: DayProposal | null;
  applied: boolean;
  dismissed: boolean;
}

export function toDayMessage(m: Prisma.GoalDayPlanMessageGetPayload<object>): DayMessageView {
  return {
    id: m.id,
    role: m.role === "USER" ? "USER" : "ASSISTANT",
    content: m.content,
    proposal: (m.proposal as unknown as DayProposal | null) ?? null,
    applied: m.appliedAt !== null,
    dismissed: m.dismissedAt !== null,
  };
}

export async function listDayMessages(ownerSub: string, dateKey: string) {
  return (await prisma.goalDayPlanMessage.findMany({ where: { ownerSub, dateKey }, orderBy: { createdAt: "asc" } })).map(toDayMessage);
}

const SYSTEM_PROMPT = `あなたは、この人の1日の予定を一緒に組むアシスタントです。目標と計画（詳細計画・今週の優先成果・週の時間予算）と、その日の固定の予定（睡眠・仕事・通勤・カレンダーの予定・食事）をもとに、その日の時間割を組み、相談に乗り、直します。

決まり:
- 睡眠・仕事・カレンダーの固定の予定（fixed）は動かさない。睡眠を削らない。大切な人との時間や休憩を削って埋め合わせない。
- 標準の1週間の枠を基本にし、その日に締切・提出目標・授業・詳細計画の「今日の予定」があれば、それに合わせて中身や時間を調整する。
- 1つの枠には1つの具体的な作業（「力学01の梁Aを反力図→釣合い式→計算」のように）を書く。note に残す成果物を短く。
- 長い集中の後には短い休憩を入れてよい。移動・食事・身支度の時間も現実的に取る。
- 相手の話（体調・用事・やる気）を優先する。予定を詰めすぎない。
- 情報が足りなければ blocks を空にして、短く質問する。変える必要が無ければ blocks は空。
- 変えるときは、その日の全部の枠を blocks に入れる（部分ではなく1日分の完全な一覧）。fixed の枠もそのまま含める。
- reply は日本語で2〜5文。何を優先し、何を動かしたか。

枠: { "start": "HH:MM", "end": "HH:MM"（24:00 可）, "title", "kind": "SLEEP|WORK|COMMUTE|GOAL|MEAL|EVENT|LIFE|BREAK|OTHER", "goalRef": "G1" または null, "note", "fixed": true/false, "push": カレンダーに入れるなら true（睡眠と fixed は false） }

出力は次のJSONのみ（前後に文章やコードフェンスを付けない）:
{ "reply": "相手への返事", "reason": "組み方の根拠を1文。変更が無ければ空", "blocks": [] }`;

function progressFrom(text: string): ChatProgress {
  const items: ProgressItem[] = [...text.matchAll(/"start"\s*:\s*"(\d\d:\d\d)"[^}]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ dateKey: "", slot: null, title: `${m[1]} ${m[2]}` }));
  return { stage: "writing", reply: partialString(text, "reply"), items };
}

export async function sendDayMessage(ownerSub: string, dateKey: string, text: string, timeZone: string, onProgress?: (p: ChatProgress) => void): Promise<DayMessageView[]> {
  const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new ValidationError("mealChatInvalid", "message is empty");
  const [view, history, goalRows, weekday] = await Promise.all([
    getDayPlan(ownerSub, dateKey, timeZone),
    prisma.goalDayPlanMessage.findMany({ where: { ownerSub, dateKey }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS }),
    goalsOf(ownerSub),
    weekStartWeekday(ownerSub, dateKey),
  ]);
  const active = goalRows.filter((g) => g.status === "ACTIVE");
  const ref = new Map(active.map((g, i) => [g.id, `G${i + 1}`]));
  const byRef = new Map(active.map((g, i) => [`G${i + 1}`, g.id]));
  const weekStart = weekStartOn(dateKey, weekday);
  const [logs, deliverables, tasks] = await Promise.all([
    prisma.goalDailyLog.findMany({ where: { ownerSub, dateKey: { gte: weekStart, lt: dateKey } } }),
    prisma.goalDeliverable.findMany({ where: { ownerSub, weekStartDateKey: weekStart } }),
    prisma.goalTask.findMany({ where: { ownerSub, doneAt: null }, take: 20, orderBy: { sortOrder: "asc" } }),
  ]);
  const spent = new Map<string, number>();
  for (const l of logs) for (const [k, v] of Object.entries((l.hours ?? {}) as Record<string, number>)) spent.set(k, (spent.get(k) ?? 0) + v);
  const routineDay = view.routine.days.find((d) => d.weekday === new Date(`${dateKey}T00:00:00Z`).getUTCDay())!;
  const userMessage = await prisma.goalDayPlanMessage.create({ data: { ownerSub, dateKey, role: "USER", content } });
  onProgress?.({ stage: "context", reply: "", items: [] });
  const prompt = [
    `今日: ${dateKey}（${WEEKDAY[new Date(`${dateKey}T00:00:00Z`).getUTCDay()]}）`,
    `生活の基本: 就寝${view.routine.bed} 起床${view.routine.wake} ／ この曜日: ${routineDay.work ? `仕事 ${routineDay.start}〜${routineDay.end} ${routineDay.office ? `出社・片道${routineDay.commuteMinutes}分` : "在宅"}` : "仕事なし"}`,
    "",
    "目標（領域）と今週の実績:",
    ...active.map((g) => `- ${ref.get(g.id)} ${g.title} 週${g.weeklyHours}h ／ 今週ここまで${Math.round((spent.get(g.id) ?? 0) * 10) / 10}h`),
    "",
    "今の枠:",
    ...view.blocks.map((b) => `- ${b.start}〜${b.end} [${b.kind}] ${b.title}${b.goalId ? ` ${ref.get(b.goalId) ?? ""}` : ""}${b.fixed ? " fixed" : ""}${b.note ? ` ／ ${b.note}` : ""}`),
    "",
    "詳細計画の今日の予定:",
    ...(view.context.dayRows.length ? view.context.dayRows.map((r) => `- ${r.title}: ${r.time} ／ ${r.work} ／ 残すもの: ${r.output}`) : ["（なし）"]),
    "近い工程（3日以内・過ぎた提出目標）:",
    ...(view.context.steps.length ? view.context.steps.map((st) => `- ${st.dateKey} [${st.kind}] ${st.itemTitle} ${st.label}`) : ["（なし）"]),
    "今週の優先成果:",
    ...(deliverables.length ? deliverables.map((d) => `- ${d.title}（${d.status}）${d.condition ? ` 完了条件: ${d.condition}` : ""}`) : ["（なし）"]),
    "トレーニング:",
    ...(view.context.training.length ? view.context.training.map((x) => `- ${x.title} ${x.minutes}分`) : ["（なし）"]),
    "未完了のタスク:",
    ...(tasks.length ? tasks.map((x) => `- ${x.text}${x.dueDateKey ? ` 期限${x.dueDateKey}` : ""}`) : ["（なし）"]),
    "",
    "これまでの会話:",
    ...(history.length === 0 ? ["  （なし）"] : [...history].reverse().map((m) => `  ${m.role === "USER" ? "相手" : "あなた"}: ${m.content.slice(0, 800)}`)),
    "",
    `相手の新しいメッセージ: ${content}`,
  ].join("\n");

  let reply: string;
  let proposal: DayProposal | null = null;
  try {
    let writing = false;
    const { value } = await askForJson(
      ownerSub,
      SYSTEM_PROMPT,
      prompt,
      12000,
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
    reply = s(o.reply, 3000) || "（返事が空でした）";
    const raw = (Array.isArray(o.blocks) ? o.blocks : []).map((b) => {
      const r = (b ?? {}) as Record<string, unknown>;
      return { ...r, goalId: typeof r.goalRef === "string" ? (byRef.get(r.goalRef) ?? null) : null };
    });
    const blocks = toBlocks(raw, new Set(active.map((g) => g.id)));
    // The calendar's own appointments stay as they are, whatever came back.
    const fixed = view.blocks.filter((b) => b.fixed);
    const merged = [...blocks.filter((b) => !b.fixed), ...fixed].sort((a, b) => a.start.localeCompare(b.start));
    if (blocks.length > 0) proposal = { reason: s(o.reason, 1000), blocks: merged };
    onProgress?.({ stage: "saving", reply, items: [] });
  } catch (e) {
    await prisma.goalDayPlanMessage.delete({ where: { id: userMessage.id } });
    throw e;
  }
  await prisma.goalDayPlanMessage.create({
    data: { ownerSub, dateKey, role: "ASSISTANT", content: reply, proposal: proposal ? (proposal as unknown as Prisma.InputJsonValue) : undefined },
  });
  return listDayMessages(ownerSub, dateKey);
}

export async function applyDayProposal(ownerSub: string, messageId: string, timeZone: string): Promise<DayPlanView> {
  const m = await prisma.goalDayPlanMessage.findFirst({ where: { id: messageId, ownerSub } });
  const proposal = m?.proposal as unknown as DayProposal | null;
  if (!m || !proposal || m.appliedAt || m.dismissedAt) throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  const row = await prisma.goalDayPlan.findUnique({ where: { ownerSub_dateKey: { ownerSub, dateKey: m.dateKey } } });
  const view = await saveDayPlan(ownerSub, m.dateKey, proposal.blocks, row?.note ?? "", timeZone);
  await prisma.goalDayPlanMessage.update({ where: { id: messageId }, data: { appliedAt: new Date() } });
  return view;
}

export async function dismissDayProposal(ownerSub: string, messageId: string): Promise<void> {
  await prisma.goalDayPlanMessage.updateMany({ where: { id: messageId, ownerSub, appliedAt: null }, data: { dismissedAt: new Date() } });
}

export async function clearDayMessages(ownerSub: string, dateKey: string): Promise<void> {
  await prisma.goalDayPlanMessage.deleteMany({ where: { ownerSub, dateKey } });
}
