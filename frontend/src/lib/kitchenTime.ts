/**
 * When the owner can actually stand in the kitchen, day by day — the two
 * things a meal plan has to respect besides nutrition and money:
 *
 *   - how many minutes they're willing to cook on each weekday (their own
 *     setting; 0 is a day they don't cook), and
 *   - how much of the day is actually free: after sleep, work and the
 *     commute (the goals' routine), the standard week's goal blocks, and
 *     the day's own plan when there is one.
 *
 * Pure: the server gathers the day, this turns it into free windows and
 * the plain-language line the planner reads, and into the warnings a plan
 * is checked against.
 */

export interface Span {
  /** Minutes from midnight; end may be 1440. */
  start: number;
  end: number;
  label: string;
}

export interface KitchenDay {
  dateKey: string;
  weekday: number;
  /** The owner's own limit for the day. */
  capMinutes: number;
  /** What fills the day (sleep excluded), in order. */
  busy: Span[];
  /** Free stretches of 15 minutes or more between waking and bed. */
  free: Span[];
  /** Free minutes in the two hours before each meal (null when the routine isn't known). */
  beforeBreakfast: number | null;
  beforeDinner: number | null;
  /** Whether the routine (sleep, work) was known; without it only the cap is. */
  known: boolean;
}

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];
export const DEFAULT_WEEKEND_MINUTES = 90;

/** The minutes per weekday, Sunday first; unset days come from the old single weekday setting. */
export function kitchenMinutesOf(pref: { kitchenMinutes: unknown; weekdayCookMinutes: number }): number[] {
  const stored = Array.isArray(pref.kitchenMinutes) ? pref.kitchenMinutes : [];
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const v = Number(stored[d]);
    if (stored.length === 7 && Number.isFinite(v) && v >= 0) return Math.min(300, Math.round(v));
    return d === 0 || d === 6 ? DEFAULT_WEEKEND_MINUTES : pref.weekdayCookMinutes;
  });
}

export function cleanKitchenMinutes(value: unknown): number[] {
  const arr = Array.isArray(value) ? value : [];
  if (arr.length !== 7) throw new Error("kitchen minutes must have 7 days");
  return arr.map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 300) throw new Error("kitchen minutes out of range");
    return n;
  });
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Free time from waking to bed, outside everything busy. */
export function freeWindows(wake: number, bed: number, busy: Span[], min = 15): Span[] {
  const end = bed > wake ? bed : 1440;
  const taken = merge(busy.map((b) => ({ ...b, start: Math.max(b.start, wake), end: Math.min(b.end, end) })));
  const out: Span[] = [];
  let at = wake;
  for (const b of taken) {
    if (b.start - at >= min) out.push({ start: at, end: b.start, label: "" });
    at = Math.max(at, b.end);
  }
  if (end - at >= min) out.push({ start: at, end, label: "" });
  return out;
}

const overlap = (spans: Span[], from: number, to: number) => spans.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0);

export function kitchenDay(input: {
  dateKey: string;
  capMinutes: number;
  /** Null when the owner hasn't set a routine. */
  wake: number | null;
  bed: number | null;
  busy: Span[];
  breakfastAt: number;
  dinnerAt: number;
}): KitchenDay {
  const weekday = new Date(`${input.dateKey}T00:00:00Z`).getUTCDay();
  const busy = [...input.busy].sort((a, b) => a.start - b.start);
  if (input.wake === null || input.bed === null) {
    return { dateKey: input.dateKey, weekday, capMinutes: input.capMinutes, busy, free: [], beforeBreakfast: null, beforeDinner: null, known: false };
  }
  const free = freeWindows(input.wake, input.bed, busy);
  return {
    dateKey: input.dateKey,
    weekday,
    capMinutes: input.capMinutes,
    busy,
    free,
    beforeBreakfast: overlap(free, input.breakfastAt - 120, input.breakfastAt),
    beforeDinner: overlap(free, input.dinnerAt - 120, input.dinnerAt),
    known: true,
  };
}

/** How the planner reads one day. */
export function kitchenLine(d: KitchenDay): string {
  const head = `${d.dateKey}(${DAY_NAMES[d.weekday]}) 台所の上限 ${d.capMinutes === 0 ? "0分（立たない日）" : `${d.capMinutes}分`}`;
  if (!d.known) return head;
  const busy = d.busy.length ? d.busy.map((b) => `${hhmm(b.start)}〜${hhmm(b.end)} ${b.label}`).join("、") : "予定なし";
  const free = d.free.length ? d.free.map((f) => `${hhmm(f.start)}〜${hhmm(f.end)}（${f.end - f.start}分）`).join("、") : "なし";
  return `${head} ／ 予定: ${busy} ／ 空き: ${free} ／ 朝食前2時間の空き${d.beforeBreakfast}分・夕食前2時間の空き${d.beforeDinner}分`;
}

/**
 * What a plan asks of the kitchen against what the days allow: cooking on a
 * day set to 0, a day's cooking over its limit, and cooking that doesn't fit
 * in the free time before the meal it's for.
 */
export function kitchenWarnings(
  meals: { dateKey: string; slot: "BREAKFAST" | "LUNCH" | "DINNER"; kind: string; prepMinutes: number; title: string }[],
  days: KitchenDay[],
): string[] {
  const out: string[] = [];
  for (const d of days) {
    const mine = meals.filter((m) => m.dateKey === d.dateKey);
    if (mine.length === 0) continue;
    const total = mine.reduce((a, m) => a + m.prepMinutes, 0);
    const cooks = mine.filter((m) => m.kind === "COOK");
    const label = `${d.dateKey.slice(5).replace("-", "/")}(${DAY_NAMES[d.weekday]})`;
    if (d.capMinutes === 0 && cooks.length > 0) {
      out.push(`${label}: 台所に立たない日に調理（${cooks.map((m) => m.title).join("、")}）`);
    } else if (total > d.capMinutes && cooks.length > 0) {
      out.push(`${label}: 調理 ${total}分（この曜日の上限 ${d.capMinutes}分 超過）`);
    }
    if (!d.known) continue;
    const dinnerPrep = mine.filter((m) => m.slot === "DINNER" && m.kind === "COOK").reduce((a, m) => a + m.prepMinutes, 0);
    if (d.beforeDinner !== null && dinnerPrep > 0 && dinnerPrep > d.beforeDinner + 10) {
      out.push(`${label}: 夕食の調理 ${dinnerPrep}分に対し、夕食前の空きは ${d.beforeDinner}分`);
    }
    const breakfastPrep = mine.filter((m) => m.slot === "BREAKFAST" && m.kind === "COOK").reduce((a, m) => a + m.prepMinutes, 0);
    if (d.beforeBreakfast !== null && breakfastPrep > 0 && breakfastPrep > d.beforeBreakfast + 5) {
      out.push(`${label}: 朝食の調理 ${breakfastPrep}分に対し、朝食前の空きは ${d.beforeBreakfast}分`);
    }
  }
  return out;
}
