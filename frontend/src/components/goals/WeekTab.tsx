"use client";

import { useState, type CSSProperties } from "react";
import { createFocusPeriodAction, updateGoalAction, type GoalView } from "@/app/goals/actions";
import { createSlotAction, deleteSlotAction, savePlanAction, updateSlotAction } from "@/app/goals/planActions";
import type { LifeBudgetLine, SlotInput, SlotView } from "@/lib/goalPlan";
import { FocusPeriodCard } from "@/components/FocusPeriodCard";
import { Card, GoalSelect, HoursInput, INPUT, LABEL, NO_GOAL_HEX, PILL, PRIMARY, minutesOf, okOr, round1, type TabProps } from "@/components/goals/ui";
import { currentCycle } from "@/components/goals/cycleMath";
import { GOAL_COLORS, tint } from "@/lib/goalColors";
import { dayKindOf, periodFor } from "@/lib/goalFocus";
import { sleepHours, type Routine } from "@/lib/routine";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 1週間 — the time the plan has to spend: each area's weekly hours, the
 * whole 168 hours they fit into, and the standard week the hours are laid
 * out on. The budget is checked against the blocks: a mismatch shows.
 */
export function WeekTab(props: TabProps) {
  const { ov, setOv, todayKey, active, generation, onError } = props;
  const { t } = useI18n();
  const currentPeriod = periodFor(ov.periods, todayKey);
  const todayKind = dayKindOf(todayKey);

  return (
    <div className="flex flex-col gap-5">
      <RoutineCard key={`routine:${generation}`} {...props} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <BudgetCard {...props} />
        <LifeCard key={`life:${generation}`} {...props} />
      </div>
      <Timetable {...props} />

      <details className="rounded-xl border border-line px-4 py-3">
        <summary className="cursor-pointer font-mono text-[10px] tracking-wider text-ink-soft">{t.plan.oldPeriodsHeading}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.goals.daysIntro}</p>
          {ov.periods.map((p) => (
            <FocusPeriodCard
              key={`${p.id}:${generation}`}
              period={p}
              goals={active}
              current={currentPeriod?.id === p.id}
              todayKind={todayKind}
              onSaved={(next) => setOv((o) => ({ ...o, periods: o.periods.map((x) => (x.id === next.id ? next : x)) }))}
              onDeleted={() => setOv((o) => ({ ...o, periods: o.periods.filter((x) => x.id !== p.id) }))}
            />
          ))}
          <button
            type="button"
            onClick={async () => {
              const res = okOr(await createFocusPeriodAction({ label: "", fromDateKey: null, toDateKey: null, weekday: [], holiday: [], spare: [] }), onError);
              if (res) setOv((o) => ({ ...o, periods: [...o.periods, res.period] }));
            }}
            className={`${PILL} w-fit`}
          >
            + {t.goals.addPeriod}
          </button>
        </div>
      </details>
    </div>
  );
}

const slotHours = (s: Pick<SlotView, "startTime" | "endTime">) => Math.max(0, minutesOf(s.endTime) - minutesOf(s.startTime)) / 60;

function BudgetCard({ ov, setOv, active, hexes, onError }: TabProps) {
  const { t } = useI18n();
  const rows = active.map((g) => {
    const mine = ov.slots.filter((s) => s.goalId === g.id);
    const desk = round1(mine.filter((s) => !s.commute).reduce((a, s) => a + slotHours(s), 0));
    const commute = round1(mine.filter((s) => s.commute).reduce((a, s) => a + slotHours(s), 0));
    return { g, desk, commute, slots: round1(desk + commute) };
  });
  const totalBudget = round1(active.reduce((a, g) => a + g.weeklyHours, 0));
  const totalSlots = round1(rows.reduce((a, r) => a + r.slots, 0));

  async function patch(g: GoalView, p: { weeklyHours?: number; commuteHours?: number }) {
    const res = okOr(await updateGoalAction(g.id, p), onError);
    if (res) setOv((o) => ({ ...o, goals: o.goals.map((x) => (x.id === g.id ? res.goal : x)) }));
  }

  return (
    <Card title={t.plan.budgetHeading} intro={t.plan.budgetIntro}>
      {/* The week's hours as one bar, each area its share. */}
      {totalBudget > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full">
          {active
            .filter((g) => g.weeklyHours > 0)
            .map((g) => (
              <div key={g.id} title={`${g.title} ${g.weeklyHours}h`} style={{ width: `${(g.weeklyHours / totalBudget) * 100}%`, background: hexes.get(g.id) }} />
            ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[11.5px]">
          <thead>
            <tr className="text-left font-mono text-[9.5px] text-ink-faint">
              <th className="py-1 font-normal">{t.plan.goalLabel}</th>
              <th className="py-1 text-right font-normal">{t.plan.budgetPlanned}</th>
              <th className="py-1 text-right font-normal">{t.plan.commute}</th>
              <th className="py-1 text-right font-normal">{t.plan.budgetSlots}</th>
              <th className="py-1 pl-2 font-normal">{t.plan.budgetNote}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ g, desk, commute, slots }) => {
              const off = g.weeklyHours > 0 && Math.abs(slots - g.weeklyHours) >= 0.25;
              return (
                <tr key={g.id} className="border-t border-line">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hexes.get(g.id) }} />
                      <span className="font-semibold">{g.title}</span>
                    </span>
                  </td>
                  <td className="py-1 text-right">
                    <HoursInput value={g.weeklyHours} label={t.plan.budget} onSave={(h) => void patch(g, { weeklyHours: h })} />
                  </td>
                  <td className="py-1 text-right">
                    <HoursInput value={g.commuteHours} label={t.plan.commute} onSave={(h) => void patch(g, { commuteHours: h })} />
                  </td>
                  <td className={`py-1 text-right font-mono ${off ? "font-semibold text-accent" : "text-ink-soft"}`} title={`${t.plan.budgetDesk} ${desk}h / ${t.plan.budgetCommuteCol} ${commute}h`}>
                    {slots}h
                  </td>
                  <td className="py-1 pl-2 text-[10.5px] text-ink-faint">{g.budgetNote}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-line-strong font-mono font-semibold">
              <td className="py-1.5">{t.plan.total}</td>
              <td className="py-1.5 pr-1 text-right">{totalBudget}h</td>
              <td className="py-1.5 pr-1 text-right">{round1(active.reduce((a, g) => a + g.commuteHours, 0))}h</td>
              <td className={`py-1.5 text-right ${Math.abs(totalSlots - totalBudget) >= 0.25 ? "text-accent" : ""}`}>{totalSlots}h</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const LIFE_COLORS = ["#64748b", "#94a3b8", "#0e9fb3", "#7c8a1f", "#d39200", "#8b5cf6", "#e0457b", "#3b6fe0"];

/** The 168 hours as lines the owner keeps (sleep, university, work, …). */
function LifeCard({ ov, setOv, onError }: TabProps) {
  const { t } = useI18n();
  const [lines, setLines] = useState<LifeBudgetLine[]>(ov.plan.lifeBudget);
  const [dirty, setDirty] = useState(false);
  const total = round1(lines.reduce((a, l) => a + (Number.isFinite(l.hours) ? l.hours : 0), 0));
  const edit = (i: number, p: Partial<LifeBudgetLine>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  async function save() {
    const res = okOr(await savePlanAction({ lifeBudget: lines.filter((l) => l.label.trim()) }), onError);
    if (!res) return;
    setOv((o) => ({ ...o, plan: res.plan }));
    setLines(res.plan.lifeBudget);
    setDirty(false);
  }
  return (
    <Card title={t.plan.lifeHeading} action={<span className={`font-mono text-[10px] ${total > 168 ? "text-accent" : "text-ink-faint"}`}>{t.plan.lifeTotal(total)}</span>}>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-alt">
        {lines.map((l, i) => (
          <div key={i} title={`${l.label} ${l.hours}h`} style={{ width: `${(Math.max(0, l.hours) / Math.max(168, total)) * 100}%`, background: LIFE_COLORS[i % LIFE_COLORS.length] }} />
        ))}
      </div>
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: LIFE_COLORS[i % LIFE_COLORS.length] }} />
            <input value={l.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label={t.plan.lifeLabel} className={`${INPUT} w-32`} />
            <input
              type="number"
              min={0}
              max={168}
              step={0.5}
              value={l.hours}
              onChange={(e) => edit(i, { hours: Number(e.target.value) || 0 })}
              aria-label={t.plan.lifeHours}
              className={`${INPUT} w-16 text-right`}
            />
            <input value={l.note} onChange={(e) => edit(i, { note: e.target.value })} aria-label={t.plan.lifeNote} placeholder={t.plan.lifeNote} className={`${INPUT} min-w-0 flex-1 basis-40`} />
            <button type="button" onClick={() => (setLines((ls) => ls.filter((_, j) => j !== i)), setDirty(true))} aria-label={t.plan.remove} className="font-mono text-[11px] text-ink-faint hover:text-accent">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => (setLines((ls) => [...ls, { label: "", hours: 0, note: "" }]), setDirty(true))} className={PILL}>
          + {t.plan.add}
        </button>
        {dirty && (
          <button type="button" onClick={() => void save()} className={`${PRIMARY} ml-auto`}>
            {t.plan.save}
          </button>
        )}
      </div>
    </Card>
  );
}

const PX_PER_MIN = 0.75;
const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

/** The standard week: seven columns of time blocks, each in its area's colour. */
function Timetable({ ov, setOv, active, hexes, todayKey, onError }: TabProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ id: string | null; input: SlotInput } | null>(null);
  const cycle = currentCycle(ov);
  const first = cycle ? weekdayOf(cycle.fromDateKey) : 1;
  const days = Array.from({ length: 7 }, (_, i) => (first + i) % 7);
  const today = weekdayOf(todayKey);

  const starts = ov.slots.map((s) => minutesOf(s.startTime));
  const ends = ov.slots.map((s) => minutesOf(s.endTime));
  const lo = Math.min(6 * 60, ...starts.map((m) => Math.floor(m / 60) * 60));
  const hi = Math.max(23 * 60, ...ends.map((m) => Math.ceil(m / 60) * 60));
  const height = (hi - lo) * PX_PER_MIN;
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo + i * 60);

  async function save() {
    if (!editing) return;
    const res = okOr(editing.id ? await updateSlotAction(editing.id, editing.input) : await createSlotAction(editing.input), onError);
    if (!res) return;
    setOv((o) => ({ ...o, slots: editing.id ? o.slots.map((s) => (s.id === editing.id ? res.slot : s)) : [...o.slots, res.slot] }));
    setEditing(null);
  }

  return (
    <Card
      title={t.plan.timetableHeading}
      intro={t.plan.timetableIntro}
      action={
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: { weekday: today, startTime: "19:00", endTime: "20:00", goalId: active[0]?.id ?? null, label: "", commute: false } })}
          className={PILL}
        >
          + {t.plan.addSlot}
        </button>
      }
    >
      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
          <label className="flex flex-col gap-0.5">
            <span className={LABEL}>{t.plan.editSlotHeading}</span>
            <select value={editing.input.weekday} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, weekday: Number(e.target.value) } })} className={INPUT}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {t.plan.weekdayShort[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={LABEL}>{t.plan.slotStart}</span>
            <input type="time" value={editing.input.startTime} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, startTime: e.target.value } })} className={INPUT} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={LABEL}>{t.plan.slotEnd}</span>
            <input type="time" value={editing.input.endTime} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, endTime: e.target.value } })} className={INPUT} />
          </label>
          <GoalSelect goals={active} value={editing.input.goalId} onChange={(goalId) => setEditing({ ...editing, input: { ...editing.input, goalId } })} />
          <input
            value={editing.input.label}
            onChange={(e) => setEditing({ ...editing, input: { ...editing.input, label: e.target.value } })}
            placeholder={t.plan.slotLabel}
            className={`${INPUT} min-w-32 flex-1`}
          />
          <label className="flex items-center gap-1 pb-1 font-mono text-[10.5px] text-ink-soft">
            <input type="checkbox" checked={editing.input.commute} onChange={(e) => setEditing({ ...editing, input: { ...editing.input, commute: e.target.checked } })} className="accent-[var(--color-accent)]" />
            {t.plan.slotCommute}
          </label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void save()} disabled={editing.input.startTime >= editing.input.endTime} className={PRIMARY}>
              {t.plan.save}
            </button>
            {editing.id && (
              <button
                type="button"
                onClick={() => {
                  const id = editing.id!;
                  setOv((o) => ({ ...o, slots: o.slots.filter((s) => s.id !== id) }));
                  setEditing(null);
                  void deleteSlotAction(id);
                }}
                className={PILL}
              >
                {t.plan.remove}
              </button>
            )}
            <button type="button" onClick={() => setEditing(null)} className={PILL}>
              {t.plan.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] gap-x-1">
          <div />
          {days.map((d) => (
            <div key={d} className={`pb-1 text-center font-mono text-[10.5px] font-semibold ${d === today ? "text-accent" : d === 0 || d === 6 ? "text-ink-soft" : "text-ink"}`}>
              {t.plan.weekdayShort[d]}
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <span key={m} className="absolute right-1 -translate-y-1/2 font-mono text-[9px] text-ink-faint" style={{ top: (m - lo) * PX_PER_MIN }}>
                {m / 60}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={`relative rounded-md ${d === today ? "bg-accent/[0.05]" : "bg-surface-alt/40"}`} style={{ height }}>
              {hours.map((m) => (
                <div key={m} className="absolute inset-x-0 border-t border-line/60" style={{ top: (m - lo) * PX_PER_MIN }} />
              ))}
              {ov.slots
                .filter((s) => s.weekday === d)
                .map((s) => {
                  const hex = s.goalId ? (hexes.get(s.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX;
                  const top = (minutesOf(s.startTime) - lo) * PX_PER_MIN;
                  const h = Math.max(14, (minutesOf(s.endTime) - minutesOf(s.startTime)) * PX_PER_MIN);
                  const goal = active.find((g) => g.id === s.goalId);
                  const style: CSSProperties = {
                    top,
                    height: h,
                    borderLeft: `3px solid ${hex}`,
                    background: s.commute ? `repeating-linear-gradient(135deg, ${tint(hex, 0.3)} 0 4px, ${tint(hex, 0.1)} 4px 8px)` : tint(hex, 0.24),
                  };
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setEditing({ id: s.id, input: { weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, goalId: s.goalId, label: s.label, commute: s.commute } })}
                      title={`${s.startTime}–${s.endTime} ${goal?.title ?? ""} ${s.label}`}
                      className={`absolute inset-x-0.5 flex flex-col items-start justify-start overflow-hidden rounded-r-md px-1 py-0.5 text-left ${editing?.id === s.id ? "ring-2 ring-accent" : ""}`}
                      style={style}
                    >
                      <span className="block truncate font-mono text-[8.5px] text-ink-soft">{s.startTime}</span>
                      {h > 26 && <span className="block text-[9.5px] leading-tight font-semibold text-ink">{s.label || goal?.title}</span>}
                    </button>
                  );
                })}
            </div>
          ))}

          <div />
          {days.map((d) => {
            const total = round1(ov.slots.filter((s) => s.weekday === d && s.goalId).reduce((a, s) => a + slotHours(s), 0));
            return (
              <div key={d} className="pt-1 text-center font-mono text-[9.5px] text-ink-faint">
                {total > 0 ? t.plan.dayTotal(total) : "—"}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {active.map((g, i) => (
          <span key={g.id} className="flex items-center gap-1 font-mono text-[9.5px] text-ink-soft">
            <span className="h-2 w-2 rounded-sm" style={{ background: hexes.get(g.id) ?? GOAL_COLORS[i % GOAL_COLORS.length].hex }} />
            {g.title}
          </span>
        ))}
        <span className="flex items-center gap-1 font-mono text-[9.5px] text-ink-faint">
          <span className="h-2 w-3 rounded-sm" style={{ background: `repeating-linear-gradient(135deg, #94a3b8 0 2px, transparent 2px 4px)` }} />
          {t.plan.slotCommute}
        </span>
      </div>
    </Card>
  );
}

/**
 * 生活の基本 — when the day starts and ends, and each weekday's work: the
 * frame the calendar's day plan is drafted in.
 */
function RoutineCard({ ov, setOv, onError }: TabProps) {
  const { t } = useI18n();
  const r = t.plan.routine;
  const [routine, setRoutine] = useState<Routine>(ov.plan.routine);
  const [dirty, setDirty] = useState(false);
  const edit = (next: Routine) => {
    setRoutine(next);
    setDirty(true);
  };
  const day = (weekday: number, p: Partial<Routine["days"][number]>) => edit({ ...routine, days: routine.days.map((d) => (d.weekday === weekday ? { ...d, ...p } : d)) });
  async function save() {
    const res = okOr(await savePlanAction({ routine }), onError);
    if (!res) return;
    setOv((o) => ({ ...o, plan: res.plan }));
    setRoutine(res.plan.routine);
    setDirty(false);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <Card title={r.heading} intro={r.intro} action={<span className="font-mono text-[10px] text-ink-faint">{r.sleep(sleepHours(routine))}</span>}>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-ink-soft">
        <label className="flex items-center gap-1.5">
          {r.bed}
          <input type="time" value={routine.bed} onChange={(e) => edit({ ...routine, bed: e.target.value })} className={INPUT} />
        </label>
        <label className="flex items-center gap-1.5">
          {r.wake}
          <input type="time" value={routine.wake} onChange={(e) => edit({ ...routine, wake: e.target.value })} className={INPUT} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
          <thead>
            <tr className="text-left font-mono text-[9.5px] text-ink-faint">
              <th className="py-1 font-normal" />
              <th className="py-1 font-normal">{r.work}</th>
              <th className="py-1 font-normal">{r.hours}</th>
              <th className="py-1 font-normal">{r.office}</th>
              <th className="py-1 font-normal">{r.commute}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((w) => {
              const d = routine.days.find((x) => x.weekday === w)!;
              return (
                <tr key={w} className="border-t border-line">
                  <td className="py-1 pr-2 font-mono font-semibold">{t.plan.weekdayShort[w]}</td>
                  <td className="py-1">
                    <input type="checkbox" checked={d.work} onChange={(e) => day(w, { work: e.target.checked })} className="accent-[var(--color-accent)]" aria-label={r.work} />
                  </td>
                  <td className="py-1">
                    <span className={`flex items-center gap-1 ${d.work ? "" : "opacity-40"}`}>
                      <input type="time" value={d.start} disabled={!d.work} onChange={(e) => day(w, { start: e.target.value })} className={INPUT} />
                      〜
                      <input type="time" value={d.end} disabled={!d.work} onChange={(e) => day(w, { end: e.target.value })} className={INPUT} />
                    </span>
                  </td>
                  <td className="py-1">
                    <input type="checkbox" checked={d.office} disabled={!d.work} onChange={(e) => day(w, { office: e.target.checked })} className="accent-[var(--color-accent)]" aria-label={r.office} />
                  </td>
                  <td className="py-1">
                    <span className={`flex items-center gap-1 ${d.work && d.office ? "" : "opacity-40"}`}>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        step={5}
                        value={d.commuteMinutes || ""}
                        disabled={!d.work || !d.office}
                        onChange={(e) => day(w, { commuteMinutes: Number(e.target.value) || 0 })}
                        className={`${INPUT} w-16 text-right`}
                      />
                      <span className="font-mono text-[9.5px] text-ink-faint">{r.minutes}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dirty && (
        <button type="button" onClick={() => void save()} className={`${PRIMARY} w-fit`}>
          {t.plan.save}
        </button>
      )}
    </Card>
  );
}
