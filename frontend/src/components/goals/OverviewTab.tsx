"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addMilestoneAction,
  createGoalAction,
  deleteGoalAction,
  deleteMilestoneAction,
  reorderGoalsAction,
  updateMilestoneAction,
  type GoalView,
  type MilestoneView,
} from "@/app/goals/actions";
import { savePlanAction } from "@/app/goals/planActions";
import { GoalCard } from "@/components/GoalCard";
import { GoalGantt } from "@/components/goals/GoalGantt";
import { BlurText, Card, DateInput, LABEL, PILL, PRIMARY, okOr, type TabProps } from "@/components/goals/ui";
import { currentCycle } from "@/components/goals/cycleMath";
import { tint } from "@/lib/goalColors";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 全体 — the plan from furthest out: why (目指す姿), the ground it stands on
 * (前提), the roadmap of every goal's phases, and the goals themselves.
 */
export function OverviewTab(props: TabProps) {
  const { ov, setOv, todayKey, active, hexes, generation, onError } = props;
  const { t } = useI18n();
  const [selected, setSelected] = useState<{ goalId: string; milestoneId: string } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const archived = ov.goals.filter((g) => g.status === "ARCHIVED");
  const cycle = currentCycle(ov);

  const setGoals = (goals: GoalView[]) => setOv((o) => ({ ...o, goals }));
  const replaceGoal = (goal: GoalView) => setOv((o) => ({ ...o, goals: o.goals.map((g) => (g.id === goal.id ? goal : g)) }));

  async function savePlanField(field: "vision" | "baseline", value: string) {
    const res = await savePlanAction({ [field]: value });
    if ("error" in res) throw new Error(res.error);
    setOv((o) => ({ ...o, plan: res.plan }));
  }

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    onError(null);
    const res = okOr(await createGoalAction(title, todayKey), onError);
    if (!res) return;
    setNewTitle("");
    setOv((o) => ({ ...o, goals: [...o.goals.filter((g) => g.status === "ACTIVE"), res.goal, ...o.goals.filter((g) => g.status === "ARCHIVED")] }));
  }

  function moveGoal(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= active.length) return;
    const next = [...active];
    [next[index], next[to]] = [next[to], next[index]];
    setGoals([...next, ...archived]);
    void reorderGoalsAction(next.map((g) => g.id));
  }

  function changeGoal(goal: GoalView) {
    const before = ov.goals.find((g) => g.id === goal.id);
    if (before && before.status !== goal.status) {
      const rest = ov.goals.filter((g) => g.id !== goal.id);
      setGoals([...rest.filter((g) => g.status === "ACTIVE"), goal, ...rest.filter((g) => g.status === "ARCHIVED")]);
    } else replaceGoal(goal);
  }

  async function addPhase(goalId: string) {
    const goal = ov.goals.find((g) => g.id === goalId);
    if (!goal) return;
    // A new phase starts where the last one ended, so it lands on the chart.
    const lastDue = goal.milestones.map((m) => m.dueDateKey).filter((d): d is string => !!d).sort().at(-1) ?? todayKey;
    const res = okOr(await addMilestoneAction(goalId, t.plan.phaseLabel, null, { startDateKey: lastDue }), onError);
    if (!res) return;
    replaceGoal({ ...goal, milestones: [...goal.milestones, res.milestone] });
    setSelected({ goalId, milestoneId: res.milestone.id });
  }

  const selGoal = selected ? ov.goals.find((g) => g.id === selected.goalId) : undefined;
  const selPhase = selGoal?.milestones.find((m) => m.id === selected?.milestoneId);

  const renderGoal = (goal: GoalView, i: number, list: GoalView[]) => (
    <GoalCard
      key={`${goal.id}:${generation}`}
      goal={goal}
      hex={hexes.get(goal.id) ?? "#94a3b8"}
      todayKey={todayKey}
      isFirst={i === 0}
      isLast={i === list.length - 1}
      onChange={changeGoal}
      onMove={(d) => moveGoal(i, d)}
      onDelete={() => {
        setGoals(ov.goals.filter((g) => g.id !== goal.id));
        void deleteGoalAction(goal.id);
      }}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {active.length === 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-accent/50 bg-accent/5 p-5">
          <h2 className="text-[16px] font-bold text-ink">{t.plan.startHeading}</h2>
          <p className="text-[12px] leading-relaxed text-ink-soft">{t.plan.startIntro}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => props.openAdvisor(t.plan.startPrompt)} className={`${PRIMARY} flex items-center gap-1.5 px-4 py-2`}>
              <span aria-hidden="true">✦</span>
              {t.plan.startChat}
            </button>
            <button type="button" onClick={props.openImport} className={`${PILL} px-4 py-1.5`}>
              {t.plan.startImport}
            </button>
          </div>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t.plan.visionHeading}>
          <BlurText key={`v:${generation}`} value={ov.plan.vision} rows={3} placeholder={t.plan.visionEmpty} onSave={(v) => savePlanField("vision", v)} />
        </Card>
        <Card title={t.plan.baselineHeading}>
          <BlurText key={`b:${generation}`} value={ov.plan.baseline} rows={3} onSave={(v) => savePlanField("baseline", v)} />
        </Card>
      </div>

      {(active.length > 0 || ov.events.length > 0) && (
      <Card title={t.plan.roadmapHeading}>
        <GoalGantt
          goals={active}
          hexes={hexes}
          events={ov.events}
          cycle={cycle}
          todayKey={todayKey}
          selectedId={selected?.milestoneId ?? null}
          onSelect={(goalId, milestoneId) => setSelected((s) => (s?.milestoneId === milestoneId ? null : { goalId, milestoneId }))}
          onAddPhase={(goalId) => void addPhase(goalId)}
        />
        {selGoal && selPhase && (
          <PhaseEditor
            key={selPhase.id}
            goal={selGoal}
            phase={selPhase}
            hex={hexes.get(selGoal.id) ?? "#94a3b8"}
            onClose={() => setSelected(null)}
            onSaved={(m) => replaceGoal({ ...selGoal, milestones: selGoal.milestones.map((x) => (x.id === m.id ? m : x)) })}
            onDeleted={() => {
              replaceGoal({ ...selGoal, milestones: selGoal.milestones.filter((x) => x.id !== selPhase.id) });
              setSelected(null);
            }}
            onError={onError}
          />
        )}
      </Card>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.plan.goalsHeading}</h2>
        {active.length === 0 && <p className="text-[12px] leading-relaxed text-ink-soft">{t.goals.empty}</p>}
        {active.map(renderGoal)}
        <form onSubmit={addGoal} className="flex items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t.plan.newGoalPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          />
          <button type="submit" disabled={!newTitle.trim()} className={`${PRIMARY} py-2`}>
            {t.plan.newGoal}
          </button>
        </form>
        {archived.length > 0 && (
          <details className="flex flex-col gap-3">
            <summary className="cursor-pointer font-mono text-[10px] tracking-wider text-ink-soft">{t.plan.archivedHeading(archived.length)}</summary>
            <div className="mt-3 flex flex-col gap-3">{archived.map(renderGoal)}</div>
          </details>
        )}
      </div>
    </div>
  );
}

/** The phase picked on the chart, edited in place under it. */
function PhaseEditor({
  goal,
  phase,
  hex,
  onClose,
  onSaved,
  onDeleted,
  onError,
}: {
  goal: GoalView;
  phase: MilestoneView;
  hex: string;
  onClose: () => void;
  onSaved: (m: MilestoneView) => void;
  onDeleted: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), []);

  async function patch(p: Parameters<typeof updateMilestoneAction>[1]) {
    const res = okOr(await updateMilestoneAction(phase.id, p), onError);
    if (res) onSaved(res.milestone);
    else throw new Error("save failed");
  }

  return (
    <div ref={box} className="flex scroll-mb-4 flex-col gap-2 rounded-lg border p-3" style={{ borderColor: tint(hex, 0.6), background: tint(hex, 0.06) }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-3 w-1 rounded-full" style={{ background: hex }} />
        <span className="font-mono text-[10px] text-ink-soft">{goal.title}</span>
        <span className={LABEL}>/ {t.plan.editPhaseHeading}</span>
        <button type="button" onClick={onClose} aria-label={t.plan.close} className="ml-auto font-mono text-[12px] text-ink-faint hover:text-accent">
          ×
        </button>
      </div>
      <BlurText label={t.plan.phaseLabel} value={phase.label} onSave={(v) => (v.trim() ? patch({ label: v }) : undefined)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.phaseStart}</span>
          <DateInput value={phase.startDateKey} onChange={(v) => void patch({ startDateKey: v }).catch(() => {})} label={t.plan.phaseStart} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={LABEL}>{t.plan.phaseDue}</span>
          <DateInput value={phase.dueDateKey} onChange={(v) => void patch({ dueDateKey: v }).catch(() => {})} label={t.plan.phaseDue} />
        </label>
        <label className="flex items-center gap-1.5 pb-1 font-mono text-[10.5px] text-ink-soft">
          <input type="checkbox" checked={phase.done} onChange={(e) => void patch({ done: e.target.checked }).catch(() => {})} className="h-4 w-4 accent-[var(--color-accent)]" />
          {t.plan.phaseDone}
        </label>
        <button
          type="button"
          onClick={() => {
            onDeleted();
            void deleteMilestoneAction(phase.id);
          }}
          className={`${PILL} ml-auto`}
        >
          {t.plan.remove}
        </button>
      </div>
      <BlurText label={t.plan.phaseCondition} value={phase.condition} rows={2} onSave={(v) => patch({ condition: v })} />
      <button
        type="button"
        onClick={() => document.getElementById(`phase-${phase.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
        className="w-fit font-mono text-[10px] text-ink-faint hover:text-accent"
      >
        ↓ {goal.title}
      </button>
    </div>
  );
}
