/**
 * Reading a body composition scale, and turning it into a goal.
 *
 * Pure — no Prisma — so the arithmetic can be tested directly.
 *
 * Two things shape everything here. First, a daily scale reading is
 * mostly noise: a kilogram of water moves the number more than a week of
 * eating well, and body fat percentage on a consumer impedance scale
 * moves with hydration too. So nothing is judged on a single day — every
 * figure below is an average over a window, and change is one window
 * against another.
 *
 * Second, "athletic" is a composition, not a weight. The same 70 kg is
 * two different bodies at 12% and 22% fat, and only one of them is what
 * anyone means by functional. So the goal is a body fat percentage, the
 * lean mass is what gets protected, and the rate of change is capped at
 * what the body can actually do — faster than that and what comes off is
 * muscle.
 *
 * Reference ranges are the ACE/ACSM descriptive bands, widely used and
 * easy to check. Not medical advice: they are population descriptions,
 * and anyone with a condition or an eating disorder history needs a real
 * clinician rather than an app.
 */

export type BiologicalSex = "MALE" | "FEMALE";

export interface Measurement {
  dateKey: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  leanBodyMassKg: number | null;
}

export interface Composition {
  weightKg: number;
  bodyFatPercent: number;
  fatMassKg: number;
  leanMassKg: number;
}

/** Lean mass from what the scale sent. A directly reported figure wins:
 * some scales measure it, and re-deriving it from a rounded percentage
 * only adds error. */
export function compositionOf(m: Measurement): Composition | null {
  if (m.weightKg === null || m.weightKg <= 0) return null;
  if (m.bodyFatPercent === null || m.bodyFatPercent <= 0 || m.bodyFatPercent >= 70) {
    // Without a percentage there is no composition — a weight alone is
    // just a weight, and pretending otherwise is the guessing this file
    // exists to stop.
    return null;
  }
  const fatMassKg = (m.weightKg * m.bodyFatPercent) / 100;
  const leanMassKg = m.leanBodyMassKg ?? m.weightKg - fatMassKg;
  return { weightKg: m.weightKg, bodyFatPercent: m.bodyFatPercent, fatMassKg, leanMassKg };
}

export interface Window {
  /** How many days actually carried a reading. A week's average from two
   * days is worth knowing about. */
  days: number;
  weightKg: number | null;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  fatMassKg: number | null;
}

/** Averages over the readings given. The caller decides which days those
 * are; this only refuses to invent the ones that aren't there. */
export function averageOf(measurements: Measurement[]): Window {
  const compositions = measurements.map(compositionOf).filter((c): c is Composition => c !== null);
  const weights = measurements.map((m) => m.weightKg).filter((w): w is number => w !== null && w > 0);
  const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
  return {
    days: Math.max(weights.length, compositions.length),
    weightKg: mean(weights),
    bodyFatPercent: mean(compositions.map((c) => c.bodyFatPercent)),
    leanMassKg: mean(compositions.map((c) => c.leanMassKg)),
    fatMassKg: mean(compositions.map((c) => c.fatMassKg)),
  };
}

export interface Trend {
  recent: Window;
  previous: Window;
  /** Change per week, positive for gain. Null when either window is empty
   * — "no change" and "no data" are different answers. */
  weightKgPerWeek: number | null;
  fatMassKgPerWeek: number | null;
  leanMassKgPerWeek: number | null;
}

/**
 * Two windows, compared.
 *
 * Split into fat and lean rather than reported as one weight change,
 * because those are opposite outcomes wearing the same number: losing a
 * kilo of fat and losing a kilo of muscle both read as "−1 kg".
 */
export function trendOf(measurements: Measurement[], windowDays = 7): Trend {
  const sorted = [...measurements].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const recentDays = sorted.slice(-windowDays);
  const previousDays = sorted.slice(-windowDays * 2, -windowDays);
  const recent = averageOf(recentDays);
  const previous = averageOf(previousDays);

  // The windows are a week apart by construction, so the difference is
  // already a weekly rate.
  const perWeek = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    recent,
    previous,
    weightKgPerWeek: perWeek(recent.weightKg, previous.weightKg),
    fatMassKgPerWeek: perWeek(recent.fatMassKg, previous.fatMassKg),
    leanMassKgPerWeek: perWeek(recent.leanMassKg, previous.leanMassKg),
  };
}

export type Band = "essential" | "athletic" | "fitness" | "average" | "high";

/** The ACE/ACSM descriptive bands. Lower bounds, ordered. */
const BANDS: Record<BiologicalSex, { band: Band; from: number }[]> = {
  MALE: [
    { band: "essential", from: 0 },
    { band: "athletic", from: 6 },
    { band: "fitness", from: 14 },
    { band: "average", from: 18 },
    { band: "high", from: 25 },
  ],
  FEMALE: [
    { band: "essential", from: 0 },
    { band: "athletic", from: 14 },
    { band: "fitness", from: 21 },
    { band: "average", from: 25 },
    { band: "high", from: 32 },
  ],
};

export function bandOf(bodyFatPercent: number, sex: BiologicalSex): Band {
  const bands = BANDS[sex];
  let current: Band = "essential";
  for (const entry of bands) if (bodyFatPercent >= entry.from) current = entry.band;
  return current;
}

/**
 * A sustainable athletic target, in the upper half of the athlete band.
 *
 * Deliberately not the bottom of it. The lowest end of the athletic range
 * is competition-day conditioning, held for days rather than lived in,
 * and aiming a year-round diet at it is how people end up with wrecked
 * hormones and no training capacity. "Functional" means the part of the
 * range a body performs in.
 */
export function suggestedTarget(sex: BiologicalSex): { from: number; to: number } {
  return sex === "MALE" ? { from: 10, to: 14 } : { from: 18, to: 22 };
}

/**
 * The target to work to when the owner hasn't named one.
 *
 * Not a fixed number: the sustainable athletic range is a range, and
 * which end of it applies depends on where the body currently is.
 * Carrying more fat than the range, the first target is its upper edge —
 * a milestone that can actually be reached, rather than the far end of
 * the range with a year of dieting in between. Already inside it, the
 * target is where you are: the job is holding it and training, not
 * chasing a smaller number. Leaner than the range, the target is its
 * lower edge, which reads as "stop cutting" — and that is the honest
 * answer, because below the range is not more athletic, it's less.
 */
export function autoTargetFor(currentBodyFatPercent: number, sex: BiologicalSex): number {
  const { from, to } = suggestedTarget(sex);
  return Math.min(Math.max(currentBodyFatPercent, from), to);
}

export type Direction = "lose_fat" | "gain_lean" | "hold";

export interface CompositionPlan {
  direction: Direction;
  /** The weekly weight change to aim for, negative to lose. Capped at
   * what the body can do without taking the muscle with it. */
  weeklyKgDelta: number;
  /** Weeks to the target at that rate, when there is a gap to close. */
  weeksToTarget: number | null;
  /** Fat to lose (positive) or lean to gain, in kg. */
  gapKg: number;
}

/** Fat loss faster than this costs lean mass; the figure the literature
 * keeps arriving at is 0.5–1% of body weight per week, and the lower half
 * of that is what holds up for someone who also trains. */
const MAX_LOSS_RATIO = 0.0075;
/** Lean tissue is built slowly even when everything is right. A quarter
 * of a percent of body weight per week is an optimistic month for someone
 * past their first year of training. */
const MAX_GAIN_RATIO = 0.0025;
/** Inside this much of the target, the job is holding, not chasing. */
const HOLD_BAND = 1;

/**
 * What to do about the gap between here and the target.
 *
 * Above the target, the answer is a deficit — but a slow one, because the
 * goal is composition, not weight: dropping 1 kg a week and losing half
 * of it from muscle moves the percentage the wrong way.
 *
 * Below the target, the answer is not to get fatter on purpose. It is a
 * small surplus aimed at lean mass, which raises weight and, done slowly
 * at high protein, leaves the percentage roughly where it is.
 */
export function planFor(current: Composition, targetBodyFatPercent: number): CompositionPlan {
  const gap = current.bodyFatPercent - targetBodyFatPercent;
  if (Math.abs(gap) <= HOLD_BAND) {
    return { direction: "hold", weeklyKgDelta: 0, weeksToTarget: null, gapKg: 0 };
  }

  if (gap > 0) {
    // Lean mass is assumed held, so the fat to lose is the whole gap.
    const targetWeight = current.leanMassKg / (1 - targetBodyFatPercent / 100);
    const gapKg = current.weightKg - targetWeight;
    // Never faster than the cap, and never so fast that a small gap is
    // closed in a week: the last kilo is the one people crash-diet, and
    // that is the kilo that comes off lean.
    // Rounded before the weeks are counted, so the two figures shown
    // agree with each other: a rate of 0.5 and a finish of 16 weeks for
    // an 8.2 kg gap is arithmetic the reader can't reproduce.
    const weeklyKgDelta = round1(-Math.min(current.weightKg * MAX_LOSS_RATIO, gapKg / 4));
    return {
      direction: "lose_fat",
      weeklyKgDelta,
      weeksToTarget: weeklyKgDelta === 0 ? null : Math.ceil(round1(gapKg) / -weeklyKgDelta),
      gapKg: round1(gapKg),
    };
  }

  // Leaner than the target already. There is no fat percentage to close
  // — adding lean mass moves it further down, not up — so this has no
  // finish line: it is a slow build at high protein, and "weeks to
  // target" would be a number invented to fill a field.
  return {
    direction: "gain_lean",
    weeklyKgDelta: round1(current.weightKg * MAX_GAIN_RATIO),
    weeksToTarget: null,
    gapKg: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
