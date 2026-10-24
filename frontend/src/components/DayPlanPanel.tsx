"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDayProposalAction,
  clearDayMessagesAction,
  dismissDayProposalAction,
  getDayPlanAction,
  pushDayPlanAction,
  redraftDayPlanAction,
  saveDayPlanAction,
} from "@/app/calendar/dayPlanActions";
import type { DayBlock, DayMessageView, DayPlanView } from "@/lib/dayPlan";
import { ChatThinking } from "@/components/ChatThinking";
import { Spinner } from "@/components/LoadingSpinner";
import { MealRecipeDialog } from "@/components/MealRecipe";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import { tint } from "@/lib/goalColors";
import { minutesOfTime } from "@/lib/routine";
import { shiftDateKey } from "@/lib/dateKey";
import { announceChange } from "@/lib/dataSync";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const KINDS = ["SLEEP", "WORK", "COMMUTE", "GOAL", "MEAL", "EVENT", "LIFE", "BREAK", "OTHER"] as const;
/** Each kind's colour, when the block isn't a goal's. */
const KIND_HEX: Record<string, string> = {
  SLEEP: "#5b5bd6",
  WORK: "#64748b",
  COMMUTE: "#94a3b8",
  MEAL: "#1f9d6b",
  EVENT: "#3b6fe0",
  LIFE: "#d39200",
  BREAK: "#0e9fb3",
  OTHER: "#7c8a1f",
  GOAL: "#f2552c",
};

const INPUT = "rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none";
const PILL = "rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40";

/**
 * The day's plan on the calendar — the last step from the goals to the
 * day. A draft from the routine, the standard week, the calendar, meals
 * and the detailed plans; talked over with the advisor, who lays out the
 * whole day again; then written into the calendar. Shown for today and the
 * days ahead, with a nudge in the morning (write today in) and the evening
 * (plan tomorrow).
 */
export function DayPlanPanel({ dateKey, todayKey, onGoToDay }: { dateKey: string; todayKey: string; onGoToDay: (dateKey: string) => void }) {
  const { t } = useI18n();
  const d = t.plan.day;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [loaded, setLoaded] = useState<{ dateKey: string; plan: DayPlanView; messages: DayMessageView[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<"push" | "redraft" | "apply" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipeFor, setRecipeFor] = useState<string | null>(null);
  const closeRecipe = useCallback(() => setRecipeFor(null), []);
  const [chatOpen, setChatOpen] = useState(false);
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void getDayPlanAction(dateKey, timeZone).then((r) => live && setLoaded({ dateKey, ...r }));
    return () => {
      live = false;
    };
  }, [dateKey, timeZone]);
  useEffect(() => {
    const tick = () => setHour(new Date().getHours());
    tick();
    const timer = setInterval(tick, 300_000);
    return () => clearInterval(timer);
  }, []);

  const view = loaded?.dateKey === dateKey ? loaded : null;
  if (!view) {
    return (
      <section className="flex h-20 items-center justify-center rounded-xl border border-line bg-surface">
        <Spinner size="sm" />
      </section>
    );
  }
  const { plan, messages } = view;
  const hexOf = (b: DayBlock) => (b.goalId ? (plan.goals.find((g) => g.id === b.goalId)?.hex ?? KIND_HEX.GOAL) : KIND_HEX[b.kind]);
  const setPlan = (p: DayPlanView) => setLoaded((l) => (l ? { ...l, plan: p } : l));
  const setMessages = (m: DayMessageView[]) => setLoaded((l) => (l ? { ...l, messages: m } : l));

  async function saveBlocks(blocks: DayBlock[]) {
    setError(null);
    setPlan({ ...plan, blocks, saved: true });
    const res = await saveDayPlanAction(dateKey, blocks, plan.note, timeZone);
    if ("error" in res) setError(res.error);
    else setPlan(res.plan);
  }

  async function push() {
    setBusy("push");
    setError(null);
    setNotice(null);
    try {
      const res = await pushDayPlanAction(dateKey, timeZone);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setPlan(res.plan);
      setNotice(res.result.target === "google" ? d.pushedGoogle(res.result.written, res.result.removed, res.result.failed) : d.pushedApp(res.result.written));
      announceChange("schedule");
    } finally {
      setBusy(null);
    }
  }

  async function redraft() {
    setBusy("redraft");
    try {
      const res = await redraftDayPlanAction(dateKey, timeZone);
      if ("error" in res) setError(res.error);
      else setPlan(res.plan);
    } finally {
      setBusy(null);
    }
  }

  const isToday = dateKey === todayKey;
  const isTomorrow = dateKey === shiftDateKey(todayKey, 1);
  const pushedTime = plan.pushedAt ? new Date(plan.pushedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const nudge =
    isToday && hour !== null && hour < 11 && !plan.pushedAt
      ? { text: d.morning, action: null }
      : isToday && hour !== null && hour >= 18
        ? { text: d.evening, action: () => onGoToDay(shiftDateKey(todayKey, 1)) }
        : isTomorrow && !plan.pushedAt
          ? { text: d.tomorrowHint, action: null }
          : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{d.heading}</h2>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold ${
            plan.pushedAt ? "bg-meal-soft text-meal" : plan.saved ? "bg-surface-alt text-ink-soft" : "border border-dashed border-line-strong text-ink-faint"
          }`}
        >
          {plan.pushedAt && pushedTime ? d.pushedBadge(pushedTime, plan.pushedTo) : plan.saved ? d.savedBadge : d.draftBadge}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => void redraft()} disabled={busy !== null} className={PILL}>
            {d.redraft}
          </button>
          <button type="button" onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen} className={PILL}>
            ✦ {d.consult}
          </button>
          <button type="button" onClick={() => void push()} disabled={busy !== null || plan.blocks.every((b) => !b.push || b.fixed)} className={PRIMARY}>
            {busy === "push" ? d.pushing : plan.pushedAt ? d.pushAgain : d.push}
          </button>
        </div>
      </div>

      {nudge && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[12px] text-ink">
          <span>{nudge.text}</span>
          {nudge.action && (
            <button type="button" onClick={nudge.action} className={`${PILL} ml-auto border-accent text-accent`}>
              {d.toTomorrow} →
            </button>
          )}
        </div>
      )}
      {!plan.routineSet && (
        <p className="text-[11px] text-ink-faint">
          {d.routineHint}{" "}
          <Link href="/goals" className="text-accent underline-offset-2 hover:underline">
            {d.routineLink}
          </Link>
        </p>
      )}
      {notice && <p className="text-[11.5px] text-meal">{notice}</p>}
      <MealRecipeDialog mealId={recipeFor} onClose={closeRecipe} />
      {error && <p className="text-[11px] text-accent">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-[3.5rem_1fr]">
        <DayRibbon blocks={plan.blocks} hexOf={hexOf} />
        <ul className="flex flex-col">
          {plan.blocks.map((b) =>
            editing === b.id ? (
              <BlockEditor
                key={b.id}
                block={b}
                goals={plan.goals}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                  setEditing(null);
                  void saveBlocks(plan.blocks.map((x) => (x.id === b.id ? next : x)).sort((x, y) => x.start.localeCompare(y.start)));
                }}
                onDelete={() => {
                  setEditing(null);
                  void saveBlocks(plan.blocks.filter((x) => x.id !== b.id));
                }}
              />
            ) : (
              <li key={b.id} className="flex items-start gap-2 border-b border-line/60 py-1.5 last:border-b-0">
                <span className="w-[4.6rem] shrink-0 pt-0.5 font-mono text-[10px] text-ink-soft sm:w-[5.5rem] sm:text-[10.5px]">
                  {b.start}–{b.end}
                </span>
                <span className="mt-0.5 h-4 w-1 shrink-0 rounded-full" style={{ background: hexOf(b) }} />
                <button type="button" onClick={() => !b.fixed && setEditing(b.id)} className="min-w-0 flex-1 text-left" disabled={b.fixed}>
                  <span className={`text-[12.5px] ${b.kind === "SLEEP" ? "text-ink-faint" : "font-semibold text-ink"}`}>{b.title}</span>
                  <span className="ml-1.5 font-mono text-[9.5px] text-ink-faint">{b.fixed ? d.fixed : d.kind[b.kind]}</span>
                  {b.note && <span className="block text-[11px] leading-snug text-ink-soft">{b.note}</span>}
                </button>
                {(() => {
                  const meal = b.kind === "MEAL" ? plan.context.meals.find((m) => m.title === b.title && m.kind !== "READY") : undefined;
                  return (
                    meal && (
                      <button
                        type="button"
                        onClick={() => setRecipeFor(meal.id)}
                        className="shrink-0 rounded-full border border-[var(--color-meal)] px-2 py-0.5 font-mono text-[9.5px] text-[var(--color-meal)] hover:bg-[var(--color-meal-soft)]"
                      >
                        {t.meals.recipe.open}
                      </button>
                    )
                  );
                })()}
                {!b.fixed && (
                  <label className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-[9.5px] text-ink-faint" title={d.pushCol}>
                    <input
                      type="checkbox"
                      checked={b.push}
                      onChange={(e) => void saveBlocks(plan.blocks.map((x) => (x.id === b.id ? { ...x, push: e.target.checked } : x)))}
                      className="accent-[var(--color-accent)]"
                      aria-label={d.pushCol}
                    />
                    📅
                  </label>
                )}
              </li>
            ),
          )}
          <li className="pt-2">
            <button
              type="button"
              onClick={() => {
                const last = plan.blocks.filter((b) => b.kind !== "SLEEP").at(-1);
                const start = last && minutesOfTime(last.end) < 1380 ? last.end : "19:00";
                const id = `n${Date.now().toString(36)}`;
                const end = `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, "0")}${start.slice(2)}`;
                const block: DayBlock = { id, start, end: end > start ? end : "24:00", title: d.blockTitle, kind: "GOAL", goalId: plan.goals[0]?.id ?? null, note: "", fixed: false, push: true };
                void saveBlocks([...plan.blocks, block].sort((x, y) => x.start.localeCompare(y.start)));
                setEditing(id);
              }}
              className={PILL}
            >
              + {d.addBlock}
            </button>
          </li>
        </ul>
      </div>

      {(plan.context.dayRows.length > 0 || plan.context.steps.length > 0 || plan.context.training.length > 0) && (
        <details className="rounded-lg bg-surface-alt/50 px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] text-ink-soft">{d.materials}</summary>
          <ul className="mt-1.5 flex flex-col gap-1 text-[11px] text-ink-soft">
            {plan.context.dayRows.map((r, i) => (
              <li key={`r${i}`}>
                <span className="font-semibold text-ink">{r.title}</span> {r.time} — {r.work}
              </li>
            ))}
            {plan.context.steps.map((st, i) => (
              <li key={`s${i}`}>
                {st.dateKey.slice(5).replace("-", "/")} {t.plan.stepKind[st.kind] ?? st.kind}: {st.itemTitle} {st.label}
              </li>
            ))}
            {plan.context.training.map((x, i) => (
              <li key={`t${i}`}>
                {d.training}: {x.title} {x.minutes}分
              </li>
            ))}
          </ul>
        </details>
      )}

      {chatOpen && (
        <DayChat
          dateKey={dateKey}
          timeZone={timeZone}
          plan={plan}
          messages={messages}
          hexOf={hexOf}
          onMessages={setMessages}
          onApplied={(p, m) => {
            setPlan(p);
            setMessages(m);
          }}
        />
      )}
    </section>
  );
}

/** The whole day as one strip, midnight to midnight, each block in its colour. */
function DayRibbon({ blocks, hexOf }: { blocks: DayBlock[]; hexOf: (b: DayBlock) => string }) {
  const H = 300;
  return (
    <div className="relative hidden rounded-md bg-surface-alt/60 sm:block" style={{ height: H }} aria-hidden="true">
      {[0, 6, 12, 18].map((h) => (
        <span key={h} className="absolute left-0 -translate-y-1/2 font-mono text-[8.5px] text-ink-faint" style={{ top: (h / 24) * H }}>
          {h}
        </span>
      ))}
      {blocks.map((b) => {
        const top = (minutesOfTime(b.start) / 1440) * H;
        const height = Math.max(2, ((minutesOfTime(b.end) - minutesOfTime(b.start)) / 1440) * H);
        const hex = hexOf(b);
        return (
          <div
            key={b.id}
            className="absolute right-0.5 left-4 rounded-sm"
            title={`${b.start}–${b.end} ${b.title}`}
            style={{ top, height, background: b.kind === "SLEEP" ? tint(hex, 0.25) : b.fixed ? `repeating-linear-gradient(135deg, ${tint(hex, 0.6)} 0 3px, ${tint(hex, 0.25)} 3px 6px)` : tint(hex, 0.7) }}
          />
        );
      })}
    </div>
  );
}

function BlockEditor({
  block,
  goals,
  onSave,
  onCancel,
  onDelete,
}: {
  block: DayBlock;
  goals: DayPlanView["goals"];
  onSave: (b: DayBlock) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const d = t.plan.day;
  const [b, setB] = useState(block);
  const valid = b.title.trim() !== "" && b.end > b.start;
  return (
    <li className="my-1 flex flex-col gap-1.5 rounded-lg border border-accent/50 bg-accent/5 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="time" value={b.start} onChange={(e) => setB({ ...b, start: e.target.value })} className={INPUT} aria-label={t.plan.slotStart} />
        <span className="text-ink-faint">–</span>
        <input type="time" value={b.end === "24:00" ? "23:59" : b.end} onChange={(e) => setB({ ...b, end: e.target.value === "23:59" ? "24:00" : e.target.value })} className={INPUT} aria-label={t.plan.slotEnd} />
        <select value={b.kind} onChange={(e) => setB({ ...b, kind: e.target.value as DayBlock["kind"] })} className={INPUT}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {d.kind[k]}
            </option>
          ))}
        </select>
        <select value={b.goalId ?? ""} onChange={(e) => setB({ ...b, goalId: e.target.value || null })} className={`${INPUT} max-w-36`}>
          <option value="">{t.plan.noGoal}</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </div>
      <input value={b.title} onChange={(e) => setB({ ...b, title: e.target.value })} placeholder={d.blockTitle} className={`${INPUT} text-[12px]`} />
      <input value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} placeholder={d.blockNote} className={`${INPUT} text-[11.5px]`} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 font-mono text-[10px] text-ink-soft">
          <input type="checkbox" checked={b.push} onChange={(e) => setB({ ...b, push: e.target.checked })} className="accent-[var(--color-accent)]" />
          {d.pushCol}
        </label>
        <button type="button" onClick={() => valid && onSave(b)} disabled={!valid} className={`${PRIMARY} ml-auto`}>
          {t.plan.save}
        </button>
        <button type="button" onClick={onCancel} className={PILL}>
          {t.plan.cancel}
        </button>
        <button type="button" onClick={onDelete} className={PILL}>
          {t.plan.remove}
        </button>
      </div>
    </li>
  );
}

function DayChat({
  dateKey,
  timeZone,
  plan,
  messages,
  hexOf,
  onMessages,
  onApplied,
}: {
  dateKey: string;
  timeZone: string;
  plan: DayPlanView;
  messages: DayMessageView[];
  hexOf: (b: DayBlock) => string;
  onMessages: (m: DayMessageView[]) => void;
  onApplied: (p: DayPlanView, m: DayMessageView[]) => void;
}) {
  const { t } = useI18n();
  const d = t.plan.day;
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ progress: ChatProgress | null; startedAt: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: "nearest" }), [messages, pending]);

  async function send(body: string, startedAt: number) {
    const message = body.trim();
    if (!message || pending) return;
    setError(null);
    setText("");
    setPending({ progress: null, startedAt });
    onMessages([...messages, { id: "pending", role: "USER", content: message, proposal: null, applied: false, dismissed: false }]);
    try {
      const res = await postChatStream<DayMessageView>("/api/calendar/day-plan", { dateKey, text: message, timeZone }, (progress) => setPending((p) => (p ? { ...p, progress } : p)), t.plan.advisorFailed);
      if ("error" in res) {
        setError(res.error);
        setText(message);
        onMessages(messages);
      } else onMessages(res.messages);
    } finally {
      setPending(null);
    }
  }

  const diff = (blocks: DayBlock[]) => {
    const key = (b: DayBlock) => `${b.start}|${b.end}|${b.title}`;
    const now = new Set(plan.blocks.map(key));
    const next = new Set(blocks.map(key));
    const added = blocks.filter((b) => !now.has(key(b))).length;
    const removed = plan.blocks.filter((b) => !next.has(key(b))).length;
    return { added, removed, changed: Math.min(added, removed) };
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg/40 p-3">
      {messages.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            const res = await clearDayMessagesAction(dateKey);
            if (!("error" in res)) onMessages([]);
          }}
          className={`${PILL} ml-auto`}
        >
          {d.newChat}
        </button>
      )}
      <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
        {messages.map((m) =>
          m.role === "USER" ? (
            <p key={m.id} className="ml-10 self-end rounded-2xl rounded-br-sm bg-accent px-3 py-1.5 text-[12px] whitespace-pre-wrap text-on-accent">
              {m.content}
            </p>
          ) : (
            <div key={m.id} className="mr-6 flex flex-col gap-1.5">
              <p className="rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink">{m.content}</p>
              {m.proposal && m.proposal.blocks.length > 0 && (
                <div className={`flex flex-col gap-1.5 rounded-xl border p-2.5 ${m.applied || m.dismissed ? "border-line opacity-75" : "border-accent/60 bg-accent/5"}`}>
                  <p className="flex flex-wrap items-baseline gap-2 font-mono text-[10px] font-semibold text-accent">
                    {d.proposalHeading(m.proposal.blocks.length)}
                    {!m.applied && !m.dismissed && (() => {
                      const x = diff(m.proposal!.blocks);
                      return <span className="font-normal text-ink-faint">{d.proposalDiff(x.added, x.removed, x.changed)}</span>;
                    })()}
                  </p>
                  {m.proposal.reason && <p className="text-[11px] text-ink-soft">{m.proposal.reason}</p>}
                  <ul className="flex flex-col gap-0.5">
                    {m.proposal.blocks
                      .filter((b) => b.kind !== "SLEEP")
                      .map((b) => (
                        <li key={b.id} className="flex items-baseline gap-2 text-[11.5px]">
                          <span className="w-[5.5rem] shrink-0 font-mono text-[10px] text-ink-soft">
                            {b.start}–{b.end}
                          </span>
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: hexOf(b) }} />
                          <span className="text-ink">{b.title}</span>
                          {b.note && <span className="truncate text-[10.5px] text-ink-faint">{b.note}</span>}
                        </li>
                      ))}
                  </ul>
                  {m.applied ? (
                    <p className="font-mono text-[10px] text-ink-soft">✓ {t.plan.advisorApplied}</p>
                  ) : m.dismissed ? (
                    <p className="font-mono text-[10px] text-ink-faint">{t.plan.advisorDismissed}</p>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={async () => {
                          setBusyId(m.id);
                          try {
                            const res = await applyDayProposalAction(m.id, timeZone);
                            if ("error" in res) setError(res.error);
                            else onApplied(res.plan, res.messages);
                          } finally {
                            setBusyId(null);
                          }
                        }}
                        className={PRIMARY}
                      >
                        {busyId === m.id ? t.plan.advisorApplying : t.plan.advisorApply}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={async () => {
                          const res = await dismissDayProposalAction(m.id, dateKey);
                          if (!("error" in res)) onMessages(res.messages);
                        }}
                        className={PILL}
                      >
                        {t.plan.advisorDismiss}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        {pending && (
          <ChatThinking progress={pending.progress} startedAt={pending.startedAt} stageLabel={d.stage} itemsHeading={d.items} elapsedLabel={t.meals.chatElapsed} itemLabel={(i) => i.title} />
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="text-[11px] text-accent">{error}</p>}
      {messages.length === 0 && !pending && (
        <div className="flex flex-wrap gap-1.5">
          {d.suggestions.map((sug) => (
            <button key={sug} type="button" onClick={() => void send(sug, Date.now())} className={PILL}>
              {sug}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text, Date.now());
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={d.chatPlaceholder}
          disabled={pending !== null}
          className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-ink focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={!text.trim() || pending !== null} className={`${PRIMARY} py-2`}>
          {pending ? t.plan.advisorSending : t.plan.advisorSend}
        </button>
      </form>
    </div>
  );
}
