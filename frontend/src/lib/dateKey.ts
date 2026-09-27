/**
 * "YYYY-MM-DD" day keys — the app's unit of "which day", used for project
 * task notes, the calendar's day view and the timeline's day axis.
 *
 * The thing to get right here is which clock decides what "today" is.
 * `new Date().toISOString().slice(0, 10)` (what this module replaces) asks
 * UTC, so for anyone east of Greenwich the app stayed on yesterday's date
 * until their morning, and for anyone west of it, it moved on early. The
 * key has to come from the owner's own calendar instead — hence an explicit
 * `timeZone`, which the server reads from the tz cookie (see
 * src/lib/preferences/) and the browser simply takes from itself.
 *
 * A key is stored as UTC midnight (see src/lib/projectTaskNotes.ts), so
 * anything rendering one back into a label has to format it in UTC too —
 * `formatDateKey` exists so that pairing isn't re-derived at every call
 * site.
 */

/** Formats an instant as the day it falls on in `timeZone` (the runtime's
 * own zone when omitted). */
export function toDateKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today in `timeZone`, or in the runtime's own zone — which in a browser is
 * the owner's, making this the right call in any Client Component. */
export function todayKey(timeZone?: string): string {
  return toDateKey(new Date(), timeZone);
}

/** The key `delta` days away. Done in UTC on purpose: a key is a plain
 * calendar day, so adding a day must never be nudged by a DST transition. */
export function shiftDateKey(dateKey: string, delta: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Renders a key as a date label. Always UTC — a key is stored at UTC
 * midnight, so formatting it in any other zone would print the day before
 * or after for half the world. */
export function formatDateKey(
  dateKey: string,
  localeTag: string,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" },
): string {
  return new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString(localeTag, { ...options, timeZone: "UTC" });
}

/** Minutes `timeZone` is ahead of UTC at a given instant. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const shown = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(shown ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * The UTC instant of a wall-clock time on `dateKey` in `timeZone` —
 * `minutesFromMidnight` is a time on a clock face, not an elapsed
 * duration. The distinction only shows itself on a DST day: 07:00 is
 * still 07:00 on the morning the clocks go forward, even though only six
 * hours have passed since midnight, so adding 420 minutes to midnight
 * would put breakfast at 08:00.
 *
 * Needs two passes: the offset has to be read at the instant we're solving
 * for, and we don't have that instant until we've applied an offset. The
 * first guess uses the offset at the same wall-clock time in UTC, which is
 * only wrong within a few hours of a transition; re-reading at the
 * candidate settles it.
 */
export function localTimeUtc(dateKey: string, minutesFromMidnight: number, timeZone: string): Date {
  const wallClockAsUtc = Date.parse(`${dateKey}T00:00:00Z`) + minutesFromMidnight * 60_000;
  const firstGuess = offsetMinutesAt(new Date(wallClockAsUtc), timeZone);
  const candidate = wallClockAsUtc - firstGuess * 60_000;
  const settled = offsetMinutesAt(new Date(candidate), timeZone);
  return new Date(settled === firstGuess ? candidate : wallClockAsUtc - settled * 60_000);
}

function localMidnightUtc(dateKey: string, timeZone: string): Date {
  return localTimeUtc(dateKey, 0, timeZone);
}

/** The UTC instants that bracket a day key in `timeZone` — what a calendar
 * API's timeMin/timeMax need. Both edges are real local midnights rather
 * than start + 24h: a spring-forward day is 23 hours long, and a fixed 24
 * would reach into the next day and pull in its first event. */
export function dayBoundsUtc(dateKey: string, timeZone: string): { start: Date; end: Date } {
  return { start: localMidnightUtc(dateKey, timeZone), end: localMidnightUtc(shiftDateKey(dateKey, 1), timeZone) };
}
