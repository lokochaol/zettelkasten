"use client";

import { useEffect, useState, useTransition } from "react";
import { getMoneyDayAction, setCategoryBudgetAction, type MoneyDayView } from "@/app/money/actions";
import { ExpenseQuickEntry } from "@/components/ExpenseQuickEntry";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The month, by category, against what was budgeted.
 *
 * Progress is read against the calendar rather than the ceiling alone:
 * two thirds of a budget spent is fine on the 20th and a problem on the
 * 8th, and those two need different words, not the same bar.
 */
export function MoneyScreen() {
  const { t } = useI18n();
  const todayKey = todayKeyValue();
  const [view, setView] = useState<MoneyDayView | null>(null);
  const [, startSaving] = useTransition();

  useEffect(() => {
    getMoneyDayAction(todayKey).then(setView);
  }, [todayKey]);

  if (!view) return <LoadingBlock label={t.common.loading} />;

  const { month } = view;
  const monthProgress = month.dayOfMonth / month.daysInMonth;

  function saveBudget(category: string, value: string) {
    const parsed = value.trim() === "" ? null : Number(value.replace(/[,¥\s]/g, ""));
    if (parsed !== null && !Number.isFinite(parsed)) return;
    startSaving(async () => {
      const next = await setCategoryBudgetAction(category, parsed, todayKey);
      setView((prev) => (prev ? { ...prev, month: next } : prev));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t.money.heading}</h1>
        <span className="font-mono text-xs text-ink-soft">{t.money.monthProgress(month.dayOfMonth, month.daysInMonth)}</span>
        <span className="ml-auto text-lg font-extrabold text-ink">¥{month.totalYen.toLocaleString()}</span>
      </div>

      <ExpenseQuickEntry dateKey={todayKey} />

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.money.byCategoryHeading}</p>
        {month.byCategory.length === 0 ? (
          <p className="font-mono text-[10.5px] text-ink-faint">{t.money.noSpend}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {month.byCategory.map((c) => {
              const ratio = c.budgetYen ? c.spentYen / c.budgetYen : null;
              // Over the ceiling is one thing; on pace to go over is
              // another, and worth saying before the month ends.
              const over = ratio !== null && ratio > 1;
              const aheadOfPace = ratio !== null && !over && ratio > monthProgress + 0.1;
              return (
                <li key={c.category} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-ink">{c.category}</span>
                    {over && <span className="font-mono text-[9px] text-accent">{t.money.overBudget}</span>}
                    {aheadOfPace && <span className="font-mono text-[9px] text-ink-soft">{t.money.aheadOfPace}</span>}
                    <span className="ml-auto font-mono text-[11px] text-ink">¥{c.spentYen.toLocaleString()}</span>
                    <span className="font-mono text-[9.5px] text-ink-faint">/</span>
                    <input
                      defaultValue={c.budgetYen ?? ""}
                      onBlur={(e) => saveBudget(c.category, e.target.value)}
                      placeholder={t.money.noBudget}
                      inputMode="numeric"
                      className="w-20 rounded border border-line bg-surface px-1.5 py-0.5 text-right font-mono text-[10px] text-ink-soft focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-alt">
                    {ratio !== null && (
                      <div
                        className={`h-full rounded-full ${over ? "bg-accent" : "bg-[var(--color-meal)]"}`}
                        style={{ width: `${Math.min(ratio, 1) * 100}%` }}
                      />
                    )}
                    {/* Where the month is, so the bar can be read against
                        the calendar and not just the ceiling. */}
                    {c.budgetYen !== null && (
                      <div className="absolute top-0 h-full w-px bg-ink-faint" style={{ left: `${monthProgress * 100}%` }} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.money.paceNote}</p>
      </section>

      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.money.csvComingNote}</p>
    </div>
  );
}
