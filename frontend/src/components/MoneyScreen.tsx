"use client";

import { useEffect, useState } from "react";
import { getMonthlyTotalsAction, getMoneyDayAction, type MoneyDayView } from "@/app/money/actions";
import { CsvImportPanel } from "@/components/CsvImportPanel";
import { MoneyPlanPanel } from "@/components/MoneyPlanPanel";
import { ExpenseQuickEntry } from "@/components/ExpenseQuickEntry";
import { LoadingBlock } from "@/components/LoadingSpinner";
import type { MonthTotal } from "@/lib/expenses";
import { todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 家計: today's entry, the month's plan (which is also where the month is
 * read against its budget, category by category), the year's trend, and
 * the statement import.
 *
 * There used to be a separate 今月のカテゴリ別 section here with its own
 * budget per category. It predated the plan, and once the plan existed the
 * same categories had two budgets in two places that nothing kept in step.
 * The plan's list is the one that stays.
 */
export function MoneyScreen() {
  const { t } = useI18n();
  const todayKey = todayKeyValue();
  const [view, setView] = useState<MoneyDayView | null>(null);
  const [trend, setTrend] = useState<MonthTotal[]>([]);
  const [planVersion, setPlanVersion] = useState(0);

  useEffect(() => {
    getMoneyDayAction(todayKey).then(setView);
    getMonthlyTotalsAction(todayKey).then(setTrend);
  }, [todayKey]);

  // An import moves everything on this screen at once — the month's
  // total, what each category of the plan has used, and the twelve-month
  // line — so all of it is re-read together.
  function reload() {
    getMoneyDayAction(todayKey).then(setView);
    getMonthlyTotalsAction(todayKey).then(setTrend);
    setPlanVersion((v) => v + 1);
  }

  if (!view) return <LoadingBlock label={t.common.loading} />;

  const { month } = view;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t.money.heading}</h1>
        <span className="font-mono text-xs text-ink-soft">{t.money.monthProgress(month.dayOfMonth, month.daysInMonth)}</span>
        <span className="ml-auto text-lg font-extrabold text-ink">¥{month.totalYen.toLocaleString()}</span>
      </div>

      <ExpenseQuickEntry dateKey={todayKey} />

      <MoneyPlanPanel todayKey={todayKey} version={planVersion} />

      <MonthlyTrend months={trend} heading={t.money.trendHeading} note={t.money.trendNote} />

      <CsvImportPanel categories={view.categories} onImported={reload} />
    </div>
  );
}

/**
 * Twelve months of totals as bars.
 *
 * Scaled to the largest month rather than to a fixed ceiling: the point
 * is the shape of the year — which months run hot — and a fixed axis
 * would flatten that for anyone whose spending is steady.
 *
 * A month's amount shows on hover with a mouse, and on tap otherwise:
 * showing all twelve at once would overlap on a phone, and on touch there
 * is no hover to reveal them.
 */
function MonthlyTrend({ months, heading, note }: { months: MonthTotal[]; heading: string; note: string }) {
  const peak = Math.max(1, ...months.map((m) => m.totalYen));
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{heading}</p>
      <div className="flex h-28 items-end gap-1.5">
        {months.map((m) => (
          <button
            key={m.month}
            type="button"
            onClick={() => setPicked((current) => (current === m.month ? null : m.month))}
            aria-label={`${m.month} ¥${m.totalYen.toLocaleString()}`}
            aria-pressed={picked === m.month}
            className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span
              className={`font-mono text-[8.5px] whitespace-nowrap text-ink-faint transition-opacity group-hover:opacity-100 ${
                picked === m.month ? "opacity-100" : "opacity-0"
              }`}
            >
              ¥{m.totalYen.toLocaleString()}
            </span>
            <div className="flex w-full flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t bg-[var(--color-meal)]"
                style={{ height: `${(m.totalYen / peak) * 100}%` }}
                title={`${m.month} ¥${m.totalYen.toLocaleString()}`}
              />
            </div>
            <span className={`font-mono text-[8.5px] ${picked === m.month ? "text-accent" : "text-ink-faint"}`}>{m.month.slice(5)}</span>
          </button>
        ))}
      </div>
      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{note}</p>
    </section>
  );
}
