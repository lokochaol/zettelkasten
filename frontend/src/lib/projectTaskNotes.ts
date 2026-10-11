import { prisma } from "@/lib/db";
import * as projects from "@/lib/projects";
import { shiftDateKey } from "@/lib/dateKey";
import { appendLines, carryOverLines } from "@/lib/bulletJournal";

/**
 * A ProjectTaskNote's date is always handled as a plain "YYYY-MM-DD" string
 * (`dateKey`) everywhere outside this module — Prisma's `@db.Date` column is
 * the only place that needs an actual Date, and only ever at UTC midnight,
 * so a dateKey round-trips through it without any timezone drift.
 */

function toDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Only ever applied to a Date this module itself put at UTC midnight (a
 * dateKey round-trip), never to "now" — which day "now" falls on depends on
 * the owner's time zone, not the server's, and that lives in
 * src/lib/dateKey.ts. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ProjectTaskNoteView {
  projectId: string;
  date: string;
  content: string;
}

export async function getOrEmpty(ownerSub: string, projectId: string, dateKey: string): Promise<ProjectTaskNoteView> {
  await projects.requireOwnedProject(ownerSub, projectId);
  const row = await prisma.projectTaskNote.findUnique({
    where: { projectId_date: { projectId, date: toDate(dateKey) } },
  });
  return { projectId, date: dateKey, content: row?.content ?? "" };
}

export async function upsertContent(
  ownerSub: string,
  projectId: string,
  dateKey: string,
  content: string,
): Promise<ProjectTaskNoteView> {
  await projects.requireOwnedProject(ownerSub, projectId);
  const date = toDate(dateKey);
  const row = await prisma.projectTaskNote.upsert({
    where: { projectId_date: { projectId, date } },
    create: { projectId, date, content },
    update: { content },
  });
  return { projectId, date: dateKey, content: row.content };
}

/** A day older than this isn't carried into today: the note is from a
 * stretch the owner wasn't using the app, and its tasks are better read
 * there than dropped into today unasked. */
const CARRY_WINDOW_DAYS = 7;

/**
 * Brings each active project's unfinished entries from its last note into
 * today's (see bulletJournal.carryOverLines for which lines).
 *
 * Run when today's notes are first read rather than by a midnight job: the
 * day turns over in the owner's time zone, which only their request knows,
 * and a day with no visit has nothing to carry into yet. The source is the
 * most recent earlier note — usually yesterday, or the last day written on
 * after a gap — and it's carried once: it's marked before today's note is
 * touched, in the same transaction, so two pages opening at once can't both
 * append. Today's note is only ever added to, never rewritten.
 */
export async function carryForward(ownerSub: string, todayKey: string): Promise<void> {
  const activeProjects = await projects.listActive(ownerSub);
  if (activeProjects.length === 0) return;
  const today = toDate(todayKey);
  const windowStart = toDate(shiftDateKey(todayKey, -CARRY_WINDOW_DAYS));

  for (const project of activeProjects) {
    const source = await prisma.projectTaskNote.findFirst({
      where: { projectId: project.id, date: { lt: today } },
      orderBy: { date: "desc" },
    });
    if (!source || source.carriedForwardAt) continue;

    await prisma.$transaction(async (tx) => {
      // Every earlier day counts as handled from here on, the source and
      // anything before it, so an older note can't surface later as "the
      // latest one not yet carried".
      const claimed = await tx.projectTaskNote.updateMany({
        where: { id: source.id, carriedForwardAt: null },
        data: { carriedForwardAt: new Date() },
      });
      if (claimed.count === 0) return; // another request got here first
      await tx.projectTaskNote.updateMany({
        where: { projectId: project.id, date: { lt: source.date }, carriedForwardAt: null },
        data: { carriedForwardAt: new Date() },
      });
      if (source.date < windowStart) return;

      const target = await tx.projectTaskNote.findUnique({ where: { projectId_date: { projectId: project.id, date: today } } });
      const lines = carryOverLines(source.content, target?.content ?? "");
      if (lines.length === 0) return;
      const content = appendLines(target?.content ?? "", lines);
      await tx.projectTaskNote.upsert({
        where: { projectId_date: { projectId: project.id, date: today } },
        create: { projectId: project.id, date: today, content },
        update: { content },
      });
    });
  }
}

export interface DayStripEntry {
  date: string;
  hasContent: boolean;
}

/** Backs the Project detail page's day-strip — the last `daysBack` days up
 * to and including today, oldest first. */
/**
 * The last few days, ending on the owner's own today.
 *
 * `todayKey` is passed in for the same reason listTimelineMarks takes one:
 * the host's clock is UTC, so computing the strip here would end it on
 * yesterday for anyone in JST until nine in the morning — while the note
 * shown beside it is already on today's date, which is how the strip and
 * the note came to disagree.
 */
export async function listRecentDays(
  ownerSub: string,
  projectId: string,
  daysBack: number,
  todayKey: string,
): Promise<DayStripEntry[]> {
  await projects.requireOwnedProject(ownerSub, projectId);
  const days = Array.from({ length: daysBack + 1 }, (_, i) => shiftDateKey(todayKey, i - daysBack));

  const rows = await prisma.projectTaskNote.findMany({
    where: { projectId, date: { gte: toDate(days[0]) } },
    select: { date: true, content: true },
  });
  const hasContentByDate = new Map(rows.map((r) => [toDateKey(r.date), r.content.trim().length > 0]));

  return days.map((date) => ({ date, hasContent: hasContentByDate.get(date) ?? false }));
}

export interface TodayProjectNote {
  projectId: string;
  projectName: string;
  isDefault: boolean;
  content: string;
}

/** Backs Calendar's "今日" view — every active project's note for the given
 * day, one entry each (empty string if that project has no note yet). */
export async function listAllProjectsTodayNotes(ownerSub: string, dateKey: string): Promise<TodayProjectNote[]> {
  const activeProjects = await projects.listActive(ownerSub);
  if (activeProjects.length === 0) return [];

  const date = toDate(dateKey);
  const rows = await prisma.projectTaskNote.findMany({
    where: { projectId: { in: activeProjects.map((p) => p.id) }, date },
  });
  const contentByProject = new Map(rows.map((r) => [r.projectId, r.content]));

  return activeProjects.map((p) => ({
    projectId: p.id,
    projectName: p.name,
    isDefault: p.isDefault,
    content: contentByProject.get(p.id) ?? "",
  }));
}

export interface ProjectTimelineMark {
  projectId: string;
  projectName: string;
  /** This project's *elapsed* span within the requested month, already
   * clipped to [monthStart, monthEnd] and to [startedAt, today-or-closedAt]
   * — the bar drawn for this row runs exactly from rangeStart to rangeEnd.
   *
   * Both are null when none of this month has happened yet: a month in the
   * future can be looked at and written into, but nothing in it has been
   * lived, so there is no span to draw. The row is still returned, because
   * the point of a future month is to plan in it. */
  rangeStart: string | null;
  rangeEnd: string | null;
  /** Every date (YYYY-MM-DD) this project has a task note on THIS MONTH, for
   * the tappable marks — not the project's whole history, so this payload
   * stays bounded no matter how long a project has been running. */
  noteDates: string[];
}

/** Backs Calendar's 横向きタイムライン view — one line per active project,
 * scoped to a single calendar month (1-indexed `month`). A project's bar
 * always extends only up to today while it stays open (never further,
 * never less — closing is the only thing that ever freezes it, see
 * src/lib/projects.ts#close) and only ever within the requested month.
 *
 * `todayKey` is passed in rather than computed here from `new Date()` — the
 * caller (a client component) already computed it from the same clock its
 * `year`/`month` request and its own displayed "today" all came from. If
 * this function instead asked its OWN server clock what "today" is, any
 * client/server clock skew would make an ostensibly-current month look like
 * it's in the future relative to the server, silently filtering every
 * project out of the requested month (rangeStart ends up after rangeEnd for
 * all of them — this is exactly what happened before todayKey was threaded
 * through: the timeline rendered as empty even though the projects and
 * their notes were all still there). */
export async function listTimelineMarks(
  ownerSub: string,
  year: number,
  month: number,
  todayKey: string,
): Promise<ProjectTimelineMark[]> {
  const activeProjects = await prisma.project.findMany({
    where: { ownerSub, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { startedAt: "asc" }],
  });
  if (activeProjects.length === 0) return [];

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const today = toDate(todayKey);

  const notes = await prisma.projectTaskNote.findMany({
    where: { projectId: { in: activeProjects.map((p) => p.id) }, date: { gte: monthStart, lte: monthEnd } },
    select: { projectId: true, date: true },
  });
  const datesByProject = new Map<string, string[]>();
  for (const n of notes) {
    const arr = datesByProject.get(n.projectId) ?? [];
    arr.push(toDateKey(n.date));
    datesByProject.set(n.projectId, arr);
  }

  const marks: ProjectTimelineMark[] = [];
  for (const p of activeProjects) {
    // Whether this project overlaps the requested month AT ALL depends only
    // on its own startedAt/closedAt vs. the month's calendar boundaries —
    // never on "today". Comparing against "today" here (as an earlier
    // version of this function did) made a project vanish from its own
    // start month whenever its real startedAt timestamp read as even
    // slightly later than "today" — which can happen even under a single
    // consistent clock (e.g. a project created moments before this request
    // resolves) and is exactly what caused the "empty timeline" bug.
    if (p.startedAt > monthEnd) continue; // hasn't started yet as of this month
    if (p.closedAt && p.closedAt < monthStart) continue; // already closed before this month

    const rangeStartDate = p.startedAt > monthStart ? p.startedAt : monthStart;
    let rangeEndDate = p.closedAt && p.closedAt < monthEnd ? p.closedAt : monthEnd;
    // An open project's bar never extends past "today": the bar says "this
    // project was running on these days", which cannot be said of a day
    // that hasn't come. In a month that is entirely ahead of today that
    // leaves nothing to draw, and the row goes out with no span rather
    // than with a one-day stub on the 1st, which would read as a fact
    // about a day nobody has lived yet.
    const hasSpan = !(!p.closedAt && today < rangeStartDate);
    if (!p.closedAt && today < rangeEndDate) rangeEndDate = today;

    marks.push({
      projectId: p.id,
      projectName: p.name,
      rangeStart: hasSpan ? toDateKey(rangeStartDate) : null,
      rangeEnd: hasSpan ? toDateKey(rangeEndDate) : null,
      noteDates: (datesByProject.get(p.id) ?? []).sort(),
    });
  }
  return marks;
}
