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

  // The axis covers the working day, widened to whatever the day actually holds.
  const starts = timed.map((e) => hourOf(e.start as Date, timeZone));
  const ends = timed.map((e) => hourOf((e.end ?? e.start) as Date, timeZone));
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
                      className="absolute right-0 left-12 overflow-hidden rounded-md border-l-2 border-accent bg-accent-soft px-2 py-1 transition-colors hover:bg-accent/15"
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
                {timed.length === 0 && (
                  <p className="absolute top-2 left-12 font-mono text-[10px] text-ink-faint">{t.daySchedule.noEvents}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* タスク — read out of the day's notes */}
        <div className="w-[300px] shrink-0 border-l border-line pl-4">
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
    </section>
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
