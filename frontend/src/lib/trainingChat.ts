import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { askForJson } from "@/lib/aiJson";
import { progressReporter, type ChatProgress } from "@/lib/chatProgress";
import { shiftDateKey } from "@/lib/dateKey";
import { ValidationError } from "@/lib/errors";
import { SESSION_JSON, TRAINER_RULES, getWeek, parsePlanReply, sessionLine, trainerContext, type ParsedSession } from "@/lib/training";
import type { TrainingChatMessage, TrainingSession } from "@/generated/prisma/client";

export type { TrainingChatMessage };

/**
 * Talking the week over with the trainer.
 *
 * The weekly plan (training.generateWeek) is the trainer's own reading of
 * the numbers; this is the other half of coaching — the owner saying what
 * the numbers can't: "my knee hurts today", "only 30 minutes on Wednesday",
 * "I want more upper body", "plan this week around a trip on Friday". Each
 * reply can carry a proposal — sessions to add or rewrite, days to clear —
 * that changes nothing until it's applied, like the meal chat.
 *
 * Only days from today on whose session hasn't been logged can change; a
 * session already done or skipped is the record the next analysis reads.
 */

const HISTORY_TURNS = 12;
const MAX_MESSAGE_LENGTH = 2000;

export interface ProposedSession extends ParsedSession {
  /** The session it replaces, as it was when proposed ("" for a free day). */
  replaces: string;
}

export interface TrainingProposal {
  sessions: ProposedSession[];
  /** Days whose session is taken off, leaving a rest day. */
  remove: { dateKey: string; title: string }[];
  /** A new aim for the week, when the conversation changes it. */
  focus: string;
}

export function isEmptyProposal(p: TrainingProposal): boolean {
  return p.sessions.length === 0 && p.remove.length === 0 && !p.focus;
}

/**
 * Every day a proposal may touch, keyed dateKey → current session title
 * ("" for a free day): the week's days from today on, either free or with a
 * session not yet logged.
 */
export function changeableDays(
  dates: string[],
  sessions: Pick<TrainingSession, "dateKey" | "title" | "status">[],
  todayKey: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const dateKey of dates) {
    if (dateKey < todayKey) continue;
    const onDay = sessions.filter((s) => s.dateKey === dateKey);
    if (onDay.length === 0) out.set(dateKey, "");
    else if (onDay.every((s) => s.status === "PLANNED")) out.set(dateKey, onDay.map((s) => s.title).join(" / "));
  }
  return out;
}

/** Reads the model's reply into something that can be trusted: sessions
 * only on changeable days (checked by the same parser the weekly plan
 * uses), removals only of sessions that exist and can change. Pure. */
export function parseTrainerReply(
  value: unknown,
  changeable: Map<string, string>,
  maxSessions: number,
  maxMinutes: number,
): { reply: string; proposal: TrainingProposal } {
  const raw = (value ?? {}) as { reply?: unknown; sessions?: unknown; remove?: unknown; focus?: unknown };
  const { sessions } = parsePlanReply({ sessions: raw.sessions }, [...changeable.keys()], maxSessions, maxMinutes);
  const touched = new Set(sessions.map((s) => s.dateKey));
  const remove = (Array.isArray(raw.remove) ? raw.remove : [])
    .map((d) => (typeof d === "string" ? d.trim().slice(0, 10) : ""))
    .filter((d, i, all) => changeable.get(d) && !touched.has(d) && all.indexOf(d) === i)
    .map((dateKey) => ({ dateKey, title: changeable.get(dateKey) ?? "" }));
  return {
    reply: typeof raw.reply === "string" ? raw.reply.trim().slice(0, 2000) : "",
    proposal: {
      sessions: sessions.map((s) => ({ ...s, replaces: changeable.get(s.dateKey) ?? "" })),
      remove,
      focus: typeof raw.focus === "string" ? raw.focus.trim().slice(0, 200) : "",
    },
  };
}

const SYSTEM_PROMPT = `あなたはこの人のパーソナルトレーナーです。会話しながら今週のトレーニングを一緒に調整します。

相談の例: 「今日は膝が痛い」「水曜は30分しか取れない」「もっと上半身を鍛えたい」「金曜から旅行なので前倒ししたい」「この週の計画を作って」「スクワットがきつすぎた」

すること:
- 相手の話を受けて、必要ならセッションの追加・差し替え（sessions）や、休養日にする日（remove）を提案する。
- 変えるのは必要な日だけ。「変更してよい日」に挙がっていない日は絶対に変えない（実施・休みを記録した日、過ぎた日）。
- 1つの日に入れるセッションは1つ。その日を変えるときは、その日のセッション全体を書く。
- 体の痛みや不調の話には、無理をさせない方向で応える。痛みが強い・続く場合は医療機関の受診を勧める。
- 週の狙いが変わるなら focus に1文で書く。変わらなければ空文字。
- 情報が足りなければ、sessions は空にして reply で短く質問してよい。
- reply は日本語で、何をなぜ変えるかを2〜4文で。トレーナーとして前向きに、具体的に。

${TRAINER_RULES}

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "reply": "相手への返事",
  "focus": "",
  "sessions": [
    ${SESSION_JSON}
  ],
  "remove": ["YYYY-MM-DD"]
}

kind は STRENGTH（筋力）/ CARDIO（有酸素）/ MOBILITY（柔軟・回復）のいずれか。`;

export interface TrainerChatMessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposal: TrainingProposal | null;
  applied: boolean;
  dismissed: boolean;
}

export function toMessageView(m: TrainingChatMessage): TrainerChatMessageView {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    proposal: (m.proposal as unknown as TrainingProposal | null) ?? null,
    applied: m.appliedAt !== null,
    dismissed: m.dismissedAt !== null,
  };
}

export async function listMessages(ownerSub: string, weekStartDateKey: string): Promise<TrainingChatMessage[]> {
  return prisma.trainingChatMessage.findMany({ where: { ownerSub, weekStartDateKey }, orderBy: { createdAt: "asc" } });
}

/**
 * Sends one message and stores it with the trainer's reply (and proposal,
 * unapplied). On an AI failure the owner's message is taken back out, so the
 * thread doesn't fill with unanswered questions; the screen keeps the text.
 */
export async function sendMessage(
  ownerSub: string,
  weekStartDateKey: string,
  text: string,
  todayKey: string,
  /** Progress while the reply streams, as in the meal chat. */
  onProgress?: (p: ChatProgress) => void,
): Promise<TrainingChatMessage[]> {
  const content = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!content) throw new ValidationError("mealChatInvalid", "message is empty");
  const ctx = await trainerContext(ownerSub, weekStartDateKey, todayKey);
  const history = await prisma.trainingChatMessage.findMany({
    where: { ownerSub, weekStartDateKey },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
  });
  const changeable = changeableDays(ctx.dates, ctx.existing.sessions, todayKey);
  const userMessage = await prisma.trainingChatMessage.create({ data: { ownerSub, weekStartDateKey, role: "USER", content } });
  onProgress?.({ stage: "context", reply: "", items: [] });

  const free = [...changeable].filter(([, title]) => title === "").map(([d]) => d);
  const brief = [
    `今日: ${todayKey}`,
    `この週: ${ctx.dates[0]} 〜 ${ctx.dates[6]}`,
    `週のトレーニング日数の上限: ${ctx.preference.daysPerWeek}日`,
    "",
    ctx.brief,
    "",
    `この週の狙い: ${ctx.existing.plan?.focus || "（まだない）"}`,
    ...(ctx.existing.plan?.analysis ? [`この週の分析: ${ctx.existing.plan.analysis}`] : []),
    "この週のセッション:",
    ...(ctx.existing.sessions.length === 0 ? ["  （まだない）"] : ctx.existing.sessions.map(sessionLine)),
    `変更してよい日（セッションが未記録の日）: ${[...changeable].filter(([, t]) => t !== "").map(([d]) => d).join(", ") || "なし"}`,
    `空いている日（追加してよい）: ${free.join(", ") || "なし"}`,
    "",
    "これまでの会話:",
    ...(history.length === 0
      ? ["  （なし）"]
      : [...history].reverse().map((m) => `  ${m.role === "USER" ? "相手" : "あなた"}: ${m.content}`)),
    "",
    `相手の新しいメッセージ: ${content}`,
  ].join("\n");

  let parsed: { reply: string; proposal: TrainingProposal };
  try {
    const { value } = await askForJson(ownerSub, SYSTEM_PROMPT, brief, 10000, undefined, onProgress && progressReporter(onProgress, "sessions"));
    parsed = parseTrainerReply(value, changeable, 7, ctx.preference.minutesPerSession);
    onProgress?.({ stage: "saving", reply: parsed.reply, items: [] });
  } catch (e) {
    await prisma.trainingChatMessage.delete({ where: { id: userMessage.id } });
    throw e;
  }

  await prisma.trainingChatMessage.create({
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

function readProposal(value: unknown): TrainingProposal | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<TrainingProposal>;
  return {
    sessions: Array.isArray(p.sessions) ? p.sessions : [],
    remove: Array.isArray(p.remove) ? p.remove : [],
    focus: typeof p.focus === "string" ? p.focus : "",
  };
}

/**
 * Applies a proposal in one transaction: rewrites the sessions on the days
 * it names, clears the days it takes off, and sets the week's aim if it
 * changed. Re-checked now rather than trusted from when it was made — a day
 * that has passed or been logged since is left alone. The week's plan is
 * created if this is the first thing in it. Applied once; an applied or
 * dismissed proposal is refused.
 */
export async function applyProposal(ownerSub: string, messageId: string, todayKey: string): Promise<void> {
  const message = await prisma.trainingChatMessage.findFirst({ where: { id: messageId, ownerSub } });
  const proposal = readProposal(message?.proposal);
  if (!message || !proposal || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be applied");
  }
  const weekStartDateKey = message.weekStartDateKey;
  const week = await getWeek(ownerSub, weekStartDateKey);
  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStartDateKey, i));
  const changeable = changeableDays(dates, week.sessions, todayKey);
  const sessions = proposal.sessions.filter((s) => changeable.has(s.dateKey));
  const remove = proposal.remove.filter((r) => changeable.get(r.dateKey));

  await prisma.$transaction(async (tx) => {
    const plan =
      week.plan ??
      (await tx.trainingPlan.upsert({
        where: { ownerSub_weekStartDateKey: { ownerSub, weekStartDateKey } },
        create: { ownerSub, weekStartDateKey, focus: proposal.focus },
        update: {},
      }));
    if (proposal.focus && week.plan) await tx.trainingPlan.update({ where: { id: plan.id }, data: { focus: proposal.focus } });
    const days = [...sessions.map((s) => s.dateKey), ...remove.map((r) => r.dateKey)];
    if (days.length > 0) await tx.trainingSession.deleteMany({ where: { planId: plan.id, dateKey: { in: days }, status: "PLANNED" } });
    if (sessions.length > 0) {
      await tx.trainingSession.createMany({
        data: sessions.map((s, i) => ({
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
    }
    await tx.trainingChatMessage.update({ where: { id: messageId }, data: { appliedAt: new Date() } });
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function dismissProposal(ownerSub: string, messageId: string): Promise<void> {
  const message = await prisma.trainingChatMessage.findFirst({ where: { id: messageId, ownerSub } });
  if (!message || message.appliedAt || message.dismissedAt) {
    throw new ValidationError("mealChatProposalGone", "This proposal can no longer be dismissed");
  }
  await prisma.trainingChatMessage.update({ where: { id: messageId }, data: { dismissedAt: new Date() } });
}
