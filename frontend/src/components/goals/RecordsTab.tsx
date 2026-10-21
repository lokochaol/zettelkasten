"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  createDeliverableAction,
  createExperimentAction,
  deleteDeliverableAction,
  deleteExperimentAction,
  deleteReviewAction,
  getWeekRecordsAction,
  moveDeliverableAction,
  saveDailyLogAction,
  saveReviewAction,
  updateDeliverableAction,
  updateExperimentAction,
} from "@/app/goals/planActions";
import type {
  DailyLogInput,
  DailyLogView,
  DeliverableInput,
  DeliverableView,
  ExperimentInput,
  ExperimentView,
  LongReviewData,
  ReviewView,
  WeekRecords,
  WeeklyReviewData,
} from "@/lib/goalPlan";
import { weekMetric } from "@/lib/goalMetrics";
import { Spinner } from "@/components/LoadingSpinner";
import {
  BlurText,
  Card,
  DELIVERABLE_STATUSES,
  DateInput,
  EXPERIMENT_STATUSES,
  GoalChip,
  GoalSelect,
  HoursInput,
  INPUT,
  LABEL,
  Meter,
  NO_GOAL_HEX,
  PILL,
  PRIMARY,
  STATUS_COLOR,
  okOr,
  round1,
  useDay,
  type TabProps,
} from "@/components/goals/ui";
import { currentCycle } from "@/components/goals/cycleMath";
import { shiftDateKey } from "@/lib/dateKey";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const MAX_DELIVERABLES = 3;

export function weekStartFor(todayKey: string, cycleFrom: string | null): string {
  const weekday = cycleFrom ? new Date(`${cycleFrom}T00:00:00Z`).getUTCDay() : 1;
  const day = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  return shiftDateKey(todayKey, -((day - weekday + 7) % 7));
}

const emptyLog = (dateKey: string): DailyLogView => ({
  dateKey,
  special: false,
  hours: {},
  commuteHours: 0,
  progress: "",
  blocker: "",
  next: "",
  life: "",
});

const emptyWeekly = (): WeeklyReviewData => ({
  specialReason: "",
  fixed: "",
  partner: "",
  plannedHours: {},
  quality: "",
  lifeNotes: "",
  blocker: "",
  hypothesis: "",
  change: "",
  changeEvidence: "",
  carryContinue: "",
  carryShrink: "",
  carryPostpone: "",
  carryStop: "",
  scheduleChange: "",
});

/**
 * 記録 — the plan's daily 1–2 minutes and its Sunday 20: what each day
 * went to, the week's planned against actual hours, its (at most three)
 * priority deliverables and the one change for next week; then the 4- and
 * 12-week reviews and the experiments that test a change.
 */
export function RecordsTab(props: TabProps) {
  const { ov, todayKey, active } = props;
  const { t } = useI18n();
  const day = useDay();
  const cycle = currentCycle(ov);
  const thisWeek = weekStartFor(todayKey, cycle?.fromDateKey ?? null);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [rec, setRec] = useState<WeekRecords | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayKey);

  useEffect(() => {
    let live = true;
    void getWeekRecordsAction(weekStart).then((r) => live && setRec(r));
    return () => {
      live = false;
    };
  }, [weekStart]);

  const days = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStart, i));
  const go = (key: string) => {
    setRec(null);
    setWeekStart(key);
    setSelectedDay(key === thisWeek ? todayKey : key);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(shiftDateKey(weekStart, -7))} className={PILL} aria-label={t.plan.prevWeek}>
          ←
        </button>
        <span className="font-mono text-[12px] font-semibold text-ink">
          {t.plan.weekOf(day.withWeekday(weekStart), day.withWeekday(shiftDateKey(weekStart, 6)))}
        </span>
        <button type="button" onClick={() => go(shiftDateKey(weekStart, 7))} className={PILL} aria-label={t.plan.nextWeek}>
          →
        </button>
        {weekStart !== thisWeek && (
          <button type="button" onClick={() => go(thisWeek)} className={PILL}>
            {t.plan.thisWeek}
          </button>
        )}
      </div>

      {!rec ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <WeekSummary {...props} rec={rec} />
          <DailyCard
            {...props}
            days={days}
            rec={rec}
            selected={days.includes(selectedDay) ? selectedDay : days[0]}
            onSelect={setSelectedDay}
            onLog={(log) =>
              setRec(
                (r) =>
                  r && {
                    ...r,
                    logs: [...r.logs.filter((l) => l.dateKey !== log.dateKey), log].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
                  },
              )
            }
          />
          <WeeklyReviewCard key={`wr:${weekStart}`} {...props} rec={rec} setRec={setRec} />
          <LongReviews {...props} rec={rec} setRec={setRec} />
          <Experiments {...props} rec={rec} setRec={setRec} />
        </>
      )}
      {active.length === 0 && <p className="text-[11px] text-ink-faint">{t.goals.empty}</p>}
    </div>
  );
}

type RecProps = TabProps & {
  rec: WeekRecords;
  setRec: (u: (r: WeekRecords | null) => WeekRecords | null) => void;
};

/** Planned against actual for the week shown, per area. */
function WeekSummary({ active, hexes, rec }: TabProps & { rec: WeekRecords }) {
  const { t } = useI18n();
  const plannedOverride = rec.review && Object.keys(rec.review.data.plannedHours).length > 0 ? rec.review.data.plannedHours : null;
  const m = weekMetric(rec.weekStartDateKey, active, rec.logs, plannedOverride, rec.review?.special ?? false);
  return (
    <Card
      title={t.plan.weeklyHeading}
      action={
        <span className="font-mono text-[10px] text-ink-faint">
          {m.special ? `${t.plan.specialWeek} · ` : ""}
          {m.recorded ? `${m.recordedDays}/7 ${t.plan.logged}` : `${t.plan.notRecorded} (${m.recordedDays}/7)`}
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        {active
          .filter((g) => g.weeklyHours > 0 || m.goals.some((x) => x.goalId === g.id))
          .map((g) => {
            const row = m.goals.find((x) => x.goalId === g.id);
            const planned = row?.planned ?? g.weeklyHours;
            const actual = row?.actual ?? 0;
            const hex = hexes.get(g.id) ?? NO_GOAL_HEX;
            return (
              <div key={g.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,9rem)_1fr_auto]">
                <GoalChip goal={g} hex={hex} />
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  <Meter value={actual} max={Math.max(planned, actual, 0.01)} hex={hex} mark={planned * 0.8} />
                </div>
                <span className="text-right font-mono text-[10.5px] whitespace-nowrap text-ink-soft sm:w-28">
                  {round1(actual)} / {planned}h
                  {row?.rate != null && (
                    <span className={`ml-1.5 font-semibold ${row.rate < 0.8 ? "text-accent" : "text-ink"}`}>{Math.round(row.rate * 100)}%</span>
                  )}
                </span>
              </div>
            );
          })}
        <div className="flex justify-end border-t border-line pt-1.5 font-mono text-[10.5px] font-semibold text-ink">
          {t.plan.total} {m.totalActual} / {m.totalPlanned}h
        </div>
      </div>
    </Card>
  );
}

function DailyCard({
  active,
  hexes,
  todayKey,
  days,
  rec,
  selected,
  onSelect,
  onLog,
  onError,
}: TabProps & {
  days: string[];
  rec: WeekRecords;
  selected: string;
  onSelect: (d: string) => void;
  onLog: (l: DailyLogView) => void;
}) {
  const { t } = useI18n();
  const day = useDay();
  const log = rec.logs.find((l) => l.dateKey === selected) ?? emptyLog(selected);

  async function save(p: Partial<DailyLogInput>) {
    const next = { ...log, ...p };
    onLog(next);
    const res = await saveDailyLogAction(selected, next);
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    onLog(res.log);
  }

  return (
    <Card title={t.plan.dailyHeading} intro={t.plan.dailyIntro}>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const l = rec.logs.find((x) => x.dateKey === d);
          const total = l ? round1(Object.values(l.hours).reduce((a, h) => a + h, 0)) : null;
          const future = d > todayKey;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={d === selected}
              className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 ${
                d === selected ? "border-accent bg-accent/10" : "border-line hover:border-line-strong"
              } ${future ? "opacity-50" : ""}`}
            >
              <span
                className={`flex flex-col items-center font-mono text-[9.5px] leading-tight sm:flex-row sm:gap-1 ${d === todayKey ? "font-semibold text-accent" : "text-ink-soft"}`}
              >
                <span>{t.plan.weekdayShort[new Date(`${d}T00:00:00Z`).getUTCDay()]}</span>
                <span>{day.short(d)}</span>
              </span>
              {l ? (
                <>
                  <span className="font-mono text-[11px] font-semibold text-ink">{total}h</span>
                  {/* the day's hours as a tiny stacked bar */}
                  <span className="flex h-1 w-full overflow-hidden rounded-full bg-surface-alt">
                    {Object.entries(l.hours).map(([gid, h]) => (
                      <span
                        key={gid}
                        style={{
                          width: `${(h / Math.max(total ?? 1, 0.01)) * 100}%`,
                          background: hexes.get(gid) ?? NO_GOAL_HEX,
                        }}
                      />
                    ))}
                  </span>
                </>
              ) : (
                <span className="text-center font-mono text-[8.5px] leading-tight text-ink-faint">{future ? "·" : t.plan.notLogged}</span>
              )}
            </button>
          );
        })}
      </div>

      <div key={selected} className="flex flex-col gap-3 rounded-lg bg-surface-alt/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-ink">{day.withWeekday(selected)}</span>
          <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-ink-soft">
            <input
              type="checkbox"
              checked={log.special}
              onChange={(e) => void save({ special: e.target.checked }).catch(() => {})}
              className="accent-[var(--color-accent)]"
            />
            {t.plan.special}
          </label>
        </div>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {active.map((g) => (
            <label key={g.id} className="flex items-center justify-between gap-2">
              <GoalChip goal={g} hex={hexes.get(g.id) ?? NO_GOAL_HEX} />
              <HoursInput
                value={log.hours[g.id] ?? 0}
                label={`${g.title} ${t.plan.hoursLabel}`}
                onSave={(h) => void save({ hours: { ...log.hours, [g.id]: h } }).catch(() => {})}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2 font-mono text-[10.5px] text-ink-faint">
            {t.plan.commuteHoursLabel}
            <HoursInput value={log.commuteHours} label={t.plan.commuteHoursLabel} onSave={(h) => void save({ commuteHours: h }).catch(() => {})} />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <BlurText label={t.plan.progress} value={log.progress} rows={2} onSave={(v) => save({ progress: v })} />
          <BlurText label={t.plan.blocker} value={log.blocker} rows={2} onSave={(v) => save({ blocker: v })} />
          <BlurText label={t.plan.next} value={log.next} rows={2} onSave={(v) => save({ next: v })} />
          <BlurText label={t.plan.life} value={log.life} rows={2} onSave={(v) => save({ life: v })} />
        </div>
      </div>
    </Card>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const { t } = useI18n();
  const hex = STATUS_COLOR[value] ?? NO_GOAL_HEX;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold focus:outline-none"
      style={{ borderColor: hex, color: hex, background: tint(hex, 0.1) }}
    >
      {DELIVERABLE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t.plan.status[s]}
        </option>
      ))}
    </select>
  );
}

function DeliverableRow({
  d,
  goals,
  hex,
  onSaved,
  onDelete,
  extra,
  onError,
}: {
  d: DeliverableView;
  goals: TabProps["active"];
  hex: string;
  onSaved: (d: DeliverableView) => void;
  onDelete?: () => void;
  extra?: ReactNode;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  async function save(p: Partial<DeliverableInput>) {
    const res = await updateDeliverableAction(d.id, { ...d, ...p });
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    onSaved(res.deliverable);
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line border-l-4 p-2.5" style={{ borderLeftColor: hex }}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusSelect value={d.status} onChange={(status) => void save({ status }).catch(() => {})} />
        <div className="min-w-0 flex-1">
          <BlurText value={d.title} onSave={(title) => (title.trim() ? save({ title }) : undefined)} className="font-semibold" />
        </div>
        {extra}
        {onDelete && (
          <button type="button" onClick={onDelete} aria-label={t.plan.remove} className="font-mono text-[11px] text-ink-faint hover:text-accent">
            ×
          </button>
        )}
      </div>
      <div className="grid gap-x-3 gap-y-1 sm:grid-cols-[1fr_1fr_auto]">
        <BlurText label={t.plan.deliverableCondition} value={d.condition} onSave={(condition) => save({ condition })} />
        <BlurText label={t.plan.deliverableEvidence} value={d.evidence} onSave={(evidence) => save({ evidence })} />
        <div className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.deliverableCheck}</span>
          <div className="flex items-center gap-1">
            <DateInput value={d.checkDateKey} onChange={(checkDateKey) => void save({ checkDateKey }).catch(() => {})} label={t.plan.deliverableCheck} />
            <GoalSelect goals={goals} value={d.goalId} onChange={(goalId) => void save({ goalId }).catch(() => {})} className="max-w-28" />
          </div>
        </div>
      </div>
    </li>
  );
}

function WeeklyReviewCard({ active, hexes, rec, setRec, onError }: RecProps) {
  const { t } = useI18n();
  const day = useDay();
  const [data, setData] = useState<WeeklyReviewData>(rec.review?.data ?? emptyWeekly());
  const [special, setSpecial] = useState(rec.review?.special ?? false);
  const [draft, setDraft] = useState<DeliverableInput>({
    goalId: active[0]?.id ?? null,
    title: "",
    condition: "",
    status: "NOT_STARTED",
    evidence: "",
    checkDateKey: null,
  });

  async function save(p: Partial<WeeklyReviewData>, nextSpecial = special) {
    const next = { ...data, ...p };
    setData(next);
    const res = await saveReviewAction("WEEKLY", rec.weekStartDateKey, nextSpecial, next);
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    setRec((r) => r && { ...r, review: res.review as ReviewView<WeeklyReviewData> });
  }

  const putDeliverable = (d: DeliverableView) =>
    setRec(
      (r) =>
        r && {
          ...r,
          deliverables: r.deliverables.some((x) => x.id === d.id) ? r.deliverables.map((x) => (x.id === d.id ? d : x)) : r.deliverables,
          carried: r.carried.map((x) => (x.id === d.id ? d : x)),
        },
    );

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = okOr(await createDeliverableAction(rec.weekStartDateKey, draft), onError);
    if (!res) return;
    setRec((r) => r && { ...r, deliverables: [...r.deliverables, res.deliverable] });
    setDraft({
      ...draft,
      title: "",
      condition: "",
      evidence: "",
      checkDateKey: null,
    });
  }

  const full = rec.deliverables.length >= MAX_DELIVERABLES;
  const hexOf = (goalId: string | null) => (goalId ? (hexes.get(goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX);

  return (
    <Card title={t.plan.prioritiesHeading(rec.deliverables.length)}>
      <div className="grid gap-2 sm:grid-cols-2">
        <BlurText label={t.plan.fixed} value={data.fixed} rows={2} onSave={(fixed) => save({ fixed })} />
        <BlurText label={t.plan.partner} value={data.partner} rows={2} onSave={(partner) => save({ partner })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-soft">
          <input
            type="checkbox"
            checked={special}
            onChange={(e) => {
              setSpecial(e.target.checked);
              void save({}, e.target.checked).catch(() => {});
            }}
            className="accent-[var(--color-accent)]"
          />
          {t.plan.special}
        </label>
        {special && (
          <div className="min-w-0 flex-1">
            <BlurText value={data.specialReason} placeholder={t.plan.specialReason} onSave={(specialReason) => save({ specialReason })} />
          </div>
        )}
      </div>
      <details>
        <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">
          {t.plan.plannedCol}: {active.map((g) => `${g.title.slice(0, 6)} ${data.plannedHours[g.id] ?? g.weeklyHours}`).join(" · ")}
        </summary>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {active.map((g) => (
            <label key={g.id} className="flex items-center justify-between gap-2">
              <GoalChip goal={g} hex={hexOf(g.id)} />
              <HoursInput
                value={data.plannedHours[g.id] ?? g.weeklyHours}
                label={`${g.title} ${t.plan.plannedCol}`}
                onSave={(h) =>
                  void save({
                    plannedHours: { ...data.plannedHours, [g.id]: h },
                  }).catch(() => {})
                }
              />
            </label>
          ))}
        </div>
      </details>

      <ul className="flex flex-col gap-2">
        {rec.deliverables.map((d) => (
          <DeliverableRow
            key={d.id}
            d={d}
            goals={active}
            hex={hexOf(d.goalId)}
            onSaved={putDeliverable}
            onDelete={() => {
              setRec(
                (r) =>
                  r && {
                    ...r,
                    deliverables: r.deliverables.filter((x) => x.id !== d.id),
                  },
              );
              void deleteDeliverableAction(d.id);
            }}
            onError={onError}
          />
        ))}
      </ul>
      {!full && (
        <form onSubmit={add} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-alt/60 p-2">
          <GoalSelect goals={active} value={draft.goalId} onChange={(goalId) => setDraft({ ...draft, goalId })} className="max-w-36" />
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={t.plan.deliverableTitle}
            className={`${INPUT} min-w-32 flex-1`}
          />
          <input
            value={draft.condition}
            onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
            placeholder={t.plan.deliverableCondition}
            className={`${INPUT} min-w-32 flex-1`}
          />
          <button type="submit" disabled={!draft.title.trim()} className={PILL}>
            + {t.plan.addDeliverable}
          </button>
        </form>
      )}

      {rec.carried.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className={LABEL}>{t.plan.carriedHeading}</p>
          <ul className="flex flex-col gap-2 opacity-90">
            {rec.carried.map((d) => (
              <DeliverableRow
                key={d.id}
                d={d}
                goals={active}
                hex={hexOf(d.goalId)}
                onSaved={putDeliverable}
                onError={onError}
                extra={
                  <>
                    <span className="font-mono text-[9.5px] text-ink-faint">{day.short(d.weekStartDateKey)}〜</span>
                    <button
                      type="button"
                      disabled={full}
                      onClick={async () => {
                        const res = okOr(await moveDeliverableAction(d.id, rec.weekStartDateKey), onError);
                        if (res)
                          setRec(
                            (r) =>
                              r && {
                                ...r,
                                carried: r.carried.filter((x) => x.id !== d.id),
                                deliverables: [...r.deliverables, res.deliverable],
                              },
                          );
                      }}
                      className={PILL}
                    >
                      {t.plan.carryHere}
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.plan.reflectionHeading}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <BlurText label={t.plan.quality} value={data.quality} rows={2} onSave={(quality) => save({ quality })} />
          <BlurText label={t.plan.lifeNotes} value={data.lifeNotes} rows={2} onSave={(lifeNotes) => save({ lifeNotes })} />
          <BlurText label={t.plan.weekBlocker} value={data.blocker} rows={2} onSave={(blocker) => save({ blocker })} />
          <BlurText label={t.plan.hypothesis} value={data.hypothesis} rows={2} onSave={(hypothesis) => save({ hypothesis })} />
        </div>
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-2">
          <BlurText label={t.plan.change} value={data.change} rows={2} onSave={(change) => save({ change })} />
          <BlurText label={t.plan.changeEvidence} value={data.changeEvidence} onSave={(changeEvidence) => save({ changeEvidence })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <BlurText label={t.plan.carryContinue} value={data.carryContinue} rows={2} onSave={(carryContinue) => save({ carryContinue })} />
          <BlurText label={t.plan.carryShrink} value={data.carryShrink} rows={2} onSave={(carryShrink) => save({ carryShrink })} />
          <BlurText label={t.plan.carryPostpone} value={data.carryPostpone} rows={2} onSave={(carryPostpone) => save({ carryPostpone })} />
          <BlurText label={t.plan.carryStop} value={data.carryStop} rows={2} onSave={(carryStop) => save({ carryStop })} />
        </div>
        <BlurText label={t.plan.scheduleChange} value={data.scheduleChange} rows={2} onSave={(scheduleChange) => save({ scheduleChange })} />
      </div>
    </Card>
  );
}

type LongKind = "FOUR_WEEK" | "TWELVE_WEEK";

function LongReviews({ ov, active, hexes, todayKey, rec, setRec, onError }: RecProps) {
  const { t } = useI18n();
  const day = useDay();
  const cycle = currentCycle(ov);
  const [kind, setKind] = useState<LongKind>("FOUR_WEEK");

  async function create() {
    const from = kind === "TWELVE_WEEK" && cycle ? cycle.fromDateKey : shiftDateKey(todayKey, -27);
    const data: LongReviewData = {
      periodFrom: from,
      periodTo: todayKey,
      rows: active.map((g) => ({
        goalId: g.id,
        area: "",
        outcome: "",
        change: "",
        next: "",
      })),
      keep: "",
      change: "",
      addPostpone: "",
      nextBudget: "",
      nextTargets: "",
      ganttChanges: "",
      unknowns: "",
      firstWeek: "",
    };
    const res = okOr(await saveReviewAction(kind, todayKey, false, data), onError);
    if (!res) return;
    const review = res.review as ReviewView<LongReviewData>;
    setRec(
      (r) =>
        r && {
          ...r,
          longReviews: [review, ...r.longReviews.filter((x) => x.id !== review.id)],
        },
    );
  }

  return (
    <Card
      title={t.plan.longHeading}
      action={
        <>
          <select value={kind} onChange={(e) => setKind(e.target.value as LongKind)} className={INPUT}>
            <option value="FOUR_WEEK">{t.plan.longKind.FOUR_WEEK}</option>
            <option value="TWELVE_WEEK">{t.plan.longKind.TWELVE_WEEK}</option>
          </select>
          <button type="button" onClick={() => void create()} className={PILL}>
            + {t.plan.longNew}
          </button>
        </>
      }
    >
      {rec.longReviews.map((r, i) => (
        <details key={r.id} open={i === 0 && r.dateKey >= shiftDateKey(todayKey, -7)} className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10.5px] text-ink">
            <span className="font-semibold">{t.plan.longKind[r.kind as LongKind]}</span> · {day.full(r.dateKey)}
            {r.data.periodFrom && <span className="ml-2 text-ink-faint">{t.plan.weekOf(day.short(r.data.periodFrom), day.short(r.data.periodTo))}</span>}
          </summary>
          <LongReviewBody
            review={r}
            goals={active}
            hexes={hexes}
            onSaved={(next) =>
              setRec(
                (x) =>
                  x && {
                    ...x,
                    longReviews: x.longReviews.map((y) => (y.id === next.id ? next : y)),
                  },
              )
            }
            onDelete={() => {
              setRec(
                (x) =>
                  x && {
                    ...x,
                    longReviews: x.longReviews.filter((y) => y.id !== r.id),
                  },
              );
              void deleteReviewAction(r.id);
            }}
            onError={onError}
          />
        </details>
      ))}
    </Card>
  );
}

function LongReviewBody({
  review,
  goals,
  hexes,
  onSaved,
  onDelete,
  onError,
}: {
  review: ReviewView<LongReviewData>;
  goals: TabProps["active"];
  hexes: Map<string, string>;
  onSaved: (r: ReviewView<LongReviewData>) => void;
  onDelete: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState(review.data);
  async function save(p: Partial<LongReviewData>) {
    const next = { ...data, ...p };
    setData(next);
    const res = await saveReviewAction(review.kind, review.dateKey, review.special, next);
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    onSaved(res.review as ReviewView<LongReviewData>);
  }
  const saveRow = (i: number, p: Partial<LongReviewData["rows"][number]>) => save({ rows: data.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 font-mono text-[10px] text-ink-soft">
        {t.plan.periodFrom}
        <DateInput value={data.periodFrom || null} onChange={(v) => void save({ periodFrom: v ?? "" }).catch(() => {})} />
        〜
        <DateInput value={data.periodTo || null} onChange={(v) => void save({ periodTo: v ?? "" }).catch(() => {})} />
        <button type="button" onClick={onDelete} className={`${PILL} ml-auto`}>
          {t.plan.remove}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {data.rows.map((row, i) => {
          const goal = goals.find((g) => g.id === row.goalId);
          const hex = row.goalId ? (hexes.get(row.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX;
          return (
            <div key={i} className="grid gap-x-3 gap-y-1 border-l-4 pl-2 md:grid-cols-[8rem_1fr_1fr_1fr]" style={{ borderColor: hex }}>
              <span className="pt-1">
                {goal ? <GoalChip goal={goal} hex={hex} /> : <span className="font-mono text-[10.5px] text-ink-soft">{row.area}</span>}
              </span>
              <BlurText label={t.plan.longOutcome} value={row.outcome} rows={2} onSave={(outcome) => saveRow(i, { outcome })} />
              <BlurText label={t.plan.longChange} value={row.change} rows={2} onSave={(change) => saveRow(i, { change })} />
              <BlurText label={t.plan.longNext} value={row.next} rows={2} onSave={(next) => saveRow(i, { next })} />
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <BlurText label={t.plan.longKeep} value={data.keep} rows={2} onSave={(keep) => save({ keep })} />
        <BlurText label={t.plan.longChangeOne} value={data.change} rows={2} onSave={(change) => save({ change })} />
        <BlurText label={t.plan.longAddPostpone} value={data.addPostpone} rows={2} onSave={(addPostpone) => save({ addPostpone })} />
        <BlurText label={t.plan.longNextBudget} value={data.nextBudget} rows={2} onSave={(nextBudget) => save({ nextBudget })} />
        <BlurText label={t.plan.longNextTargets} value={data.nextTargets} rows={2} onSave={(nextTargets) => save({ nextTargets })} />
        <BlurText label={t.plan.longGantt} value={data.ganttChanges} rows={2} onSave={(ganttChanges) => save({ ganttChanges })} />
        <BlurText label={t.plan.longUnknowns} value={data.unknowns} rows={2} onSave={(unknowns) => save({ unknowns })} />
        <BlurText label={t.plan.longFirstWeek} value={data.firstWeek} rows={2} onSave={(firstWeek) => save({ firstWeek })} />
      </div>
    </div>
  );
}

const blankExperiment = (): ExperimentInput => ({
  goalId: null,
  observation: "",
  hypothesis: "",
  change: "",
  evidence: "",
  reviewDateKey: null,
  keepIf: "",
  otherwise: "",
  status: "RUNNING",
  outcome: "",
});

const EXP_COLOR: Record<string, string> = {
  RUNNING: "#f2552c",
  KEPT: "#1f9d6b",
  ADJUSTED: "#d39200",
  REVERTED: "#64748b",
};

function Experiments({ active, hexes, todayKey, rec, setRec, onError }: RecProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ExperimentInput | null>(null);

  const put = (x: ExperimentView) =>
    setRec(
      (r) =>
        r && {
          ...r,
          experiments: r.experiments.map((y) => (y.id === x.id ? x : y)),
        },
    );

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const res = okOr(await createExperimentAction(draft), onError);
    if (!res) return;
    setRec((r) => r && { ...r, experiments: [res.experiment, ...r.experiments] });
    setDraft(null);
  }

  return (
    <Card
      title={t.plan.experimentsHeading}
      intro={t.plan.experimentsIntro}
      action={
        !draft && (
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...blankExperiment(),
                reviewDateKey: shiftDateKey(todayKey, 14),
              })
            }
            className={PILL}
          >
            + {t.plan.addExperiment}
          </button>
        )
      }
    >
      {draft && (
        <form onSubmit={create} className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["observation", "hypothesis", "change", "evidence", "keepIf", "otherwise"] as const).map((f) => (
              <label key={f} className="flex flex-col gap-0.5">
                <span className={LABEL}>{f === "change" ? t.plan.expChange : f === "hypothesis" ? t.plan.hypothesis : t.plan[f]}</span>
                <textarea
                  value={draft[f]}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  rows={2}
                  className={`${INPUT} text-[12px]`}
                  required={f === "change"}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GoalSelect goals={active} value={draft.goalId} onChange={(goalId) => setDraft({ ...draft, goalId })} />
            <span className={LABEL}>{t.plan.reviewDate}</span>
            <DateInput value={draft.reviewDateKey} onChange={(reviewDateKey) => setDraft({ ...draft, reviewDateKey })} />
            <button type="submit" disabled={!draft.change.trim()} className={`${PRIMARY} ml-auto`}>
              {t.plan.addExperiment}
            </button>
            <button type="button" onClick={() => setDraft(null)} className={PILL}>
              {t.plan.cancel}
            </button>
          </div>
        </form>
      )}
      <ul className="flex flex-col gap-2">
        {rec.experiments.map((x) => (
          <ExperimentRow
            key={x.id}
            x={x}
            goals={active}
            hex={x.goalId ? (hexes.get(x.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX}
            due={x.status === "RUNNING" && !!x.reviewDateKey && x.reviewDateKey <= todayKey}
            onSaved={put}
            onDelete={() => {
              setRec(
                (r) =>
                  r && {
                    ...r,
                    experiments: r.experiments.filter((y) => y.id !== x.id),
                  },
              );
              void deleteExperimentAction(x.id);
            }}
            onError={onError}
          />
        ))}
      </ul>
    </Card>
  );
}

function ExperimentRow({
  x,
  goals,
  hex,
  due,
  onSaved,
  onDelete,
  onError,
}: {
  x: ExperimentView;
  goals: TabProps["active"];
  hex: string;
  due: boolean;
  onSaved: (x: ExperimentView) => void;
  onDelete: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const day = useDay();
  async function save(p: Partial<ExperimentInput>) {
    const res = await updateExperimentAction(x.id, { ...x, ...p });
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    onSaved(res.experiment);
  }
  const goal = goals.find((g) => g.id === x.goalId);
  const sHex = EXP_COLOR[x.status];
  return (
    <li className={`rounded-lg border p-2.5 ${due ? "border-accent" : "border-line"}`}>
      <details open={x.status === "RUNNING"}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold" style={{ background: tint(sHex, 0.15), color: sHex }}>
            {t.plan.expStatus[x.status]}
          </span>
          {goal && <GoalChip goal={goal} hex={hex} />}
          <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">{x.change}</span>
          {x.reviewDateKey && (
            <span className={`font-mono text-[10px] ${due ? "font-semibold text-accent" : "text-ink-faint"}`}>{day.short(x.reviewDateKey)}</span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {/* the chain, observation → change → evidence, read left to right */}
          <div className="grid gap-2 sm:grid-cols-3">
            <BlurText label={t.plan.observation} value={x.observation} rows={2} onSave={(observation) => save({ observation })} />
            <BlurText label={t.plan.hypothesis} value={x.hypothesis} rows={2} onSave={(hypothesis) => save({ hypothesis })} />
            <BlurText label={t.plan.expChange} value={x.change} rows={2} onSave={(change) => (change.trim() ? save({ change }) : undefined)} />
            <BlurText label={t.plan.evidence} value={x.evidence} rows={2} onSave={(evidence) => save({ evidence })} />
            <BlurText label={t.plan.keepIf} value={x.keepIf} rows={2} onSave={(keepIf) => save({ keepIf })} />
            <BlurText label={t.plan.otherwise} value={x.otherwise} rows={2} onSave={(otherwise) => save({ otherwise })} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {EXPERIMENT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void save({ status: s }).catch(() => {})}
                className="rounded-full border px-2.5 py-0.5 font-mono text-[10px]"
                style={
                  x.status === s
                    ? {
                        borderColor: EXP_COLOR[s],
                        background: EXP_COLOR[s],
                        color: "#fff",
                      }
                    : {
                        borderColor: tint(EXP_COLOR[s], 0.6),
                        color: EXP_COLOR[s],
                      }
                }
              >
                {t.plan.expStatus[s]}
              </button>
            ))}
            <DateInput
              value={x.reviewDateKey}
              onChange={(reviewDateKey) => void save({ reviewDateKey }).catch(() => {})}
              label={t.plan.reviewDate}
              className="ml-auto"
            />
            <button type="button" onClick={onDelete} aria-label={t.plan.remove} className="font-mono text-[11px] text-ink-faint hover:text-accent">
              ×
            </button>
          </div>
          <BlurText label={t.plan.outcome} value={x.outcome} rows={2} onSave={(outcome) => save({ outcome })} />
        </div>
      </details>
    </li>
  );
}
