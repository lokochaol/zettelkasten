"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GoalView, MilestoneView } from "@/lib/goals";
import type { CycleView, EventView } from "@/lib/goalPlan";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { EVENT_COLOR, PILL } from "@/components/goals/ui";

/**
 * The roadmap as a Gantt chart: every goal in its colour, its phases as
 * bars on one timeline, from the multi-year view down to the weeks of the
 * current cycle.
 *
 *   - A goal row carries a thin band from its first phase to its last, so
 *     the long view reads at a glance; open it for one row per phase.
 *   - A phase with only an end date is a point (◆), the way a milestone is.
 *   - The current cycle is a shaded band behind everything, with its
 *     4-week phases on a row of their own; today is the accent line.
 *   - Deadlines and application windows sit on the 日付 row, coloured by kind.
 *
 * Clicking a phase hands it to `onSelect`; the screen opens its editor.
 */

const DAY = 86_400_000;
const dayNum = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY);

type Range = "all" | "year" | "cycle";
const LABEL_W = 148;
/** The label column on a phone, where the timeline needs the room. */
const LABEL_W_NARROW = 96;
/** Pixels per day for each range, so bars keep a readable size; the chart
 * scrolls sideways when it's wider than the screen. */
const PX_PER_DAY: Record<Range, number> = { all: 0.55, year: 2.2, cycle: 9 };

interface Tick {
  n: number;
  label: string;
  major: boolean;
}

function ticksFor(from: number, to: number, range: Range, locale: string): Tick[] {
  const ticks: Tick[] = [];
  const start = new Date(from * DAY);
  if (range === "cycle") {
    // Weekly ticks, months marked.
    for (let n = from; n <= to; n += 7) {
      const d = new Date(n * DAY);
      ticks.push({ n, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, major: d.getUTCDate() <= 7 });
    }
    return ticks;
  }
  const step = range === "all" && to - from > 900 ? 3 : 1;
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (;;) {
    const n = Math.round(Date.UTC(y, m, 1) / DAY);
    if (n > to) break;
    if (n >= from) {
      const major = m === 0;
      const label = major ? String(y) : locale === "ja" ? `${m + 1}月` : new Date(n * DAY).toLocaleDateString("en", { month: "short", timeZone: "UTC" });
      ticks.push({ n, label, major });
    }
    m += step;
    if (m >= 12) {
      y += Math.floor(m / 12);
      m %= 12;
    }
  }
  return ticks;
}

function Row({
  labelW,
  backdrop,
  label,
  children,
  height = 26,
  className = "",
}: {
  labelW: number;
  backdrop: ReactNode;
  label: ReactNode;
  children?: ReactNode;
  height?: number;
  className?: string;
}) {
  return (
    <div className={`flex ${className}`} style={{ height }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 overflow-hidden border-r border-line bg-surface pr-2" style={{ width: labelW }}>
        {label}
      </div>
      <div className="relative flex-1">
        {backdrop}
        {children}
      </div>
    </div>
  );
}

export function GoalGantt({
  goals,
  hexes,
  events,
  cycle,
  todayKey,
  selectedId,
  onSelect,
  onAddPhase,
}: {
  goals: GoalView[];
  hexes: Map<string, string>;
  events: EventView[];
  cycle: CycleView | null;
  todayKey: string;
  selectedId: string | null;
  onSelect: (goalId: string, milestoneId: string) => void;
  onAddPhase: (goalId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<Range>("all");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const today = dayNum(todayKey);

  const dated = useMemo(
    () =>
      goals.map((g) => ({
        goal: g,
        phases: g.milestones
          .filter((m) => m.dueDateKey || m.startDateKey)
          .map((m) => {
            const end = dayNum((m.dueDateKey ?? m.startDateKey)!);
            const start = m.startDateKey ? Math.min(dayNum(m.startDateKey), end) : end;
            return { m, start, end };
          }),
      })),
    [goals],
  );

  const [from, to] = useMemo(() => {
    if (range === "cycle" && cycle) return [dayNum(cycle.fromDateKey) - 3, dayNum(cycle.toDateKey) + 4];
    if (range === "year") {
      const d = new Date(today * DAY);
      return [Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / DAY), Math.round(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 1) / DAY)];
    }
    const points = [today, ...dated.flatMap((d) => d.phases.flatMap((p) => [p.start, p.end])), ...events.map((e) => dayNum(e.dateKey))];
    if (cycle) points.push(dayNum(cycle.fromDateKey), dayNum(cycle.toDateKey));
    const lo = new Date(Math.min(...points) * DAY);
    const hi = new Date(Math.max(...points) * DAY);
    // Whole months either side, so the axis starts and ends on a label.
    return [Math.round(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1) / DAY), Math.round(Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 1, 1) / DAY)];
  }, [range, cycle, today, dated, events]);

  // At least as wide as the card, so a short plan still fills it.
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const labelW = boxWidth > 0 && boxWidth < 520 ? LABEL_W_NARROW : LABEL_W;
  const span = Math.max(1, to - from);
  const width = Math.max(560, boxWidth - labelW - 2, Math.round(span * PX_PER_DAY[range]));
  const x = (n: number) => ((Math.min(Math.max(n, from), to) - from) / span) * 100;
  const ticks = useMemo(() => ticksFor(from, to, range, locale), [from, to, range, locale]);

  // Open on today, a third of the way in.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const px = labelW + ((today - from) / span) * width;
    el.scrollLeft = Math.max(0, px - (el.clientWidth - labelW) / 3 - labelW);
  }, [range, from, span, width, today, labelW]);

  const anyPhase = dated.some((d) => d.phases.length > 0);
  const cycleBand = cycle ? { left: x(dayNum(cycle.fromDateKey)), right: x(dayNum(cycle.toDateKey) + 1) } : null;

  /** The shared background of every track: grid lines, the cycle band, today. */
  const backdrop = (
    <>
      {ticks.map((tk) => (
        <div
          key={tk.n}
          aria-hidden="true"
          className={`absolute inset-y-0 border-l ${tk.major ? "border-line-strong/70" : "border-line/60"}`}
          style={{ left: `${x(tk.n)}%` }}
        />
      ))}
      {cycleBand && (
        <div aria-hidden="true" className="absolute inset-y-0 bg-accent/[0.06]" style={{ left: `${cycleBand.left}%`, width: `${cycleBand.right - cycleBand.left}%` }} />
      )}
      {today >= from && today <= to && <div aria-hidden="true" className="absolute inset-y-0 z-[1] border-l-2 border-accent" style={{ left: `${x(today)}%` }} />}
    </>
  );

  const bar = (goal: GoalView, hex: string, p: { m: MilestoneView; start: number; end: number }, withLabel: boolean) => {
    const left = x(p.start);
    const point = p.m.startDateKey === null || p.start === p.end;
    const selected = selectedId === p.m.id;
    const title = `${p.m.label}${p.m.startDateKey ? ` ${p.m.startDateKey}` : ""} → ${p.m.dueDateKey ?? ""}${p.m.condition ? `\n${t.plan.phaseCondition}: ${p.m.condition}` : ""}`;
    if (point) {
      return (
        <button
          key={p.m.id}
          type="button"
          title={title}
          onClick={() => onSelect(goal.id, p.m.id)}
          className="absolute top-1/2 z-[2] flex -translate-y-1/2 items-center gap-1 whitespace-nowrap"
          style={{ left: `calc(${left}% - 6px)` }}
        >
          <span
            className={`block h-3 w-3 rotate-45 rounded-[2px] ${selected ? "ring-2 ring-ink" : ""}`}
            style={{ background: p.m.done ? tint(hex, 0.45) : hex }}
          />
          {withLabel && <span className="font-mono text-[10px] text-ink-soft">{p.m.label}</span>}
        </button>
      );
    }
    const w = Math.max(0.4, x(p.end + 1) - left);
    const style: CSSProperties = {
      left: `${left}%`,
      width: `${w}%`,
      background: p.m.done
        ? `repeating-linear-gradient(135deg, ${tint(hex, 0.16)} 0 5px, ${tint(hex, 0.08)} 5px 10px)`
        : `linear-gradient(90deg, ${tint(hex, 0.38)}, ${tint(hex, 0.2)})`,
      borderLeft: `3px solid ${hex}`,
    };
    return (
      <button
        key={p.m.id}
        type="button"
        title={title}
        onClick={() => onSelect(goal.id, p.m.id)}
        className={`absolute top-1/2 z-[2] flex h-[18px] -translate-y-1/2 items-center overflow-hidden rounded-r-md px-1.5 text-left transition-shadow hover:shadow-[0_0_0_1px_currentColor] ${
          selected ? "shadow-[0_0_0_2px_currentColor]" : ""
        }`}
        style={{ ...style, color: hex }}
      >
        {withLabel && (
          <span className={`truncate font-mono text-[10px] font-semibold ${p.m.done ? "text-ink-faint line-through" : "text-ink"}`}>
            {p.m.done ? "✓ " : ""}
            {p.m.label}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="tablist" className="flex rounded-full border border-line p-0.5">
          {(["all", "year", "cycle"] as Range[])
            .filter((r) => r !== "cycle" || cycle)
            .map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] ${range === r ? "bg-ink text-surface" : "text-ink-soft hover:text-accent"}`}
              >
                {t.plan.range[r]}
              </button>
            ))}
        </div>
        <span className="ml-auto flex items-center gap-1 font-mono text-[9.5px] text-ink-faint">
          <span className="inline-block h-2.5 w-0.5 bg-accent" /> {t.plan.today} {todayKey.slice(5).replace("-", "/")}
        </span>
      </div>

      {!anyPhase && <p className="text-[11px] leading-relaxed text-ink-faint">{t.plan.roadmapEmpty}</p>}

      <div ref={scroller} className="overflow-x-auto overscroll-x-contain rounded-lg border border-line">
        <div style={{ width: labelW + width }} className="flex flex-col pb-1">
          {/* axis */}
          <Row labelW={labelW} backdrop={backdrop} label={null} height={24} className="sticky top-0 border-b border-line">
            {ticks.map((tk) => (
              <span
                key={tk.n}
                className={`absolute top-1 pl-1 font-mono text-[9.5px] whitespace-nowrap ${tk.major ? "font-semibold text-ink" : "text-ink-faint"}`}
                style={{ left: `${x(tk.n)}%` }}
              >
                {tk.label}
              </span>
            ))}
          </Row>

          {/* the current cycle and its phases */}
          {cycle && (
            <Row labelW={labelW} backdrop={backdrop}
              label={
                <span className="truncate pl-2 font-mono text-[10px] font-semibold text-accent" title={cycle.label}>
                  {cycle.label || t.plan.tab.cycle}
                </span>
              }
            >
              {(cycle.phases.length > 0 ? cycle.phases : [{ label: cycle.label, fromDateKey: cycle.fromDateKey, toDateKey: cycle.toDateKey }]).map((p, i) => {
                const l = x(dayNum(p.fromDateKey));
                const w = x(dayNum(p.toDateKey) + 1) - l;
                const current = todayKey >= p.fromDateKey && todayKey <= p.toDateKey;
                return (
                  <div
                    key={i}
                    title={`${p.label} ${p.fromDateKey}〜${p.toDateKey}`}
                    className={`absolute top-1/2 z-[2] flex h-[16px] -translate-y-1/2 items-center overflow-hidden border-r-2 border-surface px-1 font-mono text-[9.5px] ${
                      current ? "bg-accent text-on-accent" : "bg-accent/25 text-ink"
                    } ${i === 0 ? "rounded-l-md" : ""}`}
                    style={{ left: `${l}%`, width: `${w}%` }}
                  >
                    <span className="truncate">{p.label}</span>
                  </div>
                );
              })}
            </Row>
          )}

          {/* dates */}
          {events.length > 0 && (
            <Row labelW={labelW} backdrop={backdrop}
              label={<span className="pl-2 font-mono text-[10px] text-ink-soft">{t.plan.datesRow}</span>}
              className="border-b border-line"
            >
              {events.map((e) => {
                const hex = EVENT_COLOR[e.kind] ?? "#64748b";
                const s = dayNum(e.dateKey);
                const end = e.endDateKey ? dayNum(e.endDateKey) : s;
                const tip = `${t.plan.eventKind[e.kind]}: ${e.title} ${e.dateKey}${e.endDateKey ? `〜${e.endDateKey}` : ""}${e.confirmed ? "" : ` (${t.plan.candidate})`}`;
                return end > s ? (
                  <div
                    key={e.id}
                    title={tip}
                    className="absolute top-1/2 z-[2] h-1.5 -translate-y-1/2 rounded-full"
                    style={{ left: `${x(s)}%`, width: `${Math.max(0.3, x(end + 1) - x(s))}%`, background: e.done ? tint(hex, 0.35) : hex, opacity: e.confirmed ? 1 : 0.55 }}
                  />
                ) : (
                  <div
                    key={e.id}
                    title={tip}
                    className="absolute top-1/2 z-[2] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px]"
                    style={{
                      left: `${x(s)}%`,
                      background: e.confirmed ? (e.done ? tint(hex, 0.35) : hex) : "transparent",
                      border: `1.5px solid ${hex}`,
                    }}
                  />
                );
              })}
            </Row>
          )}

          {dated.map(({ goal, phases }) => {
            const hex = hexes.get(goal.id) ?? "#94a3b8";
            const open = !closed.has(goal.id);
            const lo = phases.length ? Math.min(...phases.map((p) => p.start)) : null;
            const hi = phases.length ? Math.max(...phases.map((p) => p.end)) : null;
            return (
              <div key={goal.id} className="flex flex-col border-b border-line/70 last:border-b-0">
                <Row labelW={labelW} backdrop={backdrop}
                  height={30}
                  label={
                    <button
                      type="button"
                      onClick={() =>
                        setClosed((s) => {
                          const next = new Set(s);
                          if (next.has(goal.id)) next.delete(goal.id);
                          else next.add(goal.id);
                          return next;
                        })
                      }
                      aria-expanded={open}
                      className="flex min-w-0 items-center gap-1.5 pl-1 text-left"
                      title={goal.title}
                    >
                      <span className={`text-[8px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                      <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: hex }} />
                      <span className="truncate text-[11.5px] font-bold text-ink">{goal.title}</span>
                      {goal.weeklyHours > 0 && <span className="shrink-0 font-mono text-[9px] text-ink-faint">{goal.weeklyHours}h</span>}
                    </button>
                  }
                >
                  {lo !== null && hi !== null && (
                    <div
                      aria-hidden="true"
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                      style={{ left: `${x(lo)}%`, width: `${Math.max(0.3, x(hi + 1) - x(lo))}%`, background: tint(hex, 0.5) }}
                    />
                  )}
                  {/* closed, the phases still show — packed on the one row */}
                  {!open && phases.map((p) => bar(goal, hex, p, false))}
                </Row>
                {open &&
                  phases.map((p) => (
                    <Row labelW={labelW} backdrop={backdrop}
                      key={p.m.id}
                      label={
                        <button
                          type="button"
                          onClick={() => onSelect(goal.id, p.m.id)}
                          className={`truncate pl-5 text-left font-mono text-[10px] ${p.m.done ? "text-ink-faint line-through" : "text-ink-soft"} hover:text-accent`}
                          title={p.m.label}
                        >
                          {p.m.label}
                        </button>
                      }
                    >
                      {bar(goal, hex, p, true)}
                    </Row>
                  ))}
                {open && (
                  <div className="flex" style={{ height: 22 }}>
                    <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface pl-5" style={{ width: labelW }}>
                      <button type="button" onClick={() => onAddPhase(goal.id)} className="font-mono text-[9.5px] text-ink-faint hover:text-accent">
                        + {t.plan.addPhase}
                      </button>
                    </div>
                    <div className="relative flex-1">{backdrop}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9.5px] text-ink-faint">
        {Object.entries(EVENT_COLOR).map(([kind, hex]) => (
          <span key={kind} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45" style={{ background: hex }} />
            {t.plan.eventKind[kind as keyof typeof t.plan.eventKind]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rotate-45 border border-ink-faint" />
          {t.plan.candidate}
        </span>
        <button type="button" onClick={() => setClosed(closed.size ? new Set() : new Set(goals.map((g) => g.id)))} className={`${PILL} ml-auto`}>
          {closed.size ? "▼" : "▲"}
        </button>
      </div>
    </div>
  );
}

