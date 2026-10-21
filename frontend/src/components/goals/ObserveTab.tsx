"use client";

import { useEffect, useState } from "react";
import { observeAction } from "@/app/goals/planActions";
import type { Alert, Observation, WeekMetric } from "@/lib/goalPlan";
import { SHORT_RATE } from "@/lib/goalMetrics";
import { Spinner } from "@/components/LoadingSpinner";
import { Card, DELIVERABLE_STATUSES, NO_GOAL_HEX, STATUS_COLOR, round1, useDay, type TabProps } from "@/components/goals/ui";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 観測 — what the records say, read the way the plan defines it: the
 * realised share of planned time per area (recorded weeks only, 80% marked),
 * the hours by week, where every deliverable stands, and the plan's rules
 * turned into things to look at now. Nothing here is a judgement: it's
 * the timetable being checked.
 */
export function ObserveTab({ ov, todayKey, active, hexes, generation }: TabProps) {
  const { t } = useI18n();
  const [obs, setObs] = useState<Observation | null>(null);

  useEffect(() => {
    let live = true;
    void observeAction(todayKey).then((o) => live && setObs(o));
    return () => {
      live = false;
    };
  }, [todayKey, generation]);

  if (!obs) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.plan.observeIntro}</p>
      <AlertsCard obs={obs} goals={ov.goals} hexes={hexes} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <RateCard weeks={obs.weeks} goals={active} hexes={hexes} />
        <HoursCard weeks={obs.weeks} goals={active} hexes={hexes} />
      </div>
      <BoardCard obs={obs} goals={ov.goals} hexes={hexes} />
    </div>
  );
}

const ALERT_ICON: Record<Alert["kind"], string> = {
  short: "◐",
  stalled: "⏸",
  waitingOverdue: "⌛",
  checkOverdue: "?",
  missingLogs: "○",
  reviewDue: "↻",
  deadlineSoon: "◆",
  experimentDue: "⚗",
  stepSoon: "◇",
  stepOverdue: "!",
};

function AlertsCard({ obs, goals, hexes }: { obs: Observation; goals: TabProps["ov"]["goals"]; hexes: Map<string, string> }) {
  const { t } = useI18n();
  const day = useDay();
  const title = (id: string | null) => goals.find((g) => g.id === id)?.title ?? t.plan.noGoal;

  const text = (a: Alert): string => {
    switch (a.kind) {
      case "short":
        return t.plan.alert.short(title(a.goalId), a.rates.map((r) => `${Math.round(r * 100)}%`).join(" → "));
      case "stalled":
        return t.plan.alert.stalled(a.title, a.days);
      case "waitingOverdue":
        return t.plan.alert.waitingOverdue(a.title, day.short(a.checkDateKey));
      case "checkOverdue":
        return t.plan.alert.checkOverdue(a.title, day.short(a.dueDateKey));
      case "missingLogs":
        return t.plan.alert.missingLogs(a.dateKeys.map(day.withWeekday).join("、"));
      case "reviewDue":
        return t.plan.alert.reviewDue(a.title, day.withWeekday(a.dateKey));
      case "deadlineSoon":
        return t.plan.alert.deadlineSoon(a.title, day.withWeekday(a.dateKey));
      case "experimentDue":
        return t.plan.alert.experimentDue(a.title, day.short(a.dateKey));
      case "stepSoon":
        return t.plan.alert.stepSoon(t.plan.stepKind[a.stepKind] ?? a.stepKind, a.title, a.itemTitle, day.withWeekday(a.dateKey));
      case "stepOverdue":
        return t.plan.alert.stepOverdue(a.title, a.itemTitle, day.short(a.dateKey), a.backupDateKey ? day.short(a.backupDateKey) : null);
    }
  };
  const hexOf = (a: Alert) =>
    a.kind === "short" ? (hexes.get(a.goalId) ?? NO_GOAL_HEX) : (a.kind === "stalled" || a.kind === "waitingOverdue") && a.goalId ? (hexes.get(a.goalId) ?? NO_GOAL_HEX) : "#f2552c";

  return (
    <Card title={t.plan.alertsHeading}>
      {obs.alerts.length === 0 ? (
        <p className="text-[12px] text-ink-faint">{t.plan.alertsNone}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {obs.alerts.map((a, i) => {
            const hex = hexOf(a);
            return (
              <li key={i} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2" style={{ background: tint(hex, 0.08) }}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] text-white" style={{ background: hex }}>
                  {ALERT_ICON[a.kind]}
                </span>
                <span className="text-[12px] leading-relaxed text-ink">{text(a)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const CAP = 1.5;

/** Per area, eight weeks of realised share, as small columns against the 80% line. */
function RateCard({ weeks, goals, hexes }: { weeks: WeekMetric[]; goals: TabProps["active"]; hexes: Map<string, string> }) {
  const { t } = useI18n();
  const day = useDay();
  const H = 44;
  return (
    <Card title={t.plan.rateHeading} intro={t.plan.rateIntro}>
      <div className="flex flex-col gap-3">
        {goals
          .filter((g) => g.weeklyHours > 0)
          .map((g) => {
            const hex = hexes.get(g.id) ?? NO_GOAL_HEX;
            return (
              <div key={g.id} className="grid grid-cols-[minmax(0,7rem)_1fr] items-end gap-3">
                <span className="truncate pb-1 font-mono text-[10.5px] text-ink-soft">{g.title}</span>
                <div className="relative grid grid-cols-8 items-end gap-1" style={{ height: H }}>
                  <div className="absolute inset-x-0 border-t border-dashed border-ink-faint" style={{ bottom: (SHORT_RATE / CAP) * H }} aria-hidden="true" />
                  {weeks.map((w) => {
                    const row = w.goals.find((x) => x.goalId === g.id);
                    const rate = row?.rate ?? null;
                    const label = `${day.short(w.weekStartDateKey)}〜 ${row ? `${round1(row.actual)}/${row.planned}h` : ""} ${rate !== null ? `${Math.round(rate * 100)}%` : w.recorded ? "" : t.plan.notRecorded}`;
                    if (rate === null) return <div key={w.weekStartDateKey} title={label} className="h-1 rounded-sm border border-dashed border-line-strong" />;
                    return (
                      <div
                        key={w.weekStartDateKey}
                        title={label}
                        className="rounded-t-sm"
                        style={{
                          height: Math.max(2, (Math.min(rate, CAP) / CAP) * H),
                          background: w.special ? `repeating-linear-gradient(135deg, ${tint(hex, 0.5)} 0 3px, transparent 3px 6px)` : rate < SHORT_RATE ? tint(hex, 0.45) : hex,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3">
          <span />
          <div className="grid grid-cols-8 gap-1">
            {weeks.map((w) => (
              <span key={w.weekStartDateKey} className="text-center font-mono text-[8.5px] text-ink-faint">
                {day.short(w.weekStartDateKey)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Hours by week, stacked by area, with the planned total as a tick. */
function HoursCard({ weeks, goals, hexes }: { weeks: WeekMetric[]; goals: TabProps["active"]; hexes: Map<string, string> }) {
  const { t } = useI18n();
  const day = useDay();
  const H = 120;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.totalActual, w.totalPlanned)));
  return (
    <Card title={t.plan.weeksHeading}>
      <div className="grid grid-cols-8 items-end gap-1.5" style={{ height: H + 16 }}>
        {weeks.map((w) => (
          <div key={w.weekStartDateKey} className="relative flex h-full flex-col justify-end" title={`${day.short(w.weekStartDateKey)}〜 ${w.totalActual}/${w.totalPlanned}h · ${w.recordedDays}/7`}>
            <span className="mb-0.5 text-center font-mono text-[8.5px] text-ink-soft">{w.totalActual > 0 ? round1(w.totalActual) : ""}</span>
            <div className={`flex flex-col-reverse overflow-hidden rounded-t-sm ${w.recorded ? "" : "opacity-50"}`} style={{ height: (w.totalActual / max) * H }}>
              {goals.map((g) => {
                const a = w.goals.find((x) => x.goalId === g.id)?.actual ?? 0;
                return a > 0 ? <div key={g.id} style={{ height: `${(a / Math.max(w.totalActual, 0.01)) * 100}%`, background: hexes.get(g.id) ?? NO_GOAL_HEX }} /> : null;
              })}
            </div>
            {w.totalPlanned > 0 && <div className="absolute -inset-x-0.5 border-t border-dashed border-ink-soft" style={{ bottom: (w.totalPlanned / max) * H }} aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {weeks.map((w) => (
          <span key={w.weekStartDateKey} className="text-center font-mono text-[8.5px] text-ink-faint">
            {day.short(w.weekStartDateKey)}
            {w.special && <span className="block text-accent">{t.plan.specialWeek.slice(0, 3)}</span>}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** Every deliverable in play, by state — the plan's seven statuses as columns. */
function BoardCard({ obs, goals, hexes }: { obs: Observation; goals: TabProps["ov"]["goals"]; hexes: Map<string, string> }) {
  const { t } = useI18n();
  const day = useDay();
  if (obs.deliverables.length === 0) {
    return (
      <Card title={t.plan.boardHeading}>
        <p className="text-[12px] text-ink-faint">{t.plan.boardEmpty}</p>
      </Card>
    );
  }
  return (
    <Card title={t.plan.boardHeading}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[840px] grid-cols-7 gap-2">
          {DELIVERABLE_STATUSES.map((s) => {
            const items = obs.deliverables.filter((d) => d.status === s);
            const hex = STATUS_COLOR[s];
            return (
              <div key={s} className="flex flex-col gap-1.5 rounded-lg p-1.5" style={{ background: tint(hex, 0.06) }}>
                <p className="flex items-center gap-1 px-0.5 font-mono text-[9.5px] font-semibold" style={{ color: hex }}>
                  {t.plan.status[s]}
                  <span className="ml-auto text-ink-faint">{items.length}</span>
                </p>
                {items.map((d) => {
                  const goal = goals.find((g) => g.id === d.goalId);
                  return (
                    <div key={d.id} className="rounded-md border-l-[3px] bg-surface px-1.5 py-1 shadow-sm" style={{ borderColor: d.goalId ? (hexes.get(d.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX }}>
                      <p className="text-[11px] leading-snug font-semibold text-ink">{d.title}</p>
                      <p className="truncate font-mono text-[8.5px] text-ink-faint">
                        {goal?.title ?? ""} · {day.short(d.weekStartDateKey)}〜{d.checkDateKey && ` · ${day.short(d.checkDateKey)}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
