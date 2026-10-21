/**
 * The goals' colours. Each goal (area) keeps one colour everywhere it
 * appears — its rows on the roadmap, its blocks in the week, its bars in
 * the records — so the plan reads at a glance as "which part of life is
 * this". Chosen to sit next to the app's orange accent rather than fight
 * it: one warm lead and cooler, quieter companions, each still readable
 * as text on a light or dark surface. Pure, for the browser.
 */

export interface GoalColor {
  name: string;
  /** The solid colour — bar edges, dots, text accents. */
  hex: string;
}

export const GOAL_COLORS: GoalColor[] = [
  { name: "orange", hex: "#f2552c" },
  { name: "blue", hex: "#3b6fe0" },
  { name: "green", hex: "#1f9d6b" },
  { name: "violet", hex: "#8b5cf6" },
  { name: "amber", hex: "#d39200" },
  { name: "rose", hex: "#e0457b" },
  { name: "teal", hex: "#0e9fb3" },
  { name: "indigo", hex: "#5b5bd6" },
  { name: "olive", hex: "#7c8a1f" },
  { name: "slate", hex: "#64748b" },
];

/** A goal's colour: the one it was given, else one by its position. */
export function goalColor(color: string, index: number): GoalColor {
  return GOAL_COLORS.find((c) => c.name === color) ?? GOAL_COLORS[((index % GOAL_COLORS.length) + GOAL_COLORS.length) % GOAL_COLORS.length];
}

/** The same colour, lighter — for fills behind text. `alpha` 0–1. */
export function tint(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}
