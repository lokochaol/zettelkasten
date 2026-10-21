/**
 * Observation — what the records say, computed the way the plan defines it
 * (目標ロードマップ §7, §10). Pure: the server gathers the rows, this turns
 * them into the numbers and the alerts, and tests can feed it directly.
 *
 * The definitions it holds to:
 *   - 実績時間 is what the daily logs say; a day with no log is 未記録,
 *     never 0 hours.
 *   - 投入の実現率 = actual ÷ planned, per goal, only for weeks whose records
 *     are complete enough to read and only where the plan gave it time. It
 *     checks the timetable, not the person.
 *   - Special weeks (schooling, trips, illness) are shown but not compared.
 */

import { shiftDateKey } from "@/lib/dateKey";

/** A week counts as recorded once this many of its days have a log. */
export const RECORDED_DAYS = 4;
/** Below this share of the planned time, a goal's week is "short". */
export const SHORT_RATE = 0.8;
/** A deliverable that hasn't changed state for this long is stalled. */
export const STALL_DAYS = 14;

export interface MetricGoal {
  id: string;
  weeklyHours: number;
}

export interface MetricLog {
  dateKey: string;
  special: boolean;
  hours: Record<string, number>;
}

export interface MetricDeliverable {
  id: string;
  goalId: string | null;
  title: string;
  status: string;
  checkDateKey: string | null;
  /** YYYY-MM-DD of the last status change. */
  statusChangedOn: string;
}

export interface MetricDated {
  id: string;
  title: string;
  dateKey: string | null;
  done: boolean;
  kind?: string;
}

export interface WeekMetric {
  weekStartDateKey: string;
  recordedDays: number;
  /** Enough days logged to read the week. */
  recorded: boolean;
  special: boolean;
  goals: { goalId: string; planned: number; actual: number; rate: number | null }[];
  totalPlanned: number;
  totalActual: number;
}

export type Alert =
  | { kind: "short"; goalId: string; rates: number[] }
  | { kind: "stalled"; deliverableId: string; goalId: string | null; title: string; days: number }
  | { kind: "waitingOverdue"; deliverableId: string; goalId: string | null; title: string; checkDateKey: string }
  | { kind: "checkOverdue"; checkId: string; title: string; dueDateKey: string }
  | { kind: "missingLogs"; dateKeys: string[] }
  | { kind: "reviewDue"; eventId: string; title: string; dateKey: string }
  | { kind: "deadlineSoon"; eventId: string; title: string; dateKey: string }
  | { kind: "experimentDue"; experimentId: string; title: string; dateKey: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The hours a set of logs adds up to, per goal. */
export function sumHours(logs: MetricLog[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const log of logs) {
    for (const [goalId, h] of Object.entries(log.hours)) {
      if (Number.isFinite(h) && h > 0) out[goalId] = round2((out[goalId] ?? 0) + h);
    }
  }
  return out;
}

export function weekMetric(
  weekStartDateKey: string,
  goals: MetricGoal[],
  logs: MetricLog[],
  /** The review's planned hours for this week, when it set its own. */
  plannedOverride: Record<string, number> | null,
  reviewSpecial: boolean,
): WeekMetric {
  const end = shiftDateKey(weekStartDateKey, 6);
  const inWeek = logs.filter((l) => l.dateKey >= weekStartDateKey && l.dateKey <= end);
  const actual = sumHours(inWeek);
  const recordedDays = new Set(inWeek.map((l) => l.dateKey)).size;
  const recorded = recordedDays >= RECORDED_DAYS;
  const special = reviewSpecial || inWeek.some((l) => l.special);
  const rows = goals
    .map((g) => {
      const planned = plannedOverride?.[g.id] ?? g.weeklyHours;
      const a = actual[g.id] ?? 0;
      return { goalId: g.id, planned, actual: a, rate: recorded && planned > 0 ? round2(a / planned) : null };
    })
    .filter((r) => r.planned > 0 || r.actual > 0);
  return {
    weekStartDateKey,
    recordedDays,
    recorded,
    special,
    goals: rows,
    totalPlanned: round2(rows.reduce((s, r) => s + r.planned, 0)),
    totalActual: round2(rows.reduce((s, r) => s + r.actual, 0)),
  };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The plan's first decision rules, as alerts (§10.1) — each one an
 * observation with the change it suggests, never a verdict.
 */
export function alertsFor(input: {
  todayKey: string;
  /** Oldest first; the current (unfinished) week last. */
  weeks: WeekMetric[];
  currentWeekStart: string;
  logDates: string[];
  /** When recording began (the first cycle or the first log); days before it aren't missing. */
  recordsFrom: string | null;
  deliverables: MetricDeliverable[];
  checks: MetricDated[];
  events: MetricDated[];
  experiments: MetricDated[];
}): Alert[] {
  const { todayKey } = input;
  const alerts: Alert[] = [];

  // Two finished, recorded, normal weeks in a row under the line for a goal.
  const finished = input.weeks.filter((w) => w.weekStartDateKey < input.currentWeekStart && w.recorded && !w.special);
  const lastTwo = finished.slice(-2);
  if (lastTwo.length === 2) {
    const goalIds = new Set(lastTwo.flatMap((w) => w.goals.map((g) => g.goalId)));
    for (const goalId of goalIds) {
      const rates = lastTwo.map((w) => w.goals.find((g) => g.goalId === goalId)?.rate ?? null);
      if (rates.every((r): r is number => r !== null && r < SHORT_RATE)) alerts.push({ kind: "short", goalId, rates });
    }
  }

  for (const d of input.deliverables) {
    if ((d.status === "IN_PROGRESS" || d.status === "NOT_STARTED") && daysBetween(d.statusChangedOn, todayKey) >= STALL_DAYS) {
      alerts.push({ kind: "stalled", deliverableId: d.id, goalId: d.goalId, title: d.title, days: daysBetween(d.statusChangedOn, todayKey) });
    }
    if (d.status === "WAITING" && d.checkDateKey && d.checkDateKey <= todayKey) {
      alerts.push({ kind: "waitingOverdue", deliverableId: d.id, goalId: d.goalId, title: d.title, checkDateKey: d.checkDateKey });
    }
  }

  for (const c of input.checks) {
    if (!c.done && c.dateKey && c.dateKey < todayKey) alerts.push({ kind: "checkOverdue", checkId: c.id, title: c.title, dueDateKey: c.dateKey });
  }

  // Days of this week, before today, with nothing logged.
  const logged = new Set(input.logDates);
  const missing: string[] = [];
  if (input.recordsFrom) {
    for (let d = input.currentWeekStart; d < todayKey; d = shiftDateKey(d, 1)) if (d >= input.recordsFrom && !logged.has(d)) missing.push(d);
  }
  if (missing.length > 0) alerts.push({ kind: "missingLogs", dateKeys: missing });

  const soon = shiftDateKey(todayKey, 7);
  for (const e of input.events) {
    if (e.done || !e.dateKey) continue;
    if (e.kind === "REVIEW" && e.dateKey <= shiftDateKey(todayKey, 2) && daysBetween(e.dateKey, todayKey) <= 7) {
      alerts.push({ kind: "reviewDue", eventId: e.id, title: e.title, dateKey: e.dateKey });
    } else if ((e.kind === "DEADLINE" || e.kind === "APPLICATION") && e.dateKey >= todayKey && e.dateKey <= soon) {
      alerts.push({ kind: "deadlineSoon", eventId: e.id, title: e.title, dateKey: e.dateKey });
    }
  }

  for (const x of input.experiments) {
    if (!x.done && x.dateKey && x.dateKey <= todayKey) alerts.push({ kind: "experimentDue", experimentId: x.id, title: x.title, dateKey: x.dateKey });
  }
  return alerts;
}
