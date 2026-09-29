"use client";

import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { ProjectTimelineMark } from "@/lib/projectTaskNotes";

function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(-2));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ④横向きタイムライン — one horizontal line per active project, scoped to a
 * single calendar month: the track spans day 1 through the month's last
 * day, and the accent segment marks the days the project was actually
 * active (it only ever freezes at a project's explicit close, never a goal
 * deadline — see ProjectCloseButton).
 *
 * Selection here is per-DAY, not per-project: tapping anywhere in a day's
 * column — across every project row at once, whether or not that project
 * has a bar/mark there — opens that day's task notes for every active
 * project (the same fully-expanded view as ③今日の表示, just for the tapped
 * date). A day-number axis runs along the top so it's possible to tell
 * which day a bar/mark actually corresponds to. */
export function CalendarTimelineView({
  marks,
  year,
  month,
  todayKey,
  onSelectDay,
}: {
  marks: ProjectTimelineMark[];
  /** The month this timeline is scoped to (1-indexed). */
  year: number;
  month: number;
  todayKey: string;
  onSelectDay: (dateKey: string) => void;
}) {
  const { t } = useI18n();

  if (marks.length === 0) {
    return <p className="py-16 text-center text-sm text-ink-soft">{t.calendar.timelineNoNotes}</p>;
  }

  const totalDays = daysInMonth(year, month);
  const monthPrefix = `${year}-${pad(month)}`;
  const isCurrentMonth = todayKey.slice(0, 7) === monthPrefix;
  const todayDay = isCurrentMonth ? dayOfMonth(todayKey) : null;

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);
  // Labeling every day would be unreadable — always label day 1, the last
  // day, and today (if visible), plus every 5th day in between.
  const labeledDays = new Set<number>([1, totalDays, ...(todayDay ? [todayDay] : [])]);
  for (let d = 5; d < totalDays; d += 5) labeledDays.add(d);

  function leftPct(day: number) {
    return ((day - 1) / totalDays) * 100;
  }
  const colWidthPct = (1 / totalDays) * 100;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
        <span className="text-accent">{"//"}</span> {t.calendar.timelineHeading}
      </h2>

      {/* Day-number axis, aligned to the same day-columns as the bars below. */}
      <div className="relative h-4 w-full">
        {days
          .filter((d) => labeledDays.has(d))
          .map((d) => (
            <span
              key={d}
              style={{ left: `${leftPct(d) + colWidthPct / 2}%` }}
              className={`absolute -translate-x-1/2 font-mono text-[9px] ${
                d === todayDay ? "font-bold text-accent" : "text-ink-faint"
              }`}
            >
              {d}
            </span>
          ))}
      </div>

      <div className="relative flex flex-col gap-5">
        {/* Full-height per-day click targets spanning every project row at once. */}
        <div className="absolute inset-0 z-10 flex">
          {days.map((d) => {
            const dateKey = `${monthPrefix}-${pad(d)}`;
            return (
              <button
                key={d}
                onClick={() => onSelectDay(dateKey)}
                title={t.calendar.timelineOpenDay(dateKey)}
                className="h-full flex-1 transition-colors hover:bg-accent/10"
              />
            );
          })}
        </div>

        {marks.map((mark) => {
          // Null in a month that hasn't happened yet — the track and its
          // note marks still render, so a future month can be read and
          // written into; only the "was running" bar is absent.
          const span =
            mark.rangeStart && mark.rangeEnd
              ? {
                  left: leftPct(dayOfMonth(mark.rangeStart)),
                  width: ((dayOfMonth(mark.rangeEnd) - dayOfMonth(mark.rangeStart) + 1) / totalDays) * 100,
                }
              : null;
          return (
            <div key={mark.projectId} className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] text-ink-soft">{mark.projectName}</span>
              <div className="relative h-6 w-full rounded-full bg-surface-alt">
                {span && (
                  <div
                    className="absolute inset-y-0 rounded-full bg-accent/25"
                    style={{ left: `${span.left}%`, width: `${span.width}%` }}
                  />
                )}
                {mark.noteDates.map((dateKey) => (
                  <div
                    key={dateKey}
                    style={{ left: `${leftPct(dayOfMonth(dateKey)) + colWidthPct / 2}%` }}
                    className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                  />
                ))}
                {todayDay !== null && (
                  <div
                    style={{ left: `${leftPct(todayDay) + colWidthPct / 2}%` }}
                    className="pointer-events-none absolute top-[-4px] bottom-[-4px] w-px -translate-x-1/2 bg-ink-soft"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
