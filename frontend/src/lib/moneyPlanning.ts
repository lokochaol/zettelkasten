/**
 * Working out what a month may spend, and what a year will look like.
 *
 * Pure — no Prisma — so the arithmetic that decides a budget can be read
 * and tested on its own. Nothing here asks a model anything: how much is
 * left after the rent and the instalments is subtraction, and subtraction
 * should never be delegated to something that hallucinates.
 */

export interface CommitmentLike {
  name: string;
  monthlyYen: number;
  /** Inclusive "YYYY-MM" bounds; a null end means ongoing. */
  fromMonth: string;
  toMonth: string | null;
}

export interface GoalLike {
  name: string;
  targetYen: number;
  targetMonth: string;
  savedYen: number;
}

/** Months from one "YYYY-MM" to another, negative if it's behind. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isActive(c: CommitmentLike, month: string): boolean {
  return monthsBetween(c.fromMonth, month) >= 0 && (c.toMonth === null || monthsBetween(month, c.toMonth) >= 0);
}

export interface GoalContribution {
  name: string;
  yen: number;
  /** The goal's month has passed with money still to find. Saying so beats
   * spreading the shortfall over months that no longer exist. */
  overdue: boolean;
}

export interface MonthProjection {
  month: string;
  incomeYen: number;
  commitmentYen: number;
  commitments: { name: string; yen: number }[];
  savingYen: number;
  goals: GoalContribution[];
  bufferYen: number;
  /** What's left to actually live on once everything above is taken out. */
  discretionaryYen: number;
  /** Below what this household can run on. Reported, never hidden by
   * quietly shaving the savings: which one to give up is the owner's
   * decision, and they can only make it if they can see the collision. */
  belowMinimum: boolean;
}

export interface ProjectionInput {
  fromMonth: string;
  months: number;
  monthlyIncomeYen: number;
  minimumLivingYen: number;
  bufferYen: number;
  commitments: CommitmentLike[];
  goals: GoalLike[];
}

/**
 * A year, month by month.
 *
 * Savings are levelled: what a goal still needs, divided by the months
 * left before it is due, the same amount every month. Front-loading looks
 * impressive on a chart and breaks in the first month that has a dentist
 * in it.
 */
export function project(input: ProjectionInput): MonthProjection[] {
  const out: MonthProjection[] = [];
  // Saved-so-far only counts once: after the first month the projection
  // assumes each month's contribution was actually made.
  const contributed = new Map<string, number>();

  for (let i = 0; i < input.months; i++) {
    const month = shiftMonth(input.fromMonth, i);
    const active = input.commitments.filter((c) => isActive(c, month));
    const commitmentYen = active.reduce((sum, c) => sum + c.monthlyYen, 0);

    const goals: GoalContribution[] = input.goals.map((goal) => {
      const already = goal.savedYen + (contributed.get(goal.name) ?? 0);
      const remaining = Math.max(0, goal.targetYen - already);
      if (remaining === 0) return { name: goal.name, yen: 0, overdue: false };
      const monthsLeft = monthsBetween(month, goal.targetMonth) + 1;
      if (monthsLeft <= 0) return { name: goal.name, yen: remaining, overdue: true };
      // Rounded up to the hundred: a plan in yen-and-pence is a plan
      // nobody follows.
      const yen = Math.ceil(remaining / monthsLeft / 100) * 100;
      return { name: goal.name, yen: Math.min(yen, remaining), overdue: false };
    });
    for (const g of goals) contributed.set(g.name, (contributed.get(g.name) ?? 0) + g.yen);

    const savingYen = goals.reduce((sum, g) => sum + g.yen, 0);
    const discretionaryYen = input.monthlyIncomeYen - commitmentYen - savingYen - input.bufferYen;
    out.push({
      month,
      incomeYen: input.monthlyIncomeYen,
      commitmentYen,
      commitments: active.map((c) => ({ name: c.name, yen: c.monthlyYen })),
      savingYen,
      goals,
      bufferYen: input.bufferYen,
      discretionaryYen,
      belowMinimum: discretionaryYen < input.minimumLivingYen,
    });
  }
  return out;
}

export interface CategoryHistory {
  category: string;
  /** Average monthly spend over the months looked at. */
  averageYen: number;
}

export interface Allocation {
  category: string;
  amountYen: number;
}

/**
 * Splits what's left across the categories, in proportion to what this
 * household actually spends.
 *
 * Two things this deliberately does not do. It does not budget to a
 * template — someone who cooks every meal and someone who commutes two
 * hours have different shapes, and a budget in the wrong shape is
 * abandoned in the first week. And it does not hand out money nobody was
 * going to spend: when there is more room than this household has ever
 * used, each category is capped at what it actually costs and the rest
 * comes back as unallocated, which is the whole point of budgeting for
 * someone trying to save. Letting the surplus inflate the categories
 * would quietly spend it.
 *
 * Floors only bite downwards: when the month is tight they stop food
 * being cut to nothing, and when it isn't they never push a category
 * above what it really costs.
 */
export function allocate(
  discretionaryYen: number,
  history: CategoryHistory[],
  floors: Record<string, number> = {},
): Allocation[] {
  const categories = [...new Set([...history.map((h) => h.category), ...Object.keys(floors)])];
  if (categories.length === 0) return [];
  const budget = Math.max(0, discretionaryYen);
  const averageOf = (category: string) => history.find((h) => h.category === category)?.averageYen ?? 0;
  const floorOf = (category: string) => {
    const declared = floors[category] ?? 0;
    const average = averageOf(category);
    // Nothing known about the category yet: the floor is all there is to
    // go on. Otherwise it never pushes a category above what it costs.
    return average === 0 ? declared : Math.min(declared, average);
  };

  // What this household would spend if nothing changed.
  const usual = categories.map((category) => ({ category, target: Math.max(floorOf(category), averageOf(category)) }));
  const usualTotal = usual.reduce((sum, u) => sum + u.target, 0);
  if (usualTotal <= budget) {
    return usual.map(({ category, target }) => ({ category, amountYen: roundTo100(target) }));
  }

  const floorTotal = categories.reduce((sum, c) => sum + floorOf(c), 0);
  // Not even the floors fit: everything is scaled down together rather
  // than one category taking the whole cut.
  if (floorTotal >= budget) {
    const scale = floorTotal === 0 ? 0 : budget / floorTotal;
    return categories.map((category) => ({ category, amountYen: roundTo100(floorOf(category) * scale) }));
  }

  const spare = budget - floorTotal;
  const weights = categories.map((category) => ({
    category,
    weight: Math.max(0, averageOf(category) - floorOf(category)),
  }));
  const weightTotal = weights.reduce((sum, w) => sum + w.weight, 0);

  return weights.map(({ category, weight }) => ({
    category,
    amountYen: roundTo100(floorOf(category) + (weightTotal === 0 ? spare / categories.length : (spare * weight) / weightTotal)),
  }));
}

function roundTo100(yen: number): number {
  return Math.max(0, Math.round(yen / 100) * 100);
}
