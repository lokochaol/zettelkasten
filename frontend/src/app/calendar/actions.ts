"use server";

import { revalidatePath } from "next/cache";
import * as projectTaskNotes from "@/lib/projectTaskNotes";
import type { TodayProjectNote, ProjectTimelineMark, ProjectTaskNoteView } from "@/lib/projectTaskNotes";
import * as quickNotes from "@/lib/quickNotes";
import type { QuickNoteDetail } from "@/lib/quickNotes";
import { requireOwnerSub } from "@/lib/session";
import { ValidationError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { translateDomainError } from "@/lib/i18n/errors";
import * as googleCalendar from "@/lib/googleCalendar";
import type { CalendarEvent } from "@/lib/googleCalendar";
import { openTasks } from "@/lib/bulletJournal";
import { getTimeZone } from "@/lib/preferences/preferences";
import * as mealPlanning from "@/lib/mealPlanning";
import * as health from "@/lib/health";

export async function listTodayProjectNotesAction(dateKey: string): Promise<TodayProjectNote[]> {
  const ownerSub = await requireOwnerSub();
  return projectTaskNotes.listAllProjectsTodayNotes(ownerSub, dateKey);
}

export interface DayScheduleTask {
  projectId: string;
  projectName: string;
  text: string;
  priority: boolean;
}

export interface DayMeal {
  id: string;
  slot: "BREAKFAST" | "LUNCH" | "DINNER";
  title: string;
  recipe: string;
  status: mealPlanning.MealStatus;
  replacementNote: string;
  kcal: number;
  proteinG: number;
  fiberG: number;
  saltG: number;
  prepMinutes: number;
  start: Date;
  end: Date;
}

/** What the day is supposed to add up to, against what's measured. Null
 * when there's no health profile yet — the dashboard then shows the
 * schedule without pretending to know anything about the body. */
export interface DayNutrition {
  targetKcal: number;
  targetProteinG: number;
  targetFiberG: number;
  saltMaxG: number;
  plannedKcal: number;
  plannedProteinG: number;
  plannedFiberG: number;
  plannedSaltG: number;
  /** What was actually eaten, from the meals the owner confirmed. Kept
   * apart from the planned figures rather than replacing them: the gap
   * between the two is the interesting part, and collapsing them would
   * show a day as short on protein when it simply hasn't been logged. */
  intake: mealPlanning.DayIntake;
  /** Measured for the day, from the phone. */
  activeEnergyKcal: number | null;
  weightKg: number | null;
}

export type DayScheduleView = {
  tasks: DayScheduleTask[];
  meals: DayMeal[];
  nutrition: DayNutrition | null;
} & (
  | { calendar: "linked"; events: CalendarEvent[] }
  /** Never linked, so there's nothing to report — the timeline offers the
   * link instead of showing an error. */
  | { calendar: "not_linked" }
  /** Linked, but the refresh token stopped working (revoked in the Google
   * account). Distinct from an outage: only re-linking fixes it. */
  | { calendar: "reauth_required" }
  /** Google was reachable but unhappy. The day's own tasks still render —
   * a calendar hiccup shouldn't take the task list down with it. */
  | { calendar: "error" }
);

/**
 * One day's schedule: the owner's Google Calendar events plus the tasks
 * still open in that day's project task notes. Assembled server-side so the
 * timeline makes a single round trip, and so a calendar failure degrades to
 * "tasks only" rather than an empty screen.
 */
export async function getDayScheduleAction(dateKey: string): Promise<DayScheduleView> {
  const ownerSub = await requireOwnerSub();
  const [notes, timeZone] = await Promise.all([
    projectTaskNotes.listAllProjectsTodayNotes(ownerSub, dateKey),
    getTimeZone(),
  ]);
  const [scheduled, targetsNow, metric] = await Promise.all([
    mealPlanning.scheduledMealsForDay(ownerSub, dateKey, timeZone),
    health.currentTargets(ownerSub, dateKey),
    health.getDailyMetric(ownerSub, dateKey),
  ]);
  const meals: DayMeal[] = scheduled.map(({ meal, start, end }) => ({
    id: meal.id,
    slot: meal.slot,
    title: meal.title,
    recipe: meal.recipe,
    status: meal.status,
    replacementNote: meal.replacementNote,
    kcal: meal.kcal,
    proteinG: meal.proteinG,
    fiberG: meal.fiberG,
    saltG: meal.saltG,
    prepMinutes: meal.prepMinutes,
    start,
    end,
  }));
  const nutrition: DayNutrition | null = targetsNow
    ? {
        targetKcal: targetsNow.targets.targetKcal,
        targetProteinG: targetsNow.targets.proteinG,
        targetFiberG: targetsNow.targets.fiberG,
        saltMaxG: targetsNow.targets.saltMaxG,
        plannedKcal: meals.reduce((sum, m) => sum + m.kcal, 0),
        plannedProteinG: meals.reduce((sum, m) => sum + m.proteinG, 0),
        plannedFiberG: meals.reduce((sum, m) => sum + m.fiberG, 0),
        plannedSaltG: meals.reduce((sum, m) => sum + m.saltG, 0),
        intake: mealPlanning.intakeOf(scheduled.map(({ meal }) => meal)),
        activeEnergyKcal: metric?.activeEnergyKcal ?? null,
        weightKg: metric?.weightKg ?? null,
      }
    : null;
  const tasks: DayScheduleTask[] = notes.flatMap((note) =>
    openTasks(note.content).map((entry) => ({
      projectId: note.projectId,
      projectName: note.projectName,
      text: entry.text,
      priority: entry.priority,
    })),
  );
  // Priority signifiers first, otherwise the project order the notes came in.
  tasks.sort((a, b) => Number(b.priority) - Number(a.priority));

  try {
    const events = await googleCalendar.listDayEvents(ownerSub, dateKey, timeZone);
    return { calendar: "linked", events, tasks, meals, nutrition };
  } catch (e) {
    if (e instanceof googleCalendar.GoogleCalendarNotLinkedError) return { calendar: "not_linked", tasks, meals, nutrition };
    if (e instanceof googleCalendar.GoogleCalendarAuthError) return { calendar: "reauth_required", tasks, meals, nutrition };
    if (e instanceof googleCalendar.GoogleCalendarApiError) return { calendar: "error", tasks, meals, nutrition };
    throw e;
  }
}

export async function listTimelineMarksAction(year: number, month: number, todayKey: string): Promise<ProjectTimelineMark[]> {
  const ownerSub = await requireOwnerSub();
  return projectTaskNotes.listTimelineMarks(ownerSub, year, month, todayKey);
}

/** Editing a project's task note directly from Calendar's 今日 view — same
 * upsert the Project detail page's day view uses (src/app/projects/actions.ts),
 * duplicated here so this domain's Server Actions don't reach across into
 * another route's actions file. */
export async function upsertCalendarTaskNoteAction(
  projectId: string,
  dateKey: string,
  content: string,
): Promise<ProjectTaskNoteView> {
  const ownerSub = await requireOwnerSub();
  const note = await projectTaskNotes.upsertContent(ownerSub, projectId, dateKey, content);
  revalidatePath("/calendar");
  revalidatePath(`/projects/${projectId}`);
  return note;
}

/** "＋ 走り書きを作成" from a Calendar project card — a new QuickNote already
 * linked to that project, ready for the caller to open (e.g. in
 * QuickNoteDetailOverlay) for editing. */
export async function createQuickNoteForProjectAction(projectId: string): Promise<QuickNoteDetail> {
  const ownerSub = await requireOwnerSub();
  const note = await quickNotes.create(ownerSub, "SCRATCH", undefined, projectId);
  revalidatePath("/scratch");
  revalidatePath(`/projects/${projectId}`);
  return note;
}

/**
 * Records whether a planned meal was actually eaten.
 *
 * The whole day view comes back rather than just the meal: the day's
 * intake, and whether it's still short on protein, changes with every
 * answer, and that recalculation belongs on the server next to the
 * targets.
 */
export async function setMealStatusAction(
  mealId: string,
  status: mealPlanning.MealStatus,
  replacementNote: string,
  dateKey: string,
): Promise<DayScheduleView | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await mealPlanning.setMealStatus(ownerSub, mealId, status, replacementNote);
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
  revalidatePath("/calendar");
  revalidatePath("/meals");
  return getDayScheduleAction(dateKey);
}
