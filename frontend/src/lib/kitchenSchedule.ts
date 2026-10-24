import type { MealPreference } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasRoutine, minutesOfTime, toRoutine } from "@/lib/routine";
import { kitchenDay, kitchenMinutesOf, type KitchenDay, type Span } from "@/lib/kitchenTime";

/**
 * The days of a meal plan as the owner will live them, for the planner and
 * for the plan's warnings: the routine from the goals (sleep, work, the
 * commute), the standard week's goal blocks, and — for a day that has its
 * own plan on the calendar (GoalDayPlan) — that plan instead.
 */
export async function kitchenDays(ownerSub: string, dates: string[], pref: MealPreference): Promise<KitchenDay[]> {
  const [planRow, slots, dayPlans, goals] = await Promise.all([
    prisma.goalPlan.findUnique({ where: { ownerSub }, select: { routine: true } }),
    prisma.goalWeekSlot.findMany({ where: { ownerSub } }),
    prisma.goalDayPlan.findMany({ where: { ownerSub, dateKey: { in: dates } } }),
    prisma.goal.findMany({ where: { ownerSub }, select: { id: true, title: true } }),
  ]);
  const caps = kitchenMinutesOf(pref);
  const known = hasRoutine(planRow?.routine);
  const routine = toRoutine(planRow?.routine);
  const title = new Map(goals.map((g) => [g.id, g.title]));

  return dates.map((dateKey) => {
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    const busy: Span[] = [];
    const own = dayPlans.find((p) => p.dateKey === dateKey);
    const blocks = Array.isArray(own?.blocks) ? (own!.blocks as { start?: string; end?: string; title?: string; kind?: string }[]) : [];
    if (blocks.length > 0) {
      // The day's own plan already says what the day holds.
      for (const b of blocks) {
        if (!b.start || !b.end || b.kind === "SLEEP" || b.kind === "MEAL" || b.kind === "BREAK") continue;
        busy.push({ start: minutesOfTime(b.start), end: minutesOfTime(b.end), label: b.title ?? "" });
      }
    } else if (known) {
      const day = routine.days.find((d) => d.weekday === weekday)!;
      if (day.work) {
        const start = minutesOfTime(day.start);
        const end = minutesOfTime(day.end);
        busy.push({ start, end, label: day.office ? "仕事（出社）" : "仕事（在宅）" });
        if (day.office && day.commuteMinutes > 0) {
          busy.push({ start: start - day.commuteMinutes, end: start, label: "通勤" });
          busy.push({ start: end, end: end + day.commuteMinutes, label: "通勤" });
        }
      }
      for (const s of slots.filter((x) => x.weekday === weekday && !x.commute)) {
        busy.push({ start: minutesOfTime(s.startTime), end: minutesOfTime(s.endTime), label: s.label || (s.goalId ? (title.get(s.goalId) ?? "") : "") });
      }
    }
    const haveDay = known || blocks.length > 0;
    return kitchenDay({
      dateKey,
      capMinutes: caps[weekday],
      wake: haveDay ? minutesOfTime(routine.wake) : null,
      bed: haveDay ? minutesOfTime(routine.bed) : null,
      busy,
      breakfastAt: pref.breakfastMinutes,
      dinnerAt: pref.dinnerMinutes,
    });
  });
}
