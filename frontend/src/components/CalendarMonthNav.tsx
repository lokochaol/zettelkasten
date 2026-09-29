"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Prev/next month controls for /calendar's timeline view, wrapping the
 * month label passed as `children` — navigates by replacing the
 * `year`/`month` query params (keeping `view=timeline`), the same
 * URL-driven pattern CalendarViewSwitch uses for the view itself.
 *
 * Both directions are always open. "Next" used to stop at the current
 * month, on the reasoning that a project cannot have been active in a
 * month that hasn't happened — true of the bar, but not of the notes: the
 * whole use of a calendar is writing down what a day is going to be before
 * it arrives. `isCurrentMonth` instead offers a way back, which a timeline
 * you can walk arbitrarily far into needs. */
export function CalendarMonthNav({
  year,
  month,
  isCurrentMonth,
  children,
}: {
  year: number;
  month: number;
  isCurrentMonth: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();

  function shiftMonth(delta: number) {
    const base = new Date(Date.UTC(year, month - 1 + delta, 1));
    router.push(`/calendar?view=timeline&year=${base.getUTCFullYear()}&month=${base.getUTCMonth() + 1}`);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => shiftMonth(-1)}
        aria-label={t.calendar.timelinePrevMonth}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-alt hover:text-accent"
      >
        ‹
      </button>
      {children}
      <button
        onClick={() => shiftMonth(1)}
        aria-label={t.calendar.timelineNextMonth}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-alt hover:text-accent"
      >
        ›
      </button>
      {!isCurrentMonth && (
        <button
          onClick={() => router.push("/calendar?view=timeline")}
          className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
        >
          {t.calendar.timelineThisMonth}
        </button>
      )}
    </div>
  );
}
