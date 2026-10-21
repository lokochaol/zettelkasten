"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GoalView } from "@/lib/goals";
import type { PlanOverview } from "@/lib/goalPlan";
import { goalColor } from "@/lib/goalColors";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";

/*
 * The pieces every tab of the goals plan is built from, so the tabs read as
 * one page: the same card, the same small mono labels, the same fields that
 * save when you leave them, and each goal's colour wherever it appears.
 */

/** What every tab gets from the screen. */
export interface TabProps {
  ov: PlanOverview;
  setOv: (update: (o: PlanOverview) => PlanOverview) => void;
  todayKey: string;
  /** Active goals, in the owner's order. */
  active: GoalView[];
  hexes: Map<string, string>;
  /** Bumped when everything is re-read, so editors start over. */
  generation: number;
  onError: (message: string | null) => void;
}

/** An action's result, or null after reporting its error. */
export function okOr<T extends object>(res: T | { error: string }, onError: (m: string) => void): T | null {
  if ("error" in res) {
    onError(res.error);
    return null;
  }
  return res;
}

export const INPUT =
  "rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none disabled:opacity-50";
export const PILL =
  "rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
export const PRIMARY = "rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40";
export const LABEL = "font-mono text-[9.5px] tracking-wider text-ink-faint";

// Client-side copies of the plan's fixed lists (src/lib/goalPlan.ts is
// server-only: it reads the database).
export const DELIVERABLE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "STEP_DONE", "SUBMITTED", "WAITING", "NEEDS_FIX", "CONFIRMED"] as const;
export const EVENT_KINDS = ["DEADLINE", "APPLICATION", "EVENT", "REVIEW"] as const;
export const EXPERIMENT_STATUSES = ["RUNNING", "KEPT", "ADJUSTED", "REVERTED"] as const;

/** Each status's colour on the board: grey to start, the accent while
 * working, blue once out of hand, green when settled, rose to fix. */
export const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "#94a3b8",
  IN_PROGRESS: "#f2552c",
  STEP_DONE: "#d39200",
  SUBMITTED: "#3b6fe0",
  WAITING: "#8b5cf6",
  NEEDS_FIX: "#e0457b",
  CONFIRMED: "#1f9d6b",
};

export const EVENT_COLOR: Record<string, string> = {
  DEADLINE: "#e0457b",
  APPLICATION: "#3b6fe0",
  EVENT: "#64748b",
  REVIEW: "#1f9d6b",
};

/** goalId → its colour, by the goal's chosen palette entry or its place in the list. */
export function goalHexes(goals: GoalView[]): Map<string, string> {
  return new Map(goals.map((g, i) => [g.id, goalColor(g.color, i).hex]));
}

export const NO_GOAL_HEX = "#94a3b8";

export function useDay() {
  const { locale } = useI18n();
  return {
    /** 11/1 */
    short: (key: string) => formatDateKey(key, localeTag(locale), { month: "numeric", day: "numeric" }),
    /** 11/1(日) */
    withWeekday: (key: string) => formatDateKey(key, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" }),
    /** 2026/11/1 */
    full: (key: string) => formatDateKey(key, localeTag(locale), { year: "numeric", month: "numeric", day: "numeric" }),
  };
}

export function Card({ title, intro, action, children, className = "" }: { title?: ReactNode; intro?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center gap-2">
          {title && <h2 className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{title}</h2>}
          {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
        </div>
      )}
      {intro && <p className="text-[11px] leading-relaxed text-ink-faint">{intro}</p>}
      {children}
    </section>
  );
}

export function Dot({ hex, size = 8 }: { hex: string; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: hex }} />;
}

/** A goal's name with its colour, for rows and chips. */
export function GoalChip({ goal, hex }: { goal: GoalView | undefined; hex: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-ink-soft">
      <Dot hex={hex} />
      <span className="truncate">{goal?.title ?? t.plan.noGoal}</span>
    </span>
  );
}

export function GoalSelect({
  goals,
  value,
  onChange,
  className = "",
  allowNone = true,
}: {
  goals: GoalView[];
  value: string | null;
  onChange: (goalId: string | null) => void;
  className?: string;
  allowNone?: boolean;
}) {
  const { t } = useI18n();
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={t.plan.goalLabel} className={`${INPUT} ${className}`}>
      {allowNone && <option value="">{t.plan.noGoal}</option>}
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.title}
        </option>
      ))}
    </select>
  );
}

/**
 * A text field that saves when you leave it. Registered with the
 * unsaved-changes guard while it holds an edit, so switching tabs or
 * leaving the page doesn't drop it.
 */
export function BlurText({
  value,
  onSave,
  label,
  placeholder,
  rows = 1,
  className = "",
  mono = false,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  label?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  mono?: boolean;
}) {
  const { register } = useUnsavedChanges();
  const [text, setText] = useState(value);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ text, value, onSave });
  useEffect(() => {
    latest.current = { text, value, onSave };
  });
  // A new value from outside (another tab, the advisor) replaces the field
  // unless it's being edited.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (text === seen) setText(value);
  }

  async function save() {
    const { text: now, value: before, onSave: persist } = latest.current;
    if (now === before) return;
    try {
      await persist(now);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      throw e;
    }
  }

  useEffect(
    () =>
      register({
        isDirty: () => latest.current.text !== latest.current.value,
        save,
        discard: () => setText(latest.current.value),
      }),
    [register],
  );

  // A faint outline while empty, so an unfilled field still reads as one.
  const common = `w-full min-w-0 rounded-md border px-2 py-1 text-ink placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface focus:outline-none ${
    failed ? "border-accent" : text ? "border-transparent bg-transparent" : "border-dashed border-line bg-surface/40"
  } ${mono ? "font-mono text-[11px]" : "text-[12.5px] leading-relaxed"} ${className}`;
  const field =
    rows === 1 ? (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save().catch(() => {})}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
        placeholder={placeholder}
        aria-label={label}
        className={common}
      />
    ) : (
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save().catch(() => {})}
        placeholder={placeholder}
        aria-label={label}
        rows={rows}
        style={{ fieldSizing: "content", minHeight: `${rows * 1.6 + 0.6}em` } as CSSProperties}
        className={`${common} resize-none`}
      />
    );
  if (!label) return field;
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className={LABEL}>{label}</span>
      {field}
    </label>
  );
}

/** A number of hours, saved on blur; quarter hours. */
export function HoursInput({ value, onSave, label, className = "" }: { value: number; onSave: (h: number) => void; label?: string; className?: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value ? String(value) : "");
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={0.25}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = text.trim() === "" ? 0 : Number(text);
        if (Number.isFinite(n) && n !== value) onSave(Math.max(0, Math.round(n * 4) / 4));
      }}
      aria-label={label}
      placeholder="0"
      className={`${INPUT} w-16 text-right ${className}`}
    />
  );
}

export function DateInput({ value, onChange, label, className = "" }: { value: string | null; onChange: (v: string | null) => void; label?: string; className?: string }) {
  return <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label} className={`${INPUT} ${className}`} />;
}

/** A thin horizontal bar: `value` of `max`, with an optional mark (e.g. the 80% line). */
export function Meter({ value, max, hex, mark }: { value: number; max: number; hex: string; mark?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-alt">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hex }} />
      {mark !== undefined && max > 0 && (
        <div className="absolute inset-y-0 border-l border-dashed border-ink-soft" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />
      )}
    </div>
  );
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes from "HH:MM". */
export const minutesOf = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
