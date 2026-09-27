"use client";

import { useEffect, useState } from "react";
import { getDayScheduleAction, type DayScheduleView } from "@/app/calendar/actions";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";

/** Hours are drawn at a fixed scale rather than stretched to fill: an hour
 * has to be the same height on a day with two events and a day with ten,
 * or the timeline stops being readable at a glance. */
const HOUR_PX = 44;
const DEFAULT_FROM = 8;
const DEFAULT_TO = 21;

function hourOf(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/**
 * The day's schedule at the top of the calendar: Google Calendar events on
 * an hour axis, and beside them the tasks still open in that day's project
 * task notes.
 *
 * The two halves come from different places on purpose. Events are the
 * owner's calendar, which lives in Google and is only mirrored here; tasks
 * are lines of Bullet Journal text in the notes below, read out rather than
 * stored twice (see src/lib/bulletJournal.ts). Nothing is copied between
 * them — this is one view over both, so neither can drift from its source.
 *
 * A calendar that isn't linked, or has stopped authorizing, is a state
 * this renders rather than an error it throws: the task side still works,
 * and the calendar side says exactly what to do about it.
 */
export function DayScheduleTimeline({ dateKey, timeZone }: { dateKey: string; timeZone: string }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<DayScheduleView | null>(null);

  // No reset before the fetch: the caller remounts this per day
  // (key={dateKey}), so a new day already starts from a null view.
  useEffect(() => {
    let cancelled = false;
    getDayScheduleAction(dateKey).then((v) => {
      if (!cancelled) setView(v);
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  if (!view) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-line bg-surface">
        <Spinner size="sm" />
      </div>
    );
  }

  const events = view.calendar === "linked" ? view.events : [];
  const timed = events.filter((e) => !e.allDay && e.start);
  const allDay = events.filter((e) => e.allDay);

  // The axis covers the working day, widened to whatever the day actually
  // holds — meals included, since breakfast is usually before the events.
  const starts = [...timed.map((e) => hourOf(e.start as Date, timeZone)), ...view.meals.map((m) => hourOf(new Date(m.start), timeZone))];
  const ends = [...timed.map((e) => hourOf((e.end ?? e.start) as Date, timeZone)), ...view.meals.map((m) => hourOf(new Date(m.end), timeZone))];
  const from = Math.floor(Math.min(DEFAULT_FROM, ...starts));
  const to = Math.ceil(Math.max(DEFAULT_TO, ...ends));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const timeLabel = (d: Date) =>
    new Intl.DateTimeFormat(localeTag(locale), { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">{"//"}</span>
        <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          {t.daySchedule.heading}
        </span>
        {view.calendar === "linked" && (
          <span className="font-mono text-[9.5px] text-ink-faint">{t.daySchedule.eventCount(events.length)}</span>
        )}
      </div>

      {view.nutrition && <NutritionSummary nutrition={view.nutrition} />}

      <div className="flex gap-4 rounded-xl border border-line bg-surface p-4">
        {/* 予定 — hour axis */}
        <div className="min-w-0 flex-1">
          {view.calendar !== "linked" ? (
            <CalendarNotice state={view.calendar} />
          ) : (
            <>
              {allDay.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {allDay.map((e) => (
                    <span key={e.id} className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[10px] text-accent">
                      {t.daySchedule.allDay} {e.title}
                    </span>
                  ))}
                </div>
              )}
              <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, i) => (
                  <div key={h} className="absolute right-0 left-0 flex items-start gap-2" style={{ top: i * HOUR_PX }}>
                    <span className="w-9 shrink-0 pt-[1px] text-right font-mono text-[9.5px] text-ink-faint">
                      {String(h).padStart(2, "0")}
                    </span>
                    <span className="mt-[7px] h-px flex-1 bg-line" />
                  </div>
                ))}
                {timed.map((e) => {
                  const s = e.start as Date;
                  const en = (e.end ?? e.start) as Date;
                  const top = (hourOf(s, timeZone) - from) * HOUR_PX;
                  const height = Math.max(22, (hourOf(en, timeZone) - hourOf(s, timeZone)) * HOUR_PX - 2);
                  return (
                    <a
                      key={e.id}
                      href={e.htmlLink ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute left-12 w-[48%] overflow-hidden rounded-md border-l-2 border-accent bg-accent-soft px-2 py-1 transition-colors hover:bg-accent/15"
                      style={{ top, height }}
                    >
                      <p className="truncate text-[11.5px] font-semibold text-ink">{e.title}</p>
                      <p className="truncate font-mono text-[9.5px] text-ink-soft">
                        {timeLabel(s)}–{timeLabel(en)}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                    </a>
                  );
                })}
                {view.meals.map((m) => {
                  const start = new Date(m.start);
                  const end = new Date(m.end);
                  const top = (hourOf(start, timeZone) - from) * HOUR_PX;
                  const height = Math.max(20, (hourOf(end, timeZone) - hourOf(start, timeZone)) * HOUR_PX - 2);
                  return (
                    <div
                      key={m.id}
                      title={m.recipe}
                      className="absolute right-0 w-[46%] overflow-hidden rounded-md border-l-2 border-[var(--color-meal)] bg-[var(--color-meal-soft)] px-2 py-1"
                      style={{ top, height }}
                    >
                      <p className="truncate text-[11px] font-semibold text-ink">{m.title}</p>
                      <p className="truncate font-mono text-[9px] text-ink-soft">
                        {m.kcal} kcal · {timeLabel(start)}
                      </p>
                    </div>
                  );
                })}
                {timed.length === 0 && view.meals.length === 0 && (
                  <p className="absolute top-2 left-12 font-mono text-[10px] text-ink-faint">{t.daySchedule.noEvents}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* 食事とタスク */}
        <div className="flex w-[300px] shrink-0 flex-col gap-4 border-l border-line pl-4">
          {view.meals.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.daySchedule.mealsHeading}</p>
              <ul className="flex flex-col gap-1.5">
                {view.meals.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2">
                    <span className="font-mono text-[9px] text-[var(--color-meal)]">{t.daySchedule.slot[m.slot]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[11.5px] text-ink">{m.title}</span>
                      <span className="ml-1.5 font-mono text-[9px] text-ink-faint">
                        {m.kcal} kcal · {t.daySchedule.prep(m.prepMinutes)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
          <p className="mb-2 font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
            {t.daySchedule.openTasks(view.tasks.length)}
          </p>
          {view.tasks.length === 0 ? (
            <p className="font-mono text-[10px] text-ink-faint">{t.daySchedule.noTasks}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {view.tasks.map((task, i) => (
                <li key={`${task.projectId}-${i}`} className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-accent">{task.priority ? "*-" : "-"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[11.5px] text-ink">{task.text}</span>
                    <span className="ml-1.5 font-mono text-[9px] text-ink-faint">{task.projectName}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
            <p className="mt-3 font-mono text-[9px] leading-relaxed text-ink-faint">{t.daySchedule.tasksSource}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Today against its brief: what the body spent, what the plan provides,
 * and whether the nutrients that are easy to miss actually land. Shown as
 * planned-vs-target rather than a single "calories left" number, because a
 * day can hit its calories and still be short on protein or fibre — which
 * is the whole reason the planner works in nutrients. */
function NutritionSummary({ nutrition: n }: { nutrition: NonNullable<DayScheduleView["nutrition"]> }) {
  const { t } = useI18n();
  const burn = n.activeEnergyKcal;
  const short = (planned: number, target: number) => planned < target * 0.9;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
      <Stat label={t.daySchedule.statTarget} value={`${n.targetKcal} kcal`} />
      <Stat
        label={t.daySchedule.statPlanned}
        value={`${Math.round(n.plannedKcal)} kcal`}
        tone={n.plannedKcal === 0 ? "faint" : Math.abs(n.plannedKcal - n.targetKcal) > 150 ? "warn" : "ok"}
      />
      <Stat
        label={t.health.protein}
        value={`${Math.round(n.plannedProteinG)} / ${n.targetProteinG} g`}
        tone={n.plannedKcal === 0 ? "faint" : short(n.plannedProteinG, n.targetProteinG) ? "warn" : "ok"}
      />
      <Stat
        label={t.health.fiber}
        value={`${Math.round(n.plannedFiberG)} / ${n.targetFiberG} g`}
        tone={n.plannedKcal === 0 ? "faint" : short(n.plannedFiberG, n.targetFiberG) ? "warn" : "ok"}
      />
      <Stat
        label={t.health.salt}
        value={`${n.plannedSaltG.toFixed(1)} / ${n.saltMaxG} g`}
        tone={n.plannedKcal === 0 ? "faint" : n.plannedSaltG > n.saltMaxG ? "warn" : "ok"}
      />
      {burn !== null && <Stat label={t.daySchedule.statBurn} value={`${Math.round(burn)} kcal`} />}
      {n.weightKg !== null && <Stat label={t.daySchedule.statWeight} value={`${n.weightKg} kg`} />}
    </div>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "ok" | "warn" | "faint" }) {
  const color = tone === "warn" ? "text-accent" : tone === "faint" ? "text-ink-faint" : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className={`text-[13px] font-bold ${color}`}>{value}</span>
    </div>
  );
}

function CalendarNotice({ state }: { state: "not_linked" | "reauth_required" | "error" }) {
  const { t } = useI18n();
  const body =
    state === "not_linked" ? t.daySchedule.notLinked : state === "reauth_required" ? t.daySchedule.reauthRequired : t.daySchedule.apiError;
  return (
    <div className="flex h-full min-h-[96px] flex-col items-start justify-center gap-2.5">
      <p className="text-[11.5px] text-ink-soft">{body}</p>
      {state !== "error" && (
        <a
          href="/api/google-calendar/connect"
          className="btn-sheen rounded-full bg-accent px-3.5 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent"
        >
          {state === "not_linked" ? t.daySchedule.connect : t.daySchedule.reconnect}
        </a>
      )}
    </div>
  );
}
