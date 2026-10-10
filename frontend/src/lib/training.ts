import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson, AiJsonError } from "@/lib/aiJson";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { compositionHistory, currentTargets, getProfile } from "@/lib/health";
import { getPreference as getMealPreference, weekStartFor } from "@/lib/mealPlanning";
import { ageFromBirthYear } from "@/lib/nutritionTargets";
import type {
  TrainingExperience,
  TrainingKind,
  TrainingPlan,
  TrainingPreference,
  TrainingSession,
  TrainingStatus,
} from "@/generated/prisma/client";

export type { TrainingExperience, TrainingKind, TrainingPreference, TrainingStatus };

/**
 * The trainer.
 *
 * A week of training is written the way a coach would: from the goal (the
 * composition on /training), from what the scale says the body has been
 * doing, and from what was actually trained last week and how hard it felt.
 * So every plan comes with its analysis — the reading of those three — and
 * the sessions are the adjustment that reading calls for. Logging a session
 * (done / skipped, effort, a line about what happened) is what closes the
 * loop: next week's analysis reads it.
 *
 * Same shape as the meal planner: the model proposes, this file checks the
 * proposal against the constraints (days, dates, minutes) rather than
 * trusting it, and the owner's own key pays for it.
 */

const KINDS: TrainingKind[] = ["STRENGTH", "CARDIO", "MOBILITY"];
const STATUSES: TrainingStatus[] = ["PLANNED", "DONE", "SKIPPED"];
const EXPERIENCES: TrainingExperience[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

export interface Exercise {
  name: string;
  /** Null for things that aren't counted in sets — a 30-minute run. */
  sets: number | null;
  /** "8〜10", "30秒", "5km" — text, because it's rarely just a number. */
  reps: string;
  /** "20kg", "自重", "会話できるペース". */
  load: string;
  note: string;
}

export interface SessionView extends Omit<TrainingSession, "exercises"> {
  exercises: Exercise[];
}

export interface TrainingWeekView {
  plan: TrainingPlan | null;
  sessions: SessionView[];
}

/* ---------- preferences ---------- */

/** Created with defaults the first time; a concurrent first read that loses
 * the insert race reads the winner's row (same as mealPlanning). */
export async function getPreference(ownerSub: string): Promise<TrainingPreference> {
  const row = await prisma.trainingPreference.findUnique({ where: { ownerSub } });
  if (row) return row;
  try {
    return await prisma.trainingPreference.create({ data: { ownerSub } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    const created = await prisma.trainingPreference.findUnique({ where: { ownerSub } });
    if (!created) throw e;
    return created;
  }
}

export interface PreferenceInput {
  daysPerWeek: number;
  minutesPerSession: number;
  equipment: string;
  limitations: string;
  focus: string;
  experience: TrainingExperience;
}

export async function savePreference(ownerSub: string, input: PreferenceInput): Promise<TrainingPreference> {
  if (!Number.isInteger(input.daysPerWeek) || input.daysPerWeek < 1 || input.daysPerWeek > 7) {
    throw new ValidationError("trainingPreferenceInvalid", "Days per week must be 1-7");
  }
  if (!Number.isInteger(input.minutesPerSession) || input.minutesPerSession < 10 || input.minutesPerSession > 180) {
    throw new ValidationError("trainingPreferenceInvalid", "Minutes per session must be 10-180");
  }
  if (!EXPERIENCES.includes(input.experience)) throw new ValidationError("trainingPreferenceInvalid", "Unknown experience level");
  const data = {
    daysPerWeek: input.daysPerWeek,
    minutesPerSession: input.minutesPerSession,
    equipment: input.equipment.trim().slice(0, 500),
    limitations: input.limitations.trim().slice(0, 500),
    focus: input.focus.trim().slice(0, 500),
    experience: input.experience,
  };
  return prisma.trainingPreference.upsert({ where: { ownerSub }, create: { ownerSub, ...data }, update: data });
}

/* ---------- reading ---------- */

function toSessionView(s: TrainingSession): SessionView {
  return { ...s, exercises: Array.isArray(s.exercises) ? (s.exercises as unknown as Exercise[]) : [] };
}

export async function getWeek(ownerSub: string, weekStartDateKey: string): Promise<TrainingWeekView> {
  const plan = await prisma.trainingPlan.findUnique({
    where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
    include: { sessions: { orderBy: [{ dateKey: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!plan) return { plan: null, sessions: [] };
  const { sessions, ...rest } = plan;
  return { plan: rest, sessions: sessions.map(toSessionView) };
}

/** The week a date falls in, on the same calendar the meals use. */
export async function weekStartOf(ownerSub: string, dateKey: string): Promise<string> {
  const mealPreference = await getMealPreference(ownerSub);
  return weekStartFor(dateKey, mealPreference.weekStartWeekday);
}

/** The sessions on one day, for other screens (the meal planner reads
 * which days are training days). */
export async function sessionsBetween(ownerSub: string, fromDateKey: string, toDateKey: string): Promise<SessionView[]> {
  const rows = await prisma.trainingSession.findMany({
    where: { plan: { ownerSub }, dateKey: { gte: fromDateKey, lte: toDateKey } },
    orderBy: [{ dateKey: "asc" }, { sortOrder: "asc" }],
  });
  return rows.map(toSessionView);
}

/* ---------- logging ---------- */

export interface SessionLogInput {
  status: TrainingStatus;
  rpe: number | null;
  log: string;
}

export async function logSession(ownerSub: string, sessionId: string, input: SessionLogInput): Promise<SessionView> {
  if (!STATUSES.includes(input.status)) throw new ValidationError("trainingSessionInvalid", "Unknown status");
  if (input.rpe !== null && (!Number.isInteger(input.rpe) || input.rpe < 1 || input.rpe > 10)) {
    throw new ValidationError("trainingSessionInvalid", "Effort must be 1-10");
  }
  const existing = await prisma.trainingSession.findFirst({ where: { id: sessionId, plan: { ownerSub } } });
  if (!existing) throw new ValidationError("trainingSessionNotFound", "Session not found");
  const row = await prisma.trainingSession.update({
    where: { id: sessionId },
    data: { status: input.status, rpe: input.rpe, log: input.log.trim().slice(0, 1000) },
  });
  return toSessionView(row);
}

/* ---------- generation ---------- */

const SYSTEM_PROMPT = `あなたはパーソナルトレーナーです。目標の体組成に向けて、この人の1週間のトレーニングを計画します。毎週、体組成の変化と前の週の実施記録を読んで分析し、その分析を今週のメニューに反映させます。

分析（analysis）で書くこと:
- 体組成の変化の読み: 体重ではなく脂肪量と除脂肪量を分けて見る。1週間の値は水分でぶれるので、数週間の流れで判断する。データが足りなければそう書く。
- 前の週の実施状況: 実施率、きつさ（RPE 1〜10）、本人のメモから、負荷が合っていたか。
- 今週の調整: 上の2つから何を変えるか（負荷・量・頻度・種目・有酸素の割合）。変えない場合も理由を書く。
- 4〜8文、日本語、具体的に。数字を使う。

計画で守ること:
1. トレーニングする日は指定された日数まで。1日に複数のセッションは入れない。休養日を挟む。
2. 1回の時間は指定の分数以内（ウォームアップを含む）。
3. 使える場所・器具の範囲で組む。持っていない器具を前提にしない。
4. 怪我・痛みのある部位には負荷をかけない。代わりの種目にする。
5. 経験に合った強度にする。初心者はフォームの習得と段階的な漸進を優先する。
6. 目標の方向に合わせる: 脂肪を減らす局面でも筋力トレーニングを主にして除脂肪量を守る（有酸素は補助）。除脂肪量を増やす局面は漸進的な過負荷を優先する。維持の局面は質と機能性を上げる。
7. 漸進: 前の週にRPEが低すぎた種目は負荷か回数を上げ、高すぎた・できなかった種目は下げる。
8. 本人の「目指したいこと」があれば、それに効く種目を入れる。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "analysis": "分析",
  "focus": "今週の狙いを1文で",
  "sessions": [
    {
      "dateKey": "YYYY-MM-DD",
      "title": "下半身と体幹",
      "kind": "STRENGTH",
      "minutes": 45,
      "notes": "このセッションで意識すること（フォーム・強度の目安）",
      "exercises": [
        { "name": "ゴブレットスクワット", "sets": 3, "reps": "8〜10", "load": "16kg", "note": "膝とつま先の向きを揃える" }
      ]
    }
  ]
}

kind は STRENGTH（筋力）/ CARDIO（有酸素）/ MOBILITY（柔軟・回復）のいずれか。`;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

export interface ParsedSession {
  dateKey: string;
  title: string;
  kind: TrainingKind;
  minutes: number;
  notes: string;
  exercises: Exercise[];
}

/**
 * Reads the model's plan, keeping only what fits: dates inside the days
 * being planned, one session a day, at most `daysPerWeek` of them, minutes
 * no longer than a session may run. Pure, for testing.
 */
export function parsePlanReply(
  value: unknown,
  allowedDates: string[],
  daysPerWeek: number,
  maxMinutes: number,
): { analysis: string; focus: string; sessions: ParsedSession[] } {
  const raw = (value ?? {}) as { analysis?: unknown; focus?: unknown; sessions?: unknown };
  const sessions: ParsedSession[] = [];
  const used = new Set<string>();
  for (const r of Array.isArray(raw.sessions) ? raw.sessions : []) {
    const s = (r ?? {}) as Record<string, unknown>;
    const dateKey = str(s.dateKey, 10);
    const title = str(s.title, 100);
    if (!allowedDates.includes(dateKey) || used.has(dateKey) || !title) continue;
    if (sessions.length >= daysPerWeek) break;
    const kind = str(s.kind, 20).toUpperCase() as TrainingKind;
    const exercises: Exercise[] = (Array.isArray(s.exercises) ? s.exercises : [])
      .map((e) => {
        const ex = (e ?? {}) as Record<string, unknown>;
        const sets = num(ex.sets);
        return {
          name: str(ex.name, 100),
          sets: sets === null ? null : Math.min(20, Math.round(sets)),
          reps: str(ex.reps, 40),
          load: str(ex.load, 60),
          note: str(ex.note, 200),
        };
      })
      .filter((e) => e.name)
      .slice(0, 15);
    used.add(dateKey);
    sessions.push({
      dateKey,
      title,
      kind: KINDS.includes(kind) ? kind : "STRENGTH",
      minutes: Math.max(5, Math.min(maxMinutes, Math.round(num(s.minutes) ?? maxMinutes))),
      notes: str(s.notes, 400),
      exercises,
    });
  }
  sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { analysis: str(raw.analysis, 3000), focus: str(raw.focus, 200), sessions };
}

const KIND_LABEL: Record<TrainingKind, string> = { STRENGTH: "筋力", CARDIO: "有酸素", MOBILITY: "柔軟・回復" };
const STATUS_LABEL: Record<TrainingStatus, string> = { PLANNED: "未記録", DONE: "実施", SKIPPED: "休んだ" };
const EXPERIENCE_LABEL: Record<TrainingExperience, string> = { BEGINNER: "初心者", INTERMEDIATE: "中級", ADVANCED: "上級" };
const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : n.toFixed(digits));

/**
 * Writes (or rewrites) the week's plan.
 *
 * Rewriting the current week mid-week keeps what already happened: days
 * before today stay as logged, and only today onward is planned again —
 * the past is evidence for the analysis, not something to overwrite.
 */
export async function generateWeek(ownerSub: string, weekStartDateKey: string, todayKey: string): Promise<TrainingWeekView> {
  const [profile, targetsNow, preference, history, previousPlans, existing] = await Promise.all([
    getProfile(ownerSub),
    currentTargets(ownerSub, todayKey),
    getPreference(ownerSub),
    compositionHistory(ownerSub, todayKey, 8),
    prisma.trainingPlan.findMany({
      where: { ownerSub, weekStartDateKey: { lt: weekStartDateKey } },
      orderBy: { weekStartDateKey: "desc" },
      take: 3,
      include: { sessions: { orderBy: { dateKey: "asc" } } },
    }),
    getWeek(ownerSub, weekStartDateKey),
  ]);
  if (!profile) throw new ValidationError("healthProfileMissing", "Fill in the health profile first");

  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStartDateKey, i));
  const kept = existing.sessions.filter((s) => s.dateKey < todayKey);
  const open = dates.filter((d) => d >= todayKey);
  if (open.length === 0) throw new ValidationError("trainingWeekPast", "That week is over");
  const daysLeft = Math.max(0, preference.daysPerWeek - kept.filter((s) => s.status !== "SKIPPED").length);

  const composition = targetsNow?.composition ?? null;
  const sessionLine = (s: Pick<SessionView, "dateKey" | "title" | "kind" | "minutes" | "status" | "rpe" | "log" | "exercises">) =>
    [
      `  ${s.dateKey} ${s.title}（${KIND_LABEL[s.kind]} ${s.minutes}分）: ${STATUS_LABEL[s.status]}${s.rpe ? ` RPE${s.rpe}` : ""}`,
      s.exercises.length > 0 ? `    種目: ${s.exercises.map((e) => `${e.name} ${e.sets ? `${e.sets}×` : ""}${e.reps} ${e.load}`.trim()).join(" / ")}` : "",
      s.log ? `    本人のメモ: ${s.log}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  const brief = [
    `今日: ${todayKey}`,
    `計画する週: ${dates[0]} 〜 ${dates[6]}`,
    `計画してよい日: ${open.join(", ")}`,
    `この週に入れてよいセッション数: ${daysLeft}（週${preference.daysPerWeek}日のうち、すでに実施した日を除く）`,
    "",
    `本人: ${profile.sex === "MALE" ? "男性" : "女性"} ${ageFromBirthYear(profile.birthYear)}歳 身長${profile.heightCm}cm`,
    `経験: ${EXPERIENCE_LABEL[preference.experience]}`,
    `1回の時間: ${preference.minutesPerSession}分まで`,
    `場所・器具: ${preference.equipment || "特に指定なし（自重中心で）"}`,
    `怪我・痛み（負荷をかけない）: ${preference.limitations || "なし"}`,
    `目指したいこと: ${preference.focus || "特になし"}`,
    "",
    ...(composition
      ? [
          "体組成（直近7日平均）:",
          `  体重 ${fmt(composition.current.weightKg)}kg / 体脂肪率 ${fmt(composition.current.bodyFatPercent)}% / 除脂肪量 ${fmt(composition.current.leanMassKg)}kg / 脂肪量 ${fmt(composition.current.fatMassKg)}kg`,
          `目標: 体脂肪率 ${composition.targetBodyFatPercent}%${composition.targetIsAuto ? "（自動設定）" : ""}${profile.targetLeanMassKg ? ` / 除脂肪量 ${profile.targetLeanMassKg}kg` : ""}`,
          `方向: ${
            composition.plan?.direction === "lose_fat"
              ? `脂肪を減らす（あと約${composition.plan.gapKg}kg、約${composition.plan.weeksToTarget ?? "?"}週）`
              : composition.plan?.direction === "gain_lean"
                ? "除脂肪量を増やす"
                : "維持して質を上げる"
          }`,
        ]
      : ["体組成: まだ体脂肪率のデータがない（体重のみで判断する）"]),
    "",
    "週ごとの平均（古い順。日数0はデータなし）:",
    ...history.map(
      (w) =>
        `  〜${w.endDateKey}: ${w.window.days === 0 ? "データなし" : `体重${fmt(w.window.weightKg)} 体脂肪${fmt(w.window.bodyFatPercent)}% 除脂肪${fmt(w.window.leanMassKg)} 脂肪${fmt(w.window.fatMassKg)}（${w.window.days}日）`}`,
    ),
    "",
    ...(targetsNow
      ? [`食事の目標（献立はこれで組まれている）: ${targetsNow.targets.targetKcal}kcal / たんぱく質 ${targetsNow.targets.proteinG}g`, ""]
      : []),
    "これまでの週（新しい順）:",
    ...(previousPlans.length === 0
      ? ["  （初めての計画）"]
      : previousPlans.flatMap((p) => [
          `週 ${p.weekStartDateKey}〜 狙い: ${p.focus || "—"}`,
          ...(p.sessions.length === 0 ? ["  （セッションなし）"] : p.sessions.map((s) => sessionLine(toSessionView(s)))),
        ])),
    ...(kept.length > 0 ? ["", "この週のすでに過ぎた日（変更しない）:", ...kept.map(sessionLine)] : []),
  ].join("\n");

  const { value, truncated } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 10000);
  const parsed = parsePlanReply(value, open, daysLeft, preference.minutesPerSession);
  if (!parsed.analysis && parsed.sessions.length === 0) {
    throw new AiJsonError(truncated ? "truncated" : "invalidResponse", "計画が読み取れませんでした");
  }

  await prisma.$transaction(async (tx) => {
    const plan = existing.plan
      ? await tx.trainingPlan.update({ where: { id: existing.plan.id }, data: { analysis: parsed.analysis, focus: parsed.focus } })
      : await tx.trainingPlan.create({ data: { ownerSub, weekStartDateKey, analysis: parsed.analysis, focus: parsed.focus } });
    await tx.trainingSession.deleteMany({ where: { planId: plan.id, dateKey: { gte: todayKey } } });
    await tx.trainingSession.createMany({
      data: parsed.sessions.map((s, i) => ({
        planId: plan.id,
        dateKey: s.dateKey,
        title: s.title,
        kind: s.kind,
        minutes: s.minutes,
        notes: s.notes,
        exercises: s.exercises as unknown as Prisma.InputJsonValue,
        sortOrder: i,
      })),
    });
  });
  return getWeek(ownerSub, weekStartDateKey);
}
