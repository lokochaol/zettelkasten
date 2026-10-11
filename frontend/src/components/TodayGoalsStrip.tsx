"use client";

import Link from "next/link";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { TodayFocus } from "@/lib/goals";

/**
 * The top of the calendar's 今日: which goals today is for (from the focus
 * period that covers it, by whether it's a weekday or a day off), and the
 * goal steps whose dates are near or already past. A glance, not an editor
 * — the goals themselves are a tap away on /goals.
 */
export function TodayGoalsStrip({ focus }: { focus: TodayFocus }) {
  const { t, locale } = useI18n();
  const day = (key: string) => formatDateKey(key, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" });

  return (
    <Link
      href="/goals"
      className="group flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 transition-colors hover:border-accent"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-accent">{t.goals.todayHeading}</p>
        <span className="font-mono text-[10px] text-ink-soft">
          {t.goals.slot[focus.dayKind]}
          {focus.periodLabel ? ` · ${focus.periodLabel}` : ""}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-faint group-hover:text-accent">{t.goals.todayOpen} →</span>
      </div>
      {focus.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {focus.lines.map((l, i) => (
            <li key={i} className="text-[12.5px] text-ink">
              {l.goalTitle ? <span className="font-bold">🚩 {l.goalTitle}</span> : null}
              {l.note && <span className={l.goalTitle ? "ml-1.5 text-ink-soft" : "text-ink-soft"}>{l.goalTitle ? `— ${l.note}` : l.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {focus.spare.length > 0 && (
        <p className="text-[11.5px] text-ink-soft">
          <span className="mr-1.5 font-mono text-[10px] text-ink-faint">{t.goals.slot.spare}</span>
          {focus.spare.map((l) => [l.goalTitle && `🚩 ${l.goalTitle}`, l.note].filter(Boolean).join(" — ")).join(" / ")}
        </p>
      )}
      {focus.upcoming.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-accent/20 pt-2">
          {focus.upcoming.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
              <span className={`font-mono text-[10px] ${s.overdue ? "font-semibold text-accent" : "text-ink-soft"}`}>
                {s.overdue ? t.goals.todayOverdue(day(s.dueDateKey)) : day(s.dueDateKey)}
              </span>
              <span className="text-ink">
                {s.goalTitle} · {s.label}
              </span>
              {s.firstLine && <span className="min-w-0 truncate text-ink-faint">{s.firstLine}</span>}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
