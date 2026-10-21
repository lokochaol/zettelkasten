"use client";

import { useState, type FormEvent } from "react";
import {
  createCycleAction,
  createEventAction,
  createTaskAction,
  deleteCycleAction,
  deleteEventAction,
  deleteOutcomeAction,
  deleteTaskAction,
  saveOutcomeAction,
  updateCycleAction,
  updateEventAction,
  updateTaskAction,
} from "@/app/goals/planActions";
import type { CycleView, EventInput, EventView, OutcomeView, TaskView } from "@/lib/goalPlan";
import { BlurText, Card, DateInput, EVENT_COLOR, EVENT_KINDS, GoalChip, GoalSelect, INPUT, LABEL, NO_GOAL_HEX, PILL, PRIMARY, okOr, useDay, type TabProps } from "@/components/goals/ui";
import { cyclePosition } from "@/components/goals/cycleMath";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { shiftDateKey } from "@/lib/dateKey";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 実行期間 — the stretch being lived now (the first 12 weeks): where it
 * is, what each area should have reached by the end and what will prove
 * it, what each 4-week phase is for, and the dates that pin it down.
 */
export function CycleTab(props: TabProps) {
  const { ov, setOv, todayKey, active, hexes, generation, onError } = props;
  const { t } = useI18n();
  const day = useDay();
  const [cycleId, setCycleId] = useState<string | null>(ov.currentCycleId);
  const cycle = ov.cycles.find((c) => c.id === cycleId) ?? ov.cycles.find((c) => c.id === ov.currentCycleId) ?? ov.cycles.at(-1) ?? null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const putCycle = (next: CycleView) => setOv((o) => ({ ...o, cycles: o.cycles.map((c) => (c.id === next.id ? next : c)) }));

  return (
    <div className="flex flex-col gap-5">
      {ov.cycles.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {ov.cycles.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCycleId(c.id)}
              className={`${PILL} ${c.id === cycle?.id ? "border-accent text-accent" : ""}`}
            >
              {c.label || `${day.short(c.fromDateKey)}〜`}
              {c.id === ov.currentCycleId ? " ●" : ""}
            </button>
          ))}
        </div>
      )}

      {cycle ? (
        <>
          <CycleHeader key={`${cycle.id}:${generation}`} cycle={cycle} todayKey={todayKey} onSaved={putCycle} onDelete={() => setConfirmDelete(true)} onError={onError} />

          <Card title={t.plan.outcomesHeading}>
            <div className="grid gap-3 md:grid-cols-2">
              {cycle.outcomes.map((o) => (
                <OutcomeCard
                  key={`${o.id}:${generation}`}
                  outcome={o}
                  cycle={cycle}
                  todayKey={todayKey}
                  goals={active}
                  hex={o.goalId ? (hexes.get(o.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX}
                  onSaved={putCycle}
                  onDeleted={() => {
                    putCycle({ ...cycle, outcomes: cycle.outcomes.filter((x) => x.id !== o.id) });
                    void deleteOutcomeAction(o.id);
                  }}
                  onError={onError}
                />
              ))}
            </div>
            <AddOutcome
              goals={active.filter((g) => !cycle.outcomes.some((o) => o.goalId === g.id))}
              onAdd={async (goalId, area) => {
                const res = okOr(await saveOutcomeAction(cycle.id, null, { goalId, area, target: "", evidence: "" }), onError);
                if (res) putCycle(res.cycle);
              }}
            />
          </Card>
        </>
      ) : (
        <NewCycle
          todayKey={todayKey}
          onCreated={(c) => {
            setOv((o) => ({ ...o, cycles: [...o.cycles, c], currentCycleId: o.currentCycleId ?? c.id }));
            setCycleId(c.id);
          }}
          onError={onError}
        />
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <EventsCard {...props} />
        <TasksCard {...props} />
      </div>

      {cycle && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">+ {t.plan.cycleCreate}</summary>
          <div className="mt-3">
            <NewCycle
              todayKey={shiftDateKey(cycle.toDateKey, 1)}
              onCreated={(c) => {
                setOv((o) => ({ ...o, cycles: [...o.cycles, c] }));
                setCycleId(c.id);
              }}
              onError={onError}
            />
          </div>
        </details>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={cycle?.label || t.plan.tab.cycle}
        warning={t.goals.deleteConfirmBody}
        confirmLabel={t.plan.remove}
        onConfirm={() => {
          setConfirmDelete(false);
          if (!cycle) return;
          setOv((o) => {
            const cycles = o.cycles.filter((c) => c.id !== cycle.id);
            return { ...o, cycles, currentCycleId: o.currentCycleId === cycle.id ? (cycles.at(-1)?.id ?? null) : o.currentCycleId };
          });
          setCycleId(null);
          void deleteCycleAction(cycle.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function CycleHeader({
  cycle,
  todayKey,
  onSaved,
  onDelete,
  onError,
}: {
  cycle: CycleView;
  todayKey: string;
  onSaved: (c: CycleView) => void;
  onDelete: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const day = useDay();
  const pos = cyclePosition(cycle, todayKey);

  async function save(patch: Partial<CycleView>) {
    const next = { ...cycle, ...patch };
    const redated = next.fromDateKey !== cycle.fromDateKey || next.toDateKey !== cycle.toDateKey;
    const res = okOr(
      await updateCycleAction(cycle.id, { label: next.label, fromDateKey: next.fromDateKey, toDateKey: next.toDateKey, note: next.note, phases: redated ? [] : next.phases }),
      onError,
    );
    if (res) onSaved(res.cycle);
  }

  const status = pos.week === 0 ? t.plan.cycleNotStarted : pos.week > pos.totalWeeks ? t.plan.cycleEnded : t.plan.cycleWeek(pos.week, pos.totalWeeks);
  const total = Date.parse(`${cycle.toDateKey}T00:00:00Z`) - Date.parse(`${cycle.fromDateKey}T00:00:00Z`) + 86_400_000;
  const pct = (key: string) => ((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${cycle.fromDateKey}T00:00:00Z`)) / total) * 100;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <BlurText value={cycle.label} placeholder={t.plan.cycleLabel} onSave={(label) => save({ label })} className="text-[15px] font-bold" />
        </div>
        <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-on-accent">{status}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-soft">
        <DateInput value={cycle.fromDateKey} onChange={(v) => v && void save({ fromDateKey: v })} label={t.plan.cycleFrom} />
        <span>〜</span>
        <DateInput value={cycle.toDateKey} onChange={(v) => v && void save({ toDateKey: v })} label={t.plan.cycleTo} />
        <button type="button" onClick={onDelete} className={`${PILL} ml-auto`}>
          {t.plan.remove}
        </button>
      </div>

      {/* The cycle as one bar: its phases as segments, today as the line. */}
      <div className="relative mt-1">
        <div className="flex h-7 overflow-hidden rounded-md">
          {cycle.phases.map((p, i) => {
            const current = i === pos.phaseIndex;
            const past = p.toDateKey < todayKey;
            return (
              <div
                key={i}
                className={`flex min-w-0 items-center justify-center border-r-2 border-surface px-1 font-mono text-[10px] last:border-r-0 ${
                  current ? "bg-accent font-semibold text-on-accent" : past ? "bg-accent/35 text-ink" : "bg-surface-alt text-ink-soft"
                }`}
                style={{ width: `${pct(shiftDateKey(p.toDateKey, 1)) - pct(p.fromDateKey)}%` }}
                title={`${p.label} ${p.fromDateKey}〜${p.toDateKey}`}
              >
                <span className="truncate">{p.label}</span>
              </div>
            );
          })}
        </div>
        {pos.week > 0 && pos.week <= pos.totalWeeks && (
          <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-ink" style={{ left: `${pos.progress * 100}%` }} aria-hidden="true" />
        )}
        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-faint">
          <span>{day.withWeekday(cycle.fromDateKey)}</span>
          <span>{day.withWeekday(cycle.toDateKey)}</span>
        </div>
      </div>
      <BlurText value={cycle.note} rows={2} placeholder={t.plan.lifeNote} onSave={(note) => save({ note })} />
    </section>
  );
}

function OutcomeCard({
  outcome,
  cycle,
  todayKey,
  goals,
  hex,
  onSaved,
  onDeleted,
  onError,
}: {
  outcome: OutcomeView;
  cycle: CycleView;
  todayKey: string;
  goals: TabProps["active"];
  hex: string;
  onSaved: (c: CycleView) => void;
  onDeleted: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const goal = goals.find((g) => g.id === outcome.goalId);
  const current = cycle.phases.findIndex((p) => p.fromDateKey <= todayKey && p.toDateKey >= todayKey);

  async function save(patch: Partial<OutcomeView>) {
    const next = { ...outcome, ...patch };
    const res = await saveOutcomeAction(cycle.id, outcome.id, next);
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    onSaved(res.cycle);
  }

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line border-t-4 p-3" style={{ borderTopColor: hex }}>
      <div className="flex items-center gap-2">
        {goal ? <GoalChip goal={goal} hex={hex} /> : <BlurText value={outcome.area} placeholder={t.plan.areaPlaceholder} mono onSave={(area) => save({ area })} />}
        <button type="button" onClick={onDeleted} aria-label={t.plan.remove} className="ml-auto font-mono text-[11px] text-ink-faint hover:text-accent">
          ×
        </button>
      </div>
      <BlurText label={t.plan.outcomeTarget} value={outcome.target} rows={2} onSave={(target) => save({ target })} />
      <BlurText label={t.plan.outcomeEvidence} value={outcome.evidence} rows={2} onSave={(evidence) => save({ evidence })} />
      <BlurText label={t.plan.outcomeHours} value={outcome.hoursNote} mono onSave={(hoursNote) => save({ hoursNote })} />
      {cycle.phases.length > 0 && (
        <ol className="flex flex-col gap-1 border-t border-line pt-2">
          {cycle.phases.map((p, i) => (
            <li
              key={i}
              className="grid grid-cols-[4.5rem_1fr] items-start gap-2 rounded-md px-1"
              style={i === current ? { background: tint(hex, 0.1) } : undefined}
            >
              <span className={`pt-1.5 font-mono text-[9.5px] ${i === current ? "font-semibold text-ink" : "text-ink-faint"}`}>{p.label}</span>
              <BlurText
                value={outcome.phaseTexts[i] ?? ""}
                rows={1}
                onSave={(v) => {
                  const texts = cycle.phases.map((_, j) => outcome.phaseTexts[j] ?? "");
                  texts[i] = v;
                  return save({ phaseTexts: texts });
                }}
                className="text-[11.5px]"
              />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function AddOutcome({ goals, onAdd }: { goals: TabProps["active"]; onAdd: (goalId: string | null, area: string) => Promise<void> }) {
  const { t } = useI18n();
  const [goalId, setGoalId] = useState<string | null>(goals[0]?.id ?? null);
  const [area, setArea] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd(goalId, goalId ? "" : area).then(() => setArea(""));
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <GoalSelect goals={goals} value={goalId} onChange={setGoalId} />
      {!goalId && <input value={area} onChange={(e) => setArea(e.target.value)} placeholder={t.plan.areaPlaceholder} className={`${INPUT} w-40`} />}
      <button type="submit" disabled={!goalId && !area.trim()} className={PILL}>
        + {t.plan.addOutcome}
      </button>
    </form>
  );
}

function NewCycle({ todayKey, onCreated, onError }: { todayKey: string; onCreated: (c: CycleView) => void; onError: (m: string | null) => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(shiftDateKey(todayKey, 12 * 7 - 1));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const res = okOr(await createCycleAction({ label, fromDateKey: from, toDateKey: to }), onError);
    if (res) onCreated(res.cycle);
  }
  return (
    <Card title={t.plan.cycleCreate} intro={t.plan.cycleNone}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.cycleLabel}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${INPUT} w-44`} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.cycleFrom}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} required />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.cycleTo}</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} required />
        </label>
        <button type="submit" disabled={!from || !to || from > to} className={PRIMARY}>
          {t.plan.cycleCreate}
        </button>
      </form>
    </Card>
  );
}

const blankEvent = (todayKey: string): EventInput => ({ goalId: null, kind: "DEADLINE", title: "", dateKey: todayKey, endDateKey: null, confirmed: true, done: false, note: "" });

/** The dates that hold the plan in place, nearest first; past ones folded away. */
function EventsCard({ ov, setOv, todayKey, active, hexes, onError }: TabProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<EventInput>(blankEvent(todayKey));
  const sorted = [...ov.events].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const upcoming = sorted.filter((e) => (e.endDateKey ?? e.dateKey) >= todayKey && !e.done);
  const past = sorted.filter((e) => !upcoming.includes(e));

  const put = (e: EventView) => setOv((o) => ({ ...o, events: o.events.map((x) => (x.id === e.id ? e : x)) }));
  async function patch(e: EventView, p: Partial<EventInput>) {
    put({ ...e, ...p } as EventView);
    const res = okOr(await updateEventAction(e.id, { ...e, ...p }), onError);
    if (res) put(res.event);
  }
  async function add(ev: FormEvent) {
    ev.preventDefault();
    const res = okOr(await createEventAction(draft), onError);
    if (!res) return;
    setOv((o) => ({ ...o, events: [...o.events, res.event] }));
    setDraft({ ...blankEvent(todayKey), kind: draft.kind });
  }

  const row = (e: EventView) => {
    const hex = EVENT_COLOR[e.kind];
    const goalHex = e.goalId ? hexes.get(e.goalId) : undefined;
    return (
      <li key={e.id} className={`flex flex-col gap-1 border-b border-line py-2 last:border-b-0 ${e.done ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={e.done} onChange={(x) => void patch(e, { done: x.target.checked })} aria-label={t.plan.done} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span className="rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold" style={{ background: tint(hex, 0.16), color: hex }}>
            {t.plan.eventKind[e.kind]}
          </span>
          <span className="font-mono text-[11px] text-ink">
            {e.dateKey.slice(5).replace("-", "/")}
            {e.endDateKey && `〜${e.endDateKey.slice(5).replace("-", "/")}`}
          </span>
          {goalHex && <span className="h-2 w-2 rounded-full" style={{ background: goalHex }} />}
          <span className={`min-w-0 flex-1 text-[12px] ${e.done ? "line-through" : ""}`}>{e.title}</span>
          <button
            type="button"
            onClick={() => void patch(e, { confirmed: !e.confirmed })}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9.5px] ${e.confirmed ? "border-line-strong text-ink-soft" : "border-dashed border-accent text-accent"}`}
          >
            {e.confirmed ? t.plan.confirmed : t.plan.candidate}
          </button>
          <button
            type="button"
            onClick={() => {
              setOv((o) => ({ ...o, events: o.events.filter((x) => x.id !== e.id) }));
              void deleteEventAction(e.id);
            }}
            aria-label={t.plan.remove}
            className="font-mono text-[11px] text-ink-faint hover:text-accent"
          >
            ×
          </button>
        </div>
        {e.note && <p className="pl-6 text-[11px] text-ink-faint">{e.note}</p>}
      </li>
    );
  };

  return (
    <Card title={t.plan.datesHeading} intro={ov.events.length === 0 ? t.plan.datesEmpty : undefined}>
      {upcoming.length > 0 && <ul className="flex flex-col">{upcoming.map(row)}</ul>}
      <form onSubmit={add} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-alt/60 p-2">
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={INPUT} aria-label={t.plan.eventKind.EVENT}>
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.plan.eventKind[k]}
            </option>
          ))}
        </select>
        <input type="date" value={draft.dateKey} onChange={(e) => setDraft({ ...draft, dateKey: e.target.value })} className={INPUT} aria-label={t.plan.eventDate} required />
        <DateInput value={draft.endDateKey} onChange={(v) => setDraft({ ...draft, endDateKey: v })} label={t.plan.eventEnd} />
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t.plan.eventTitle} className={`${INPUT} min-w-32 flex-1`} />
        <GoalSelect goals={active} value={draft.goalId} onChange={(goalId) => setDraft({ ...draft, goalId })} />
        <button type="submit" disabled={!draft.title.trim() || !draft.dateKey} className={PILL}>
          + {t.plan.addEvent}
        </button>
      </form>
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">
            {t.plan.past}（{past.length}）
          </summary>
          <ul className="mt-1 flex flex-col">{past.map(row)}</ul>
        </details>
      )}
    </Card>
  );
}

function TasksCard({ ov, setOv, active, hexes, onError }: TabProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [goalId, setGoalId] = useState<string | null>(null);
  const put = (task: TaskView) => setOv((o) => ({ ...o, tasks: o.tasks.map((x) => (x.id === task.id ? task : x)) }));
  const open = ov.tasks.filter((x) => !x.done);
  const done = ov.tasks.filter((x) => x.done);

  const row = (task: TaskView) => (
    <li key={task.id} className="flex items-start gap-2 py-1">
      <input
        type="checkbox"
        checked={task.done}
        onChange={async (e) => {
          put({ ...task, done: e.target.checked });
          const res = okOr(await updateTaskAction(task.id, { ...task, done: e.target.checked }), onError);
          if (res) put(res.task);
        }}
        className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        aria-label={t.plan.done}
      />
      {task.goalId && <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full" style={{ background: hexes.get(task.goalId) ?? NO_GOAL_HEX }} />}
      <div className={`min-w-0 flex-1 ${task.done ? "text-ink-faint line-through" : ""}`}>
        <BlurText
          value={task.text}
          onSave={async (v) => {
            if (!v.trim()) return;
            const res = okOr(await updateTaskAction(task.id, { ...task, text: v }), onError);
            if (res) put(res.task);
          }}
        />
      </div>
      {task.dueDateKey && <span className="pt-1.5 font-mono text-[10px] text-ink-faint">{task.dueDateKey.slice(5).replace("-", "/")}</span>}
      <button
        type="button"
        onClick={() => {
          setOv((o) => ({ ...o, tasks: o.tasks.filter((x) => x.id !== task.id) }));
          void deleteTaskAction(task.id);
        }}
        aria-label={t.plan.remove}
        className="pt-1 font-mono text-[11px] text-ink-faint hover:text-accent"
      >
        ×
      </button>
    </li>
  );

  return (
    <Card title={t.plan.tasksHeading}>
      <ul className="flex flex-col">{open.map(row)}</ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const res = okOr(await createTaskAction({ goalId, text, dueDateKey: null, done: false }), onError);
          if (!res) return;
          setOv((o) => ({ ...o, tasks: [...o.tasks, res.task] }));
          setText("");
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.plan.taskPlaceholder} className={`${INPUT} min-w-0 flex-1`} />
        <GoalSelect goals={active} value={goalId} onChange={setGoalId} className="max-w-36" />
        <button type="submit" disabled={!text.trim()} className={PILL}>
          +
        </button>
      </form>
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">
            {t.plan.done}（{done.length}）
          </summary>
          <ul className="mt-1 flex flex-col">{done.map(row)}</ul>
        </details>
      )}
    </Card>
  );
}
