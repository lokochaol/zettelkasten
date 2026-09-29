/**
 * Turns a body and a goal into a day's worth of nutrition targets.
 *
 * The point of this file is that the meal planner is briefed like a
 * dietitian rather than a calorie counter: a day that hits its kcal number
 * on white rice and oil is a day this app should not have proposed. So the
 * target is a set of nutrients — protein, fat, carbohydrate, fibre, salt —
 * and the generator is held to all of them at once.
 *
 * Sources for the numbers, so they can be checked rather than trusted:
 *   - Resting energy: Katch-McArdle (370 + 21.6 × lean mass) when a body
 *     composition scale has reported a body fat percentage, because with
 *     lean mass known it is the more accurate of the two — muscle is what
 *     burns, and two people of the same weight and height differ by
 *     hundreds of kcal at different compositions. Mifflin-St Jeor (1990)
 *     otherwise, which is the best of the weight-only equations.
 *   - Fibre and salt: 日本人の食事摂取基準（2020年版）, ages 18–64 —
 *     fibre 21g/day or more (men), 18g/day or more (women); salt under
 *     7.5g/day (men), under 6.5g/day (women). These are absolute daily
 *     figures in the standard, not proportions of intake.
 *   - Protein: 2.2 g per kg of LEAN mass when the composition is known,
 *     clamped 1.8–2.6 — the ISSN position stand's range for an athlete in
 *     an energy deficit, which is stated per kg of lean mass precisely
 *     because fat tissue has no protein requirement. Without a body fat
 *     figure it falls back to 1.6 g per kg of body weight (clamped
 *     1.2–2.2), the best available guess when lean mass is unknown.
 *   - Fat: 25% of energy, with a floor of 0.6 g/kg so a low-calorie day
 *     can't drop fat far enough to interfere with fat-soluble vitamins.
 *
 * Pure — no Prisma import — so the same function runs server-side and in
 * the settings screen's live preview.
 *
 * Not medical advice. These are population-level reference values; anyone
 * with a condition, pregnancy, or a prescribed diet needs a real dietitian,
 * and the UI says so next to the numbers.
 */

export type BiologicalSex = "MALE" | "FEMALE";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE";

export interface BodyInput {
  heightCm: number;
  weightKg: number;
  age: number;
  sex: BiologicalSex;
  activityLevel: ActivityLevel;
  /** Target kg change per week; negative loses. */
  weeklyKgDelta: number;
  /** Lean mass from the scale, when there is one. Everything that can be
   * computed from lean mass rather than body weight then is. */
  leanMassKg?: number | null;
  /** Apple's active energy for the day, when the phone has sent one. Used
   * in place of the activity multiplier, since a measurement beats a
   * lookup table. */
  measuredActiveEnergyKcal?: number | null;
}

export interface NutritionTargets {
  /** Resting energy — what the body burns doing nothing. */
  basalKcal: number;
  /** Everything burned in a day, resting plus movement. */
  maintenanceKcal: number;
  /** What to actually eat, after the goal's surplus or deficit and the
   * safety floor. */
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
  /** An upper limit, unlike the others. */
  saltMaxG: number;
  /** True when the goal's deficit was reduced to keep the day above the
   * floor — the UI surfaces this rather than silently planning something
   * different from what was asked. */
  deficitLimited: boolean;
  /** Whether maintenance came from a measurement or an estimate. */
  energyBasis: "measured" | "estimated";
  /** Which body the numbers were figured from. "lean" means a scale
   * reported a composition and the targets follow lean mass; "weight"
   * means they are the best that can be done from a weight alone. */
  bodyBasis: "lean" | "weight";
}

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
};

/** Energy in a kilogram of body tissue, the usual 7,700 kcal figure. */
const KCAL_PER_KG = 7700;
/** Nobody should be planning meals below this, whatever the goal says.
 * The floors the literature uses for unsupervised dieting. */
const ABSOLUTE_FLOOR_KCAL: Record<BiologicalSex, number> = { MALE: 1500, FEMALE: 1200 };

const round = (n: number) => Math.round(n);

export function basalMetabolicRate(
  input: Pick<BodyInput, "heightCm" | "weightKg" | "age" | "sex"> & { leanMassKg?: number | null },
): number {
  // Katch-McArdle, which needs no height, age or sex term: those three
  // exist in the other equations to guess at lean mass, and there is
  // nothing to guess at once it has been measured.
  if (typeof input.leanMassKg === "number" && input.leanMassKg > 0) return 370 + 21.6 * input.leanMassKg;
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return input.sex === "MALE" ? base + 5 : base - 161;
}

export function computeTargets(input: BodyInput): NutritionTargets {
  const basalKcal = basalMetabolicRate(input);

  // A measured active-energy figure is movement only (Apple excludes the
  // resting burn), so it adds to BMR. Without one, fall back to the
  // activity multiplier.
  const measured = input.measuredActiveEnergyKcal;
  const hasMeasurement = typeof measured === "number" && measured > 0;
  const maintenanceKcal = hasMeasurement ? basalKcal + measured : basalKcal * ACTIVITY_FACTOR[input.activityLevel];

  const requestedDelta = (input.weeklyKgDelta * KCAL_PER_KG) / 7;
  // Never plan a day below resting burn or below the absolute floor: the
  // fastest way for a "healthy eating" app to do harm is to honour an
  // aggressive goal literally.
  const floor = Math.max(basalKcal, ABSOLUTE_FLOOR_KCAL[input.sex]);
  const unclamped = maintenanceKcal + requestedDelta;
  const targetKcal = Math.max(unclamped, Math.min(floor, maintenanceKcal));
  const deficitLimited = targetKcal > unclamped + 1;

  // Protein first — it's the one that protects muscle while losing
  // weight, so the other two are fitted around it rather than the
  // reverse. Per kg of lean mass where that is known: fat tissue doesn't
  // need feeding, and scaling protein by total weight quietly
  // under-feeds a lean body and over-feeds a heavier one.
  const lean = typeof input.leanMassKg === "number" && input.leanMassKg > 0 ? input.leanMassKg : null;
  const proteinG =
    lean === null
      ? clamp(1.6 * input.weightKg, 1.2 * input.weightKg, 2.2 * input.weightKg)
      : clamp(2.2 * lean, 1.8 * lean, 2.6 * lean);
  const fatG = Math.max((targetKcal * 0.25) / 9, 0.6 * input.weightKg);
  const carbKcal = targetKcal - proteinG * 4 - fatG * 9;
  const carbG = Math.max(carbKcal / 4, 0);

  return {
    basalKcal: round(basalKcal),
    maintenanceKcal: round(maintenanceKcal),
    targetKcal: round(targetKcal),
    proteinG: round(proteinG),
    fatG: round(fatG),
    carbG: round(carbG),
    fiberG: input.sex === "MALE" ? 21 : 18,
    saltMaxG: input.sex === "MALE" ? 7.5 : 6.5,
    deficitLimited,
    energyBasis: hasMeasurement ? "measured" : "estimated",
    bodyBasis: lean === null ? "weight" : "lean",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Age in whole years from a birth year — the profile only stores the year,
 * which is precise enough for an equation whose age term is 5 kcal a year. */
export function ageFromBirthYear(birthYear: number, today = new Date()): number {
  return today.getUTCFullYear() - birthYear;
}
