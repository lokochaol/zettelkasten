/**
 * The day's fixed frame — when the owner sleeps, which days they work,
 * from when to when, whether they go in and how long the trip is. A day's
 * plan (src/lib/dayPlan.ts) is built around it. Pure, for the browser too.
 */

export interface RoutineDay {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  work: boolean;
  start: string;
  end: string;
  /** Goes in (rather than working from home). */
  office: boolean;
  /** One way. */
  commuteMinutes: number;
}

export interface Routine {
  /** "HH:MM" — the day's plan puts sleep from bed to wake. */
  bed: string;
  wake: string;
  days: RoutineDay[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_ROUTINE: Routine = {
  bed: "23:00",
  wake: "07:00",
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    work: weekday >= 1 && weekday <= 5,
    start: "09:00",
    end: "18:00",
    office: false,
    commuteMinutes: 0,
  })),
};

/** A routine read from storage or the browser, checked; anything missing comes from the default. */
export function toRoutine(value: unknown): Routine {
  const r = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const time = (v: unknown, d: string) => (typeof v === "string" && TIME.test(v) ? v : d);
  const days = DEFAULT_ROUTINE.days.map((d) => {
    const found = (Array.isArray(r.days) ? r.days : []).find((x) => (x as RoutineDay | null)?.weekday === d.weekday) as Partial<RoutineDay> | undefined;
    if (!found) return d;
    const minutes = Number(found.commuteMinutes);
    return {
      weekday: d.weekday,
      work: found.work === true,
      start: time(found.start, d.start),
      end: time(found.end, d.end),
      office: found.office === true,
      commuteMinutes: Number.isFinite(minutes) && minutes >= 0 && minutes <= 300 ? Math.round(minutes) : 0,
    };
  });
  return { bed: time(r.bed, DEFAULT_ROUTINE.bed), wake: time(r.wake, DEFAULT_ROUTINE.wake), days };
}

/** Whether a routine was ever set (an empty one is the default). */
export const hasRoutine = (value: unknown) => !!value && typeof value === "object" && Object.keys(value as object).length > 0;

export const minutesOfTime = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const timeOfMinutes = (m: number) => {
  const c = Math.max(0, Math.min(1440, Math.round(m)));
  return c === 1440 ? "24:00" : `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
};

/** Hours of sleep the routine gives. */
export function sleepHours(r: Routine): number {
  const bed = minutesOfTime(r.bed);
  const wake = minutesOfTime(r.wake);
  return Math.round(((wake - bed + 1440) % 1440) / 6) / 10;
}
