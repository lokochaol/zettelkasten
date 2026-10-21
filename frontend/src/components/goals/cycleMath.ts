import type { CycleView, PlanOverview } from "@/lib/goalPlan";

/* Where today falls in a cycle. Pure, for the browser. */

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function currentCycle(ov: Pick<PlanOverview, "cycles" | "currentCycleId">): CycleView | null {
  return ov.cycles.find((c) => c.id === ov.currentCycleId) ?? null;
}

export interface CyclePosition {
  /** 1-based; 0 before it starts, totalWeeks + 1 after it ends. */
  week: number;
  totalWeeks: number;
  /** Index into cycle.phases, -1 when outside them all. */
  phaseIndex: number;
  /** 0–1 through the whole cycle. */
  progress: number;
}

export function cyclePosition(cycle: CycleView, todayKey: string): CyclePosition {
  const total = daysBetween(cycle.fromDateKey, cycle.toDateKey) + 1;
  const totalWeeks = Math.max(1, Math.ceil(total / 7));
  const into = daysBetween(cycle.fromDateKey, todayKey);
  const week = into < 0 ? 0 : into >= total ? totalWeeks + 1 : Math.floor(into / 7) + 1;
  return {
    week,
    totalWeeks,
    phaseIndex: cycle.phases.findIndex((p) => p.fromDateKey <= todayKey && p.toDateKey >= todayKey),
    progress: Math.min(1, Math.max(0, (into + 1) / total)),
  };
}
