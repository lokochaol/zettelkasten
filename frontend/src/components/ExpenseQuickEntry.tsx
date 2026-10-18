"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addExpenseAction, getMoneyDayAction, removeExpenseAction, type MoneyDayView } from "@/app/money/actions";
import { useEnterKey } from "@/lib/ime";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { announceChange, useRefreshOn } from "@/lib/dataSync";
import { formatDateKey, todayKey as todayKeyValue } from "@/lib/dateKey";
import { localeTag } from "@/lib/i18n/dictionary";

/**
 * Typing a purchase in, in one line, wherever the owner already is.
 *
 * Daily money only works if entering it is faster than not bothering, so
 * this stays three fields and a button and never navigates anywhere. The
 * long view — where the year is going — is a different job on a different
 * screen; this one is for the coffee you just bought.
 *
 * The date defaults to the screen's day (today on /money, the day being
 * looked at on the calendar) and can be changed, for the receipt found in
 * a pocket two days later. The list and total underneath follow the date
 * picked, so what was just entered is always in view.
 */
export function ExpenseQuickEntry({ dateKey, compact = false }: { dateKey: string; compact?: boolean }) {
  const { t, locale } = useI18n();
  // The date picked, remembered against the day it was picked on: when the
  // screen moves to another day, the entry date goes back to that day.
  const [picked, setPicked] = useState<{ base: string; value: string }>({ base: dateKey, value: dateKey });
  const entryDate = picked.base === dateKey ? picked.value : dateKey;
  const setEntryDate = (value: string) => setPicked({ base: dateKey, value });
  const [view, setView] = useState<MoneyDayView | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const amountRef = useRef<HTMLInputElement>(null);
  // Enter submits — except the Enter that confirms a Japanese conversion.
  const enterKey = useEnterKey(() => submit());

  useEffect(() => {
    getMoneyDayAction(entryDate).then((v) => {
      setView(v);
      setCategory((prev) => prev || v.categories[0] || "");
    });
  }, [entryDate]);

  useRefreshOn(["money"], () => void getMoneyDayAction(entryDate).then(setView));

  function submit() {
    const amountYen = Number(amount.replace(/[,¥\s]/g, ""));
    if (!Number.isFinite(amountYen) || amountYen === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await addExpenseAction({ dateKey: entryDate, amountYen, category, memo });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setView(res.view);
      // The day's totals on the calendar and the month on /money move too.
      announceChange("money");
      setAmount("");
      setMemo("");
      // Straight back to the amount: the next thing anyone does here is
      // enter another one.
      amountRef.current?.focus();
    });
  }

  const foodBudget = view?.month.byCategory.find((c) => c.category === "食費");

  return (
    <section className={compact ? "flex flex-col gap-2" : "flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"}>
      {!compact && <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.money.quickEntryHeading}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={entryDate}
          onChange={(e) => e.target.value && setEntryDate(e.target.value)}
          aria-label={t.money.entryDate}
          className={`rounded-md border bg-surface px-2 py-1.5 font-mono text-[11px] focus:border-accent focus:outline-none ${
            entryDate === dateKey ? "border-line text-ink" : "border-accent text-accent"
          }`}
        />
        {entryDate !== dateKey && (
          <button
            type="button"
            onClick={() => setEntryDate(dateKey)}
            className="rounded-full border border-line-strong px-2 py-1 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent"
          >
            {dateKey === todayKeyValue() ? t.money.entryDateBackToday : t.money.entryDateBack}
          </button>
        )}
        <input
          ref={amountRef}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          {...enterKey}
          inputMode="numeric"
          placeholder={t.money.amountPlaceholder}
          className="w-24 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none"
        >
          {(view?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          {...enterKey}
          placeholder={t.money.memoPlaceholder}
          className="min-w-0 flex-1 basis-40 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={pending || !amount}
          className="btn-sheen rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
        >
          {t.common.add}
        </button>
      </div>
      {error && <p className="text-[10.5px] text-accent">{error}</p>}

      {view && view.today.length > 0 && (
        <ul className="flex flex-col gap-1">
          {view.today.map((e) => (
            <li key={e.id} className="group flex items-center gap-2">
              <span className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[9px] text-ink-soft">{e.category}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{e.memo || "—"}</span>
              <span className="font-mono text-[11px] text-ink">¥{e.amountYen.toLocaleString()}</span>
              <button
                onClick={() =>
                  startTransition(async () => {
                    setView(await removeExpenseAction(e.id, entryDate));
                    announceChange("money");
                  })
                }
                className="font-mono text-[9px] text-ink-faint transition-opacity mouse:opacity-0 group-hover:opacity-100 hover:text-accent touch:-my-1 touch:px-1.5 touch:py-1 touch:text-[10.5px]"
              >
                {t.common.delete}
              </button>
            </li>
          ))}
        </ul>
      )}

      {view && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-2">
          <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">
            {entryDate === todayKeyValue()
              ? t.money.todayTotal
              : t.money.dayTotal(formatDateKey(entryDate, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" }))}
          </span>
          <span className="text-[13px] font-bold text-ink">¥{view.todayTotalYen.toLocaleString()}</span>
          {foodBudget?.budgetYen != null && (
            <span className="font-mono text-[9.5px] text-ink-soft">
              {t.money.foodProgress(foodBudget.spentYen, foodBudget.budgetYen, view.month.daysInMonth - view.month.dayOfMonth)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
