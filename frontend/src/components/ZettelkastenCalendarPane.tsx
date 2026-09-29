"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { CalendarTodaySection } from "@/components/CalendarTodaySection";
import { CalendarTodayView } from "@/components/CalendarTodayView";
import { CalendarTimelineView } from "@/components/CalendarTimelineView";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { listTodayProjectNotesAction, listTimelineMarksAction } from "@/app/calendar/actions";
import { formatDateKey, todayKey as todayKeyValue } from "@/lib/dateKey";
import type { TodayProjectNote, ProjectTimelineMark } from "@/lib/projectTaskNotes";

/** ①②③のツェッテルカステン本体の代わりに、ペイン部分にそのままカレンダー
 * （今日／タイムライン）を表示する — /calendar ページ自体と違い、ここでの
 * 表示切り替え・月送りはURLのクエリではなくローカル状態で行う（このペインは
 * ZettelkastenScreen上のインプレース表示なので、独立したルートではない）。 */
export function ZettelkastenCalendarPane({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<"today" | "timeline">("today");

  const todayKey = todayKeyValue();
  const todayDate = new Date(`${todayKey}T00:00:00.000Z`);
  const currentYear = todayDate.getUTCFullYear();
  const currentMonth = todayDate.getUTCMonth() + 1;

  const [viewedYear, setViewedYear] = useState(currentYear);
  const [viewedMonth, setViewedMonth] = useState(currentMonth);
  const monthKey = `${viewedYear}-${viewedMonth}`;
  const [timelineData, setTimelineData] = useState<{ key: string; marks: ProjectTimelineMark[] } | null>(null);

  // Selecting a day on ④タイムライン shows that day's notes for every active
  // project inline — the same fully-expanded view ③今日 uses, just for the
  // tapped date — rather than jumping to a specific project. `null` means
  // the timeline itself is showing.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedDayData, setSelectedDayData] = useState<{ key: string; notes: TodayProjectNote[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (view === "timeline" && timelineData?.key !== monthKey) {
      listTimelineMarksAction(viewedYear, viewedMonth, todayKey).then((result) => {
        if (!cancelled) setTimelineData({ key: monthKey, marks: result });
      });
    }
    if (selectedDay && selectedDayData?.key !== selectedDay) {
      listTodayProjectNotesAction(selectedDay).then((result) => {
        if (!cancelled) setSelectedDayData({ key: selectedDay, notes: result });
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewedYear, viewedMonth, monthKey, selectedDay]);

  function shiftMonth(delta: number) {
    const base = new Date(Date.UTC(viewedYear, viewedMonth - 1 + delta, 1));
    setViewedYear(base.getUTCFullYear());
    setViewedMonth(base.getUTCMonth() + 1);
  }

  const monthLabel = new Date(Date.UTC(viewedYear, viewedMonth - 1, 1)).toLocaleDateString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    timeZone: "UTC",
  });
  const selectedDayLabel = selectedDay ? formatDateKey(selectedDay, localeTag(locale)) : "";
  const isCurrentViewedMonth = viewedYear === currentYear && viewedMonth === currentMonth;
  const timelineLoading = view === "timeline" && timelineData?.key !== monthKey;
  const selectedDayLoading = selectedDay !== null && selectedDayData?.key !== selectedDay;

  const viewSwitch = (
    <div className="flex gap-1.5 rounded-full border border-line-strong bg-surface p-1">
      {(["today", "timeline"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`rounded-full px-3 py-1.5 font-mono text-[10.5px] transition-colors ${
            view === v ? "bg-accent text-on-accent" : "text-ink-soft hover:text-accent"
          }`}
        >
          {v === "today" ? t.calendar.viewToday : t.calendar.viewTimeline}
        </button>
      ))}
    </div>
  );

  if (selectedDay) {
    return (
      <div className="flex w-full flex-col gap-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedDay(null)}
            className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
          >
            <span className="text-accent">&lt;</span> {t.calendar.viewTimeline}
          </button>
          <h1 className="text-lg font-extrabold tracking-tight text-ink">{selectedDayLabel}</h1>
        </div>
        {selectedDayLoading ? (
          <LoadingBlock label={t.calendar.projectTaskLoading} />
        ) : (
          <CalendarTodayView
            key={selectedDay}
            dateKey={selectedDay}
            initialNotes={selectedDayData!.notes}
            onOpenProject={onOpenProject}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {view === "today" ? (
        <CalendarTodaySection onOpenProject={onOpenProject} headerRight={viewSwitch} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftMonth(-1)}
                aria-label={t.calendar.timelinePrevMonth}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-alt hover:text-accent"
              >
                ‹
              </button>
              <h1 className="text-lg font-extrabold tracking-tight text-ink">{monthLabel}</h1>
              <button
                onClick={() => shiftMonth(1)}
                aria-label={t.calendar.timelineNextMonth}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-alt hover:text-accent"
              >
                ›
              </button>
              {!isCurrentViewedMonth && (
                <button
                  onClick={() => {
                    setViewedYear(currentYear);
                    setViewedMonth(currentMonth);
                  }}
                  className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  {t.calendar.timelineThisMonth}
                </button>
              )}
            </div>
            {viewSwitch}
          </div>

          {timelineLoading ? (
            <LoadingBlock label={t.calendar.projectTaskLoading} />
          ) : (
            <CalendarTimelineView
              marks={timelineData!.marks}
              year={viewedYear}
              month={viewedMonth}
              todayKey={todayKey}
              onSelectDay={setSelectedDay}
            />
          )}
        </>
      )}
    </div>
  );
}
