"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  createSubPlanAction,
  deleteItemAction,
  deleteStepAction,
  deleteSubPlanAction,
  getSubPlanDocumentAction,
  saveItemAction,
  saveStepAction,
  saveWeekCellAction,
  updateSubPlanAction,
} from "@/app/goals/planActions";
import type { ItemInput, ItemView, StepInput, StepView, SubPlanView } from "@/lib/goalSubPlan";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PlanDocumentApply, documentTitle, downloadMarkdown } from "@/components/goals/PlanDocumentApply";
import { BlurText, Card, DateInput, GoalSelect, INPUT, LABEL, NO_GOAL_HEX, PILL, PRIMARY, okOr, round1, useDay, type TabProps } from "@/components/goals/ui";
import { shiftDateKey } from "@/lib/dateKey";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/*
 * 詳細計画 — an area's plan at the level of courses and assignments: the
 * ledger with each item's size and state, every dated step on a timeline
 * (work periods as bars; drafts, checks, submission targets with their
 * fallback, sessions and decisions as marks), the week-by-week execution
 * table and the day-by-day plan. All of it in the area's colour.
 */

export const ITEM_STATUSES = ["PLANNED", "REGISTERED", "IN_PROGRESS", "SUBMITTED", "PASSED", "DONE", "DROPPED"] as const;
export const STEP_KINDS = ["WORK", "DRAFT", "CHECK", "DUE", "SESSION", "DECISION", "OTHER"] as const;

export const ITEM_STATUS_COLOR: Record<string, string> = {
  PLANNED: "#94a3b8",
  REGISTERED: "#d39200",
  IN_PROGRESS: "#f2552c",
  SUBMITTED: "#3b6fe0",
  PASSED: "#0e9fb3",
  DONE: "#1f9d6b",
  DROPPED: "#64748b",
};

const STEP_COLOR: Record<string, string> = {
  DRAFT: "#8b5cf6",
  CHECK: "#0e9fb3",
  DUE: "#e0457b",
  SESSION: "#3b6fe0",
  DECISION: "#d39200",
  OTHER: "#64748b",
};

/** The mark a step gets on the timeline and in lists. */
function StepMark({ kind, hex, done = false, size = 10 }: { kind: string; hex: string; done?: boolean; size?: number }) {
  const c = kind === "WORK" ? hex : (STEP_COLOR[kind] ?? hex);
  const fill = done ? tint(c, 0.35) : c;
  const base: CSSProperties = { width: size, height: size, display: "inline-block", flexShrink: 0 };
  if (kind === "DUE") return <span aria-hidden="true" style={{ ...base, background: fill, transform: "rotate(45deg)", borderRadius: 1 }} />;
  if (kind === "DRAFT") return <span aria-hidden="true" style={{ ...base, border: `2px solid ${c}`, borderRadius: "50%", background: done ? tint(c, 0.3) : "transparent" }} />;
  if (kind === "CHECK") return <span aria-hidden="true" style={{ ...base, background: fill, borderRadius: 2 }} />;
  if (kind === "SESSION") return <span aria-hidden="true" style={{ ...base, background: fill, borderRadius: "50%" }} />;
  if (kind === "DECISION")
    return <span aria-hidden="true" style={{ width: 0, height: 0, borderLeft: `${size / 2 + 1}px solid transparent`, borderRight: `${size / 2 + 1}px solid transparent`, borderBottom: `${size}px solid ${fill}`, flexShrink: 0 }} />;
  if (kind === "WORK") return <span aria-hidden="true" style={{ ...base, height: size * 0.6, background: tint(c, 0.45), borderLeft: `2px solid ${c}`, borderRadius: 2 }} />;
  return <span aria-hidden="true" style={{ ...base, width: size * 0.7, height: size * 0.7, border: `1.5px solid ${c}`, borderRadius: 2 }} />;
}

export function DetailTab(props: TabProps) {
  const { ov, setOv, active, hexes, onError, openAdvisor, openImport } = props;
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(ov.subPlans[0]?.id ?? null);
  const plan = ov.subPlans.find((p) => p.id === selectedId) ?? ov.subPlans[0] ?? null;
  const put = (next: SubPlanView) => setOv((o) => ({ ...o, subPlans: o.subPlans.map((p) => (p.id === next.id ? next : p)) }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {ov.subPlans.map((p) => {
          const hex = p.goalId ? (hexes.get(p.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX;
          const on = p.id === plan?.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              aria-pressed={on}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold"
              style={on ? { borderColor: hex, background: tint(hex, 0.14), color: "var(--color-ink)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-soft)" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
              {p.title}
            </button>
          );
        })}
      </div>

      {plan ? (
        <PlanView key={plan.id} {...props} plan={plan} put={put} onDeleted={() => setSelectedId(null)} />
      ) : null}

      <NewPlan
        goals={active}
        empty={ov.subPlans.length === 0}
        onAsk={(area) => openAdvisor(t.plan.detailAskPrompt(area))}
        onImport={openImport}
        onCreate={async (goalId, title) => {
          const res = okOr(await createSubPlanAction(goalId, title), onError);
          if (!res) return;
          setOv((o) => ({ ...o, subPlans: [...o.subPlans, res.subPlan] }));
          setSelectedId(res.subPlan.id);
        }}
      />
    </div>
  );
}

function NewPlan({
  goals,
  empty,
  onAsk,
  onImport,
  onCreate,
}: {
  goals: TabProps["active"];
  empty: boolean;
  onAsk: (area: string) => void;
  onImport: () => void;
  onCreate: (goalId: string | null, title: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [goalId, setGoalId] = useState<string | null>(goals[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const area = goals.find((g) => g.id === goalId)?.title ?? "";
  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GoalSelect goals={goals} value={goalId} onChange={setGoalId} allowNone={false} />
        <button type="button" onClick={() => onAsk(area)} disabled={!area} className={`${PRIMARY} flex items-center gap-1.5`}>
          ✦ {t.plan.detailAsk}
        </button>
        <button type="button" onClick={onImport} className={PILL}>
          {t.plan.startImport}
        </button>
      </div>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (title.trim()) void onCreate(goalId, title).then(() => setTitle(""));
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.plan.detailTitlePlaceholder} className={`${INPUT} min-w-40 flex-1`} />
        <button type="submit" disabled={!title.trim()} className={PILL}>
          + {t.plan.detailCreate}
        </button>
      </form>
    </div>
  );
  if (empty) {
    return (
      <Card title={t.plan.detailHeading} intro={`${t.plan.detailIntro} ${t.plan.detailEmpty}`}>
        {body}
      </Card>
    );
  }
  return (
    <details className="rounded-xl border border-line px-4 py-3">
      <summary className="cursor-pointer font-mono text-[10px] text-ink-soft">+ {t.plan.detailNew}</summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}

type PlanProps = TabProps & { plan: SubPlanView; put: (p: SubPlanView) => void; onDeleted: () => void };

function PlanView(props: PlanProps) {
  const { plan, hexes } = props;
  const hex = plan.goalId ? (hexes.get(plan.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX;
  return (
    <div className="flex flex-col gap-5">
      <PlanHeader {...props} hex={hex} />
      <div className="grid items-start gap-5 lg:grid-cols-[2fr_3fr]">
        <Upcoming {...props} hex={hex} />
        <DayPlan {...props} />
      </div>
      <Timeline {...props} hex={hex} />
      <Ledger {...props} hex={hex} />
      <WeekTable {...props} hex={hex} />
    </div>
  );
}

function PlanHeader({ plan, put, ov, setOv, active, todayKey, onError, openAdvisor, onDeleted, hex }: PlanProps & { hex: string }) {
  const { t } = useI18n();
  const day = useDay();
  const [confirm, setConfirm] = useState(false);
  const [rebuild, setRebuild] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const counted = plan.items.filter((i) => i.status !== "DROPPED");
  const sum = (st: string[]) => round1(counted.filter((i) => st.includes(i.status)).reduce((a, i) => a + i.size, 0));
  const doneSize = round1(plan.baseDone + sum(["DONE"]));
  const total = plan.targetTotal || round1(plan.baseDone + counted.reduce((a, i) => a + i.size, 0));
  const segments = [
    ...(plan.baseDone > 0 ? [{ st: "BASE", n: plan.baseDone }] : []),
    ...(["DONE", "PASSED", "SUBMITTED", "IN_PROGRESS", "REGISTERED"] as const).map((st) => ({ st: st as string, n: sum([st]) })),
  ].filter((x) => x.n > 0);

  async function save(patch: Parameters<typeof updateSubPlanAction>[1]) {
    const res = await updateSubPlanAction(plan.id, patch);
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    put(res.subPlan);
  }

  async function withDocument(then: (markdown: string) => void) {
    const res = okOr(await getSubPlanDocumentAction(plan.id), onError);
    if (res?.markdown) then(res.markdown);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-l-4 border-line bg-surface p-4" style={{ borderLeftColor: hex }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <BlurText value={plan.title} onSave={(title) => (title.trim() ? save({ title }) : undefined)} className="text-[15px] font-bold" />
        </div>
        <GoalSelect goals={active} value={plan.goalId} onChange={(goalId) => void save({ goalId }).catch(() => {})} className="max-w-40" />
      </div>
      <BlurText label={t.plan.detailSummary} value={plan.summary} rows={2} onSave={(summary) => save({ summary })} />

      {/* Where the ledger stands, in its unit: done, then what's under way. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-alt">
          {segments.map((x) => (
            <div
              key={x.st}
              title={`${x.st === "BASE" ? t.plan.detailBase : t.plan.itemStatus[x.st]} ${x.n}${plan.unitLabel}`}
              style={{ width: `${total > 0 ? (x.n / total) * 100 : 0}%`, background: x.st === "BASE" ? tint(ITEM_STATUS_COLOR.DONE, 0.55) : ITEM_STATUS_COLOR[x.st] }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]">
          <span className="font-semibold text-ink">{t.plan.detailProgress(doneSize, total, plan.unitLabel)}</span>
          {segments
            .filter((x) => x.st !== "DONE" && x.st !== "BASE")
            .map((x) => (
              <span key={x.st} className="flex items-center gap-1 text-ink-soft">
                <span className="h-2 w-2 rounded-sm" style={{ background: ITEM_STATUS_COLOR[x.st] }} />
                {t.plan.itemStatus[x.st]} {x.n}
              </span>
            ))}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-faint">
            <label className="flex items-center gap-1 whitespace-nowrap">
              {t.plan.detailUnit}
              <input
                defaultValue={plan.unitLabel}
                onBlur={(e) => e.target.value !== plan.unitLabel && void save({ unitLabel: e.target.value }).catch(() => {})}
                className={`${INPUT} w-14`}
              />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              {t.plan.detailBase}
              <input
                type="number"
                defaultValue={plan.baseDone || ""}
                onBlur={(e) => Number(e.target.value) !== plan.baseDone && void save({ baseDone: Number(e.target.value) || 0 }).catch(() => {})}
                className={`${INPUT} w-14 text-right`}
              />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              {t.plan.detailTarget}
              <input
                type="number"
                defaultValue={plan.targetTotal || ""}
                onBlur={(e) => Number(e.target.value) !== plan.targetTotal && void save({ targetTotal: Number(e.target.value) || 0 }).catch(() => {})}
                className={`${INPUT} w-16 text-right`}
              />
            </label>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-ink-faint">
          {t.plan.detailDocument}:{" "}
          {plan.document
            ? `${day.full(plan.document.createdOn)} · ${t.plan.documentSource[plan.document.source] ?? ""} · ${t.plan.advisorDocumentChars(plan.document.chars)}`
            : t.plan.detailDocumentNone}
        </span>
        {plan.document && (
          <>
            <button type="button" onClick={() => void withDocument((md) => downloadMarkdown(md, documentTitle(md) || plan.title))} className={PILL}>
              {t.plan.download}
            </button>
            <button type="button" onClick={() => void withDocument(setRebuild)} className={PILL}>
              {t.plan.documentRebuild}
            </button>
          </>
        )}
        <button type="button" onClick={() => openAdvisor(t.plan.detailDiscussPrompt(plan.title))} className={PILL}>
          ✦ {t.plan.documentDiscuss}
        </button>
        <button type="button" onClick={() => setConfirm(true)} className={`${PILL} ml-auto`}>
          {t.plan.remove}
        </button>
      </div>
      {rebuild !== null && (
        <PlanDocumentApply
          markdown={rebuild}
          todayKey={todayKey}
          goalCount={ov.goals.length}
          defaultMode="replace"
          autoRead
          onApplied={(r) => {
            setRebuild(null);
            setDone(r.message);
            setOv(() => r.overview);
          }}
          onCancel={() => setRebuild(null)}
        />
      )}
      {done && <p className="text-[11.5px] text-ink">{done}</p>}
      <ConfirmDialog
        open={confirm}
        title={t.plan.detailDelete}
        warning={t.plan.detailDeleteConfirm(plan.title)}
        confirmLabel={t.plan.remove}
        onConfirm={() => {
          setConfirm(false);
          setOv((o) => ({ ...o, subPlans: o.subPlans.filter((p) => p.id !== plan.id) }));
          onDeleted();
          void deleteSubPlanAction(plan.id);
        }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}

const itemName = (plan: SubPlanView, id: string | null) => {
  const it = plan.items.find((i) => i.id === id);
  return it ? it.title : "";
};

/** What's due in the next three weeks, and targets passed still open. */
function Upcoming({ plan, put, todayKey, onError, hex }: PlanProps & { hex: string }) {
  const { t } = useI18n();
  const day = useDay();
  const horizon = shiftDateKey(todayKey, 21);
  const list = plan.steps.filter((s) => !s.done && s.kind !== "WORK" && s.dateKey <= horizon && (s.dateKey >= todayKey || s.kind === "DUE"));
  return (
    <Card title={t.plan.detailUpcoming}>
      {list.length === 0 && <p className="text-[11.5px] text-ink-faint">{t.plan.detailUpcomingEmpty}</p>}
      <ul className="flex flex-col gap-1.5">
        {list.map((s) => {
          const overdue = s.dateKey < todayKey;
          return (
            <li key={s.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${overdue ? "bg-accent/10" : ""}`}>
              <input
                type="checkbox"
                checked={false}
                onChange={async () => {
                  const res = okOr(await saveStepAction(plan.id, s.id, { ...s, done: true }), onError);
                  if (res) put(res.subPlan);
                }}
                aria-label={t.plan.done}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="mt-1 flex h-3 w-3 items-center justify-center">
                <StepMark kind={s.kind} hex={hex} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-snug text-ink">
                  <span className={`mr-1.5 font-mono text-[10.5px] ${overdue ? "font-semibold text-accent" : "text-ink-soft"}`}>{day.withWeekday(s.dateKey)}</span>
                  {itemName(plan, s.itemId) && <span className="font-semibold">{itemName(plan, s.itemId)} </span>}
                  {s.label}
                </p>
                <p className="font-mono text-[9.5px] text-ink-faint">
                  {t.plan.stepKind[s.kind]}
                  {s.backupDateKey && ` · ${t.plan.backupOn(day.short(s.backupDateKey))}`}
                  {overdue && ` · ${t.plan.overdueTag}`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The day-by-day table: today first, the days ahead, the past folded away. */
function DayPlan({ plan, todayKey }: PlanProps) {
  const { t } = useI18n();
  const day = useDay();
  if (plan.days.length === 0) return null;
  const ahead = plan.days.filter((d) => d.dateKey >= todayKey);
  const past = plan.days.filter((d) => d.dateKey < todayKey);
  const row = (d: SubPlanView["days"][number]) => (
    <li key={d.dateKey} className={`flex flex-col gap-0.5 rounded-md border px-2.5 py-2 ${d.dateKey === todayKey ? "border-accent bg-accent/5" : "border-line"}`}>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className={`font-mono text-[11px] font-semibold ${d.dateKey === todayKey ? "text-accent" : "text-ink"}`}>{day.withWeekday(d.dateKey)}</span>
        <span className="font-mono text-[10px] text-ink-soft">{d.time}</span>
      </p>
      <p className="text-[11.5px] leading-relaxed text-ink">{d.work}</p>
      {d.output && <p className="text-[10.5px] text-ink-faint">→ {d.output}</p>}
    </li>
  );
  return (
    <Card title={t.plan.detailDays}>
      <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto">{(ahead.length > 0 ? ahead : plan.days.slice(-3)).map(row)}</ul>
      {past.length > 0 && ahead.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">{t.plan.detailPastDays(past.length)}</summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">{past.map(row)}</ul>
        </details>
      )}
    </Card>
  );
}

const DAY = 86_400_000;
const dayNum = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY);
const LABEL_W = 170;

/**
 * The plan's steps on one timeline: a row per item (and one for the plan
 * itself), work periods as bars in the area's colour, the rest as marks —
 * a fallback date as a faint mark joined to its target.
 */
function Timeline({ plan, todayKey, hex }: PlanProps & { hex: string }) {
  const { t } = useI18n();
  const day = useDay();
  const [all, setAll] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const planLevel = t.plan.planLevel;
  const rows = useMemo(() => {
    const byItem = new Map<string | null, StepView[]>();
    for (const s of plan.steps) byItem.set(s.itemId, [...(byItem.get(s.itemId) ?? []), s]);
    const out: { key: string; label: string; item: ItemView | null; steps: StepView[] }[] = [];
    if (byItem.get(null)?.length) out.push({ key: "plan", label: planLevel, item: null, steps: byItem.get(null)! });
    for (const it of plan.items) {
      const steps = byItem.get(it.id) ?? [];
      if (steps.length > 0 || (all && (it.fromDateKey || it.toDateKey))) out.push({ key: it.id, label: `${it.code ? `${it.code} ` : ""}${it.title}`, item: it, steps });
    }
    return out;
  }, [plan, all, planLevel]);

  const points = rows.flatMap((r) => [
    ...r.steps.flatMap((s) => [s.startDateKey ?? s.dateKey, s.dateKey, s.backupDateKey ?? s.dateKey]),
    ...(r.item?.fromDateKey ? [r.item.fromDateKey] : []),
    ...(r.item?.toDateKey ? [r.item.toDateKey] : []),
  ]);
  const from = points.length ? Math.min(dayNum(todayKey), ...points.map(dayNum)) - 3 : dayNum(todayKey) - 7;
  const to = points.length ? Math.max(dayNum(todayKey), ...points.map(dayNum)) + 4 : dayNum(todayKey) + 60;
  const span = Math.max(1, to - from);
  const width = Math.max(600, span * 7);
  const x = (n: number) => ((n - from) / span) * 100;
  const today = dayNum(todayKey);
  const ticks: { n: number; label: string; month: boolean }[] = [];
  for (let n = from; n <= to; n++) {
    const d = new Date(n * DAY);
    if (d.getUTCDay() === 1) ticks.push({ n, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, month: d.getUTCDate() <= 7 });
  }

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, ((today - from) / span) * width - (el.clientWidth - LABEL_W) / 4);
  }, [today, from, span, width]);

  if (rows.length === 0 && !all) return null;
  const backdrop = (
    <>
      {ticks.map((tk) => (
        <div key={tk.n} aria-hidden="true" className={`absolute inset-y-0 border-l ${tk.month ? "border-line-strong/70" : "border-line/50"}`} style={{ left: `${x(tk.n)}%` }} />
      ))}
      <div aria-hidden="true" className="absolute inset-y-0 z-[1] border-l-2 border-accent" style={{ left: `${x(today)}%` }} />
    </>
  );

  return (
    <Card
      title={t.plan.detailTimeline}
      action={
        <button type="button" onClick={() => setAll((v) => !v)} className={PILL}>
          {all ? t.plan.detailTimelineActive : t.plan.detailTimelineAll}
        </button>
      }
    >
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain rounded-lg border border-line">
        <div style={{ width: LABEL_W + width }} className="flex flex-col">
          <div className="sticky top-0 flex h-6 border-b border-line">
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface" style={{ width: LABEL_W }} />
            <div className="relative flex-1">
              {ticks.map((tk) => (
                <span key={tk.n} className={`absolute top-1 pl-1 font-mono text-[9px] whitespace-nowrap ${tk.month ? "font-semibold text-ink" : "text-ink-faint"}`} style={{ left: `${x(tk.n)}%` }}>
                  {tk.label}
                </span>
              ))}
            </div>
          </div>
          {rows.map((r) => {
            const statusHex = r.item ? ITEM_STATUS_COLOR[r.item.status] : hex;
            // Work periods that overlap go on lanes of their own; the marks get the last lane.
            const laneOf = new Map<string, number>();
            const laneEnds: number[] = [];
            for (const st of [...r.steps].filter((x) => x.startDateKey).sort((a, b) => a.startDateKey!.localeCompare(b.startDateKey!))) {
              const start = dayNum(st.startDateKey!);
              let lane = laneEnds.findIndex((end) => end < start);
              if (lane === -1) lane = laneEnds.length;
              laneEnds[lane] = dayNum(st.dateKey);
              laneOf.set(st.id, lane);
            }
            const marks = r.steps.some((x) => !x.startDateKey);
            const lanes = Math.max(1, laneEnds.length + (marks && laneEnds.length > 0 ? 1 : 0));
            const LANE = 18;
            const top = (lane: number) => 5 + lane * LANE;
            const markTop = laneEnds.length > 0 ? top(laneEnds.length) + LANE / 2 - 4 : 14;
            return (
              <div key={r.key} className="flex border-b border-line/50 last:border-b-0" style={{ height: Math.max(28, lanes * LANE + 10) }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 overflow-hidden border-r border-line bg-surface px-2" style={{ width: LABEL_W }} title={r.label}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusHex }} />
                  <span className={`truncate text-[10.5px] ${r.item ? "text-ink" : "font-mono font-semibold text-ink-soft"}`}>{r.label}</span>
                </div>
                <div className="relative flex-1">
                  {backdrop}
                  {r.item && (r.item.fromDateKey || r.item.toDateKey) && (
                    <div
                      aria-hidden="true"
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${x(dayNum(r.item.fromDateKey ?? r.item.toDateKey!))}%`,
                        width: `${Math.max(0.3, x(dayNum(r.item.toDateKey ?? r.item.fromDateKey!) + 1) - x(dayNum(r.item.fromDateKey ?? r.item.toDateKey!)))}%`,
                        background: tint(hex, 0.3),
                      }}
                    />
                  )}
                  {r.steps.map((s) => {
                    const tip = `${t.plan.stepKind[s.kind]}: ${s.label} ${s.startDateKey ? `${day.short(s.startDateKey)}〜` : ""}${day.short(s.dateKey)}${s.backupDateKey ? ` (${t.plan.backupOn(day.short(s.backupDateKey))})` : ""}`;
                    if (s.startDateKey) {
                      const l = x(dayNum(s.startDateKey));
                      return (
                        <div
                          key={s.id}
                          title={tip}
                          className="absolute z-[2] flex h-4 items-center overflow-hidden rounded-r px-1"
                          style={{ top: top(laneOf.get(s.id) ?? 0), left: `${l}%`, width: `${Math.max(0.4, x(dayNum(s.dateKey) + 1) - l)}%`, background: s.done ? tint(hex, 0.15) : tint(hex, 0.32), borderLeft: `2px solid ${hex}` }}
                        >
                          <span className="truncate font-mono text-[9px] text-ink">{s.label}</span>
                        </div>
                      );
                    }
                    return (
                      <span key={s.id} className="contents">
                        {s.backupDateKey && (
                          <>
                            <span
                              aria-hidden="true"
                              className="absolute z-[2] border-t border-dashed"
                              style={{ top: markTop + 4, left: `${x(dayNum(s.dateKey))}%`, width: `${x(dayNum(s.backupDateKey)) - x(dayNum(s.dateKey))}%`, borderColor: STEP_COLOR[s.kind] ?? hex }}
                            />
                            <span className="absolute z-[2] flex h-2 -translate-x-1/2 items-center opacity-40" style={{ top: markTop + 1, left: `${x(dayNum(s.backupDateKey))}%` }} title={`${tip}`}>
                              <StepMark kind={s.kind} hex={hex} size={8} />
                            </span>
                          </>
                        )}
                        <span className="absolute z-[3] flex h-2.5 -translate-x-1/2 items-center" style={{ top: markTop, left: `${x(dayNum(s.dateKey))}%` }} title={tip}>
                          <StepMark kind={s.kind} hex={hex} done={s.done} />
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] text-ink-faint">
        {STEP_KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1">
            <StepMark kind={k} hex={hex} size={8} />
            {t.plan.stepKind[k]}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** The ledger, section by section; a row opens to its steps. */
function Ledger({ plan, put, todayKey, onError, hex }: PlanProps & { hex: string }) {
  const { t } = useI18n();
  const groups = [...new Set(plan.items.map((i) => i.group))];
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemInput>({ group: groups[0] ?? "", title: "", size: 0, status: "PLANNED" });

  async function saveItem(item: ItemView, p: Partial<ItemInput>) {
    const res = await saveItemAction(plan.id, item.id, { ...item, ...p });
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    put(res.subPlan);
  }

  return (
    <Card title={t.plan.detailLedger}>
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const items = plan.items.filter((i) => i.group === group);
          const size = round1(items.reduce((a, i) => a + i.size, 0));
          return (
            <div key={group || "_"} className="flex flex-col gap-1">
              {group && (
                <p className="flex items-baseline gap-2 font-mono text-[10px] font-semibold tracking-wider text-ink-soft">
                  {group}
                  <span className="font-normal text-ink-faint">
                    {items.length} · {size}
                    {plan.unitLabel}
                  </span>
                </p>
              )}
              <ul className="flex flex-col">
                {items.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    plan={plan}
                    todayKey={todayKey}
                    hex={hex}
                    open={open === it.id}
                    onToggle={() => setOpen((o) => (o === it.id ? null : it.id))}
                    onSave={(p) => saveItem(it, p)}
                    put={put}
                    onError={onError}
                    onDelete={() => {
                      put({ ...plan, items: plan.items.filter((x) => x.id !== it.id), steps: plan.steps.filter((x) => x.itemId !== it.id) });
                      void deleteItemAction(it.id);
                    }}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const res = okOr(await saveItemAction(plan.id, null, draft), onError);
          if (!res) return;
          put(res.subPlan);
          setDraft({ ...draft, title: "", code: "", size: 0 });
        }}
        className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-alt/60 p-2"
      >
        <input value={draft.group ?? ""} onChange={(e) => setDraft({ ...draft, group: e.target.value })} placeholder="group" list={`groups-${plan.id}`} className={`${INPUT} w-28`} />
        <datalist id={`groups-${plan.id}`}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <input value={draft.code ?? ""} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder={t.plan.itemCode} className={`${INPUT} w-16`} />
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t.plan.itemTitle} className={`${INPUT} min-w-32 flex-1`} />
        <input
          type="number"
          value={draft.size || ""}
          onChange={(e) => setDraft({ ...draft, size: Number(e.target.value) || 0 })}
          placeholder={plan.unitLabel || t.plan.itemSize}
          className={`${INPUT} w-16 text-right`}
        />
        <button type="submit" disabled={!draft.title.trim()} className={PILL}>
          + {t.plan.addItem}
        </button>
      </form>
    </Card>
  );
}

function StatusPill({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const { t } = useI18n();
  const hex = ITEM_STATUS_COLOR[value] ?? NO_GOAL_HEX;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={t.plan.status.NOT_STARTED}
      className="w-24 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold focus:outline-none"
      style={{ borderColor: hex, color: hex, background: tint(hex, 0.1) }}
    >
      {ITEM_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t.plan.itemStatus[s]}
        </option>
      ))}
    </select>
  );
}

function ItemRow({
  item,
  plan,
  todayKey,
  hex,
  open,
  onToggle,
  onSave,
  onDelete,
  put,
  onError,
}: {
  item: ItemView;
  plan: SubPlanView;
  todayKey: string;
  hex: string;
  open: boolean;
  onToggle: () => void;
  onSave: (p: Partial<ItemInput>) => Promise<void>;
  onDelete: () => void;
  put: (p: SubPlanView) => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const day = useDay();
  const steps = plan.steps.filter((s) => s.itemId === item.id);
  const next = steps.find((s) => !s.done && s.kind !== "WORK" && s.dateKey >= todayKey) ?? steps.find((s) => !s.done && s.kind === "DUE");
  const dropped = item.status === "DROPPED";
  return (
    <li className={`border-b border-line/60 last:border-b-0 ${dropped ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        <StatusPill value={item.status} onChange={(status) => void onSave({ status }).catch(() => {})} />
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 basis-48 items-baseline gap-1.5 text-left">
          <span className={`text-[8px] text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
          {item.code && <span className="font-mono text-[10px] text-ink-faint">{item.code}</span>}
          <span className={`text-[12.5px] font-semibold ${item.status === "DONE" ? "text-ink-soft" : "text-ink"}`}>{item.title}</span>
          {item.kind && <span className="font-mono text-[10px] text-ink-faint">{item.kind}</span>}
          {item.size > 0 && (
            <span className="font-mono text-[10px] text-ink-soft">
              {item.size}
              {plan.unitLabel}
            </span>
          )}
        </button>
        {item.periodLabel && <span className="max-w-56 truncate rounded px-1.5 py-0.5 font-mono text-[9.5px] text-ink-soft" style={{ background: tint(hex, 0.12) }}>{item.periodLabel}</span>}
        {next && (
          <span className={`flex items-center gap-1 font-mono text-[9.5px] ${next.dateKey < todayKey ? "font-semibold text-accent" : "text-ink-soft"}`} title={next.label}>
            <StepMark kind={next.kind} hex={hex} size={8} />
            {day.short(next.dateKey)}
          </span>
        )}
      </div>
      {open && (
        <div className="mb-2 ml-1 flex flex-col gap-2 rounded-lg bg-surface-alt/50 p-2.5 sm:ml-7">
          <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
            <BlurText label={t.plan.itemRecord} value={item.record} onSave={(record) => onSave({ record })} />
            <BlurText label={t.plan.itemPeriod} value={item.periodLabel} onSave={(periodLabel) => onSave({ periodLabel })} />
            <div className="sm:col-span-2">
              <BlurText label={t.plan.itemNote} value={item.note} rows={2} onSave={(note) => onSave({ note })} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <DateInput value={item.fromDateKey} onChange={(fromDateKey) => void onSave({ fromDateKey }).catch(() => {})} label={t.plan.stepStart} />
              <span className="text-ink-faint">→</span>
              <DateInput value={item.toDateKey} onChange={(toDateKey) => void onSave({ toDateKey }).catch(() => {})} label={t.plan.stepDate} />
            </div>
          </div>
          <StepList plan={plan} itemId={item.id} steps={steps} todayKey={todayKey} hex={hex} put={put} onError={onError} />
          <button type="button" onClick={onDelete} className={`${PILL} w-fit`}>
            {t.plan.remove}
          </button>
        </div>
      )}
    </li>
  );
}

function StepList({
  plan,
  itemId,
  steps,
  todayKey,
  hex,
  put,
  onError,
}: {
  plan: SubPlanView;
  itemId: string | null;
  steps: StepView[];
  todayKey: string;
  hex: string;
  put: (p: SubPlanView) => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const blank = (): StepInput => ({ itemId, label: "", kind: "DUE", startDateKey: null, dateKey: todayKey, backupDateKey: null });
  const [draft, setDraft] = useState<StepInput>(blank);

  async function save(s: StepView, p: Partial<StepInput>) {
    const res = okOr(await saveStepAction(plan.id, s.id, { ...s, ...p }), onError);
    if (res) put(res.subPlan);
  }

  return (
    <div className="flex flex-col gap-1">
      <p className={LABEL}>{t.plan.detailTimeline}</p>
      {steps.map((s) => (
        <div key={s.id} className={`flex flex-wrap items-center gap-1.5 ${s.done ? "opacity-60" : ""}`}>
          <input type="checkbox" checked={s.done} onChange={(e) => void save(s, { done: e.target.checked })} aria-label={t.plan.done} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
          <StepMark kind={s.kind} hex={hex} size={9} />
          <select value={s.kind} onChange={(e) => void save(s, { kind: e.target.value })} className={`${INPUT} w-24`} aria-label={t.plan.stepLabel}>
            {STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.plan.stepKind[k]}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex-1 basis-40">
            <BlurText value={s.label} onSave={(label) => (label.trim() ? save(s, { label }) : undefined)} className={s.done ? "line-through" : ""} />
          </div>
          {s.kind === "WORK" && <DateInput value={s.startDateKey} onChange={(startDateKey) => void save(s, { startDateKey })} label={t.plan.stepStart} />}
          <DateInput value={s.dateKey} onChange={(v) => v && void save(s, { dateKey: v })} label={t.plan.stepDate} className={!s.done && s.kind === "DUE" && s.dateKey < todayKey ? "border-accent text-accent" : ""} />
          {s.kind === "DUE" && <DateInput value={s.backupDateKey} onChange={(backupDateKey) => void save(s, { backupDateKey })} label={t.plan.stepBackup} className="opacity-70" />}
          <button
            type="button"
            onClick={() => {
              put({ ...plan, steps: plan.steps.filter((x) => x.id !== s.id) });
              void deleteStepAction(s.id);
            }}
            aria-label={t.plan.remove}
            className="font-mono text-[11px] text-ink-faint hover:text-accent"
          >
            ×
          </button>
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const res = okOr(await saveStepAction(plan.id, null, draft), onError);
          if (!res) return;
          put(res.subPlan);
          setDraft(blank());
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={`${INPUT} w-24`}>
          {STEP_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.plan.stepKind[k]}
            </option>
          ))}
        </select>
        <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder={t.plan.stepLabel} className={`${INPUT} min-w-32 flex-1`} />
        {draft.kind === "WORK" && <DateInput value={draft.startDateKey ?? null} onChange={(startDateKey) => setDraft({ ...draft, startDateKey })} label={t.plan.stepStart} />}
        <input type="date" value={draft.dateKey} onChange={(e) => setDraft({ ...draft, dateKey: e.target.value })} className={INPUT} aria-label={t.plan.stepDate} />
        {draft.kind === "DUE" && <DateInput value={draft.backupDateKey ?? null} onChange={(backupDateKey) => setDraft({ ...draft, backupDateKey })} label={t.plan.stepBackup} />}
        <button type="submit" disabled={!draft.label.trim() || !draft.dateKey} className={PILL}>
          + {t.plan.addStep}
        </button>
      </form>
    </div>
  );
}

/** The week-by-week execution table; this week marked and in view, every cell editable. */
function WeekTable({ plan, put, todayKey, onError, hex }: PlanProps & { hex: string }) {
  const { t } = useI18n();
  const day = useDay();
  const current = plan.weeks.findIndex((w) => w.fromDateKey && w.toDateKey && w.fromDateKey <= todayKey && todayKey <= w.toDateKey);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    const box = row?.closest("[data-scroll]") as HTMLElement | null;
    if (row && box) box.scrollTop = Math.max(0, row.offsetTop - 40);
  }, []);
  if (plan.weeks.length === 0) return null;
  const cols = plan.weekColumns.length > 0 ? plan.weekColumns : plan.weeks[0].cells.map((_, i) => String(i + 1));
  return (
    <Card title={t.plan.detailWeeks}>
      <div data-scroll className="max-h-[36rem] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-left font-mono text-[9.5px] text-ink-faint">
              <th className="border-b border-line px-2 py-1.5 font-normal">{t.plan.detailPeriodCol}</th>
              {cols.map((c, i) => (
                <th key={i} className="border-b border-line px-2 py-1.5 font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.weeks.map((w, ri) => {
              const now = ri === current;
              return (
                <tr key={ri} ref={now ? rowRef : undefined} className="align-top" style={now ? { background: tint(hex, 0.1) } : undefined}>
                  <td className="border-b border-line/60 px-2 py-1.5 whitespace-nowrap">
                    <span className={`block font-mono text-[10.5px] font-semibold ${now ? "text-accent" : "text-ink"}`}>{w.label}</span>
                    {w.fromDateKey && (
                      <span className="block font-mono text-[9.5px] text-ink-faint">
                        {day.short(w.fromDateKey)}〜{w.toDateKey ? day.short(w.toDateKey) : ""}
                      </span>
                    )}
                  </td>
                  {cols.map((_, ci) => (
                    <td key={ci} className="min-w-36 border-b border-line/60 px-0.5 py-0.5">
                      <BlurText
                        value={w.cells[ci] ?? ""}
                        rows={2}
                        className="text-[11px]"
                        onSave={async (text) => {
                          const res = await saveWeekCellAction(plan.id, ri, ci, text);
                          if ("error" in res) {
                            onError(res.error);
                            throw new Error(res.error);
                          }
                          put(res.subPlan);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** This week in each detailed plan — for the records' week view. */
export function WeekInPlans({ ov, hexes, weekStart }: { ov: TabProps["ov"]; hexes: Map<string, string>; weekStart: string }) {
  const { t } = useI18n();
  const day = useDay();
  const end = shiftDateKey(weekStart, 6);
  const rows = ov.subPlans
    .map((p) => ({
      p,
      week: p.weeks.find((w) => w.fromDateKey && w.toDateKey && w.fromDateKey <= end && w.toDateKey >= weekStart) ?? null,
      steps: p.steps.filter((s) => s.kind !== "WORK" && s.dateKey >= weekStart && s.dateKey <= end),
    }))
    .filter((r) => r.week || r.steps.length > 0);
  if (rows.length === 0) return null;
  return (
    <Card title={t.plan.weekStepsHeading}>
      <div className="flex flex-col gap-3">
        {rows.map(({ p, week, steps }) => {
          const hex = p.goalId ? (hexes.get(p.goalId) ?? NO_GOAL_HEX) : NO_GOAL_HEX;
          return (
            <div key={p.id} className="flex flex-col gap-1.5 border-l-4 pl-2.5" style={{ borderColor: hex }}>
              <p className="text-[12px] font-bold text-ink">
                {p.title}
                {week && <span className="ml-2 font-mono text-[10px] font-normal text-ink-faint">{week.label}</span>}
              </p>
              {week && (
                <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[8rem_1fr]">
                  {week.cells.map((c, i) =>
                    c ? (
                      <div key={i} className="contents">
                        <dt className="font-mono text-[9.5px] text-ink-faint">{p.weekColumns[i] ?? ""}</dt>
                        <dd className="text-[11.5px] leading-relaxed text-ink">{c}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              )}
              {steps.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {steps.map((s) => (
                    <li key={s.id} className={`flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] ${s.done ? "opacity-50" : ""}`}>
                      <StepMark kind={s.kind} hex={hex} size={8} />
                      <span className="font-mono text-[9.5px] text-ink-soft">{day.short(s.dateKey)}</span>
                      {itemName(p, s.itemId) && <span className="font-semibold">{itemName(p, s.itemId)}</span>}
                      {s.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
