/**
 * Reads the Bullet Journal notation the daily task notes are written in
 * (see src/components/BulletJournalLegend.tsx for the signifiers and why
 * they're the ones they are).
 *
 * Pure — no Prisma import — so it can be used on either side of the
 * client/server line, like promotionValidation.ts and projectValidation.ts.
 * The notes stay plain text: nothing here writes a parsed structure back,
 * it only reads what's already typed, so the note remains a text file that
 * happens to be legible to the timeline rather than a form that has to be
 * filled in.
 */

/** `[indent][*|! …][glyph] text` — signifiers prefix the entry glyph, so
 * "*- 見積り" is a priority task, not a separate kind. */
const ENTRY = /^\s*([*!]+\s*)?([-x><o~])\s+(.*\S)\s*$/;

export interface BulletEntry {
  glyph: "-" | "x" | ">" | "<" | "o" | "~";
  text: string;
  priority: boolean;
  inspiration: boolean;
  /** Nesting level, counted by how the indents nest rather than by how
   * many spaces they use: two spaces, four, or a tab all read the same,
   * because the note is typed by a person and not by a formatter. */
  depth: number;
  /** Which line of the note this came from — what makes it possible to
   * move the entry without rewriting anything else. */
  line: number;
}

/** Leading whitespace as a width, with a tab worth four columns — enough
 * to order indents against each other, which is all depth needs. */
function indentWidth(line: string): number {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  return [...lead].reduce((width, ch) => width + (ch === "\t" ? 4 : 1), 0);
}

/**
 * How much deeper a line has to sit before it counts as nested.
 *
 * A single column is not an indent, it's a stray space — and in a note
 * typed by hand there are always a few. Treating one as a level turns the
 * next top-level task into a child of the one above it, which reads as a
 * structure the owner never wrote. Markdown draws the same line: two
 * spaces or more, or nothing.
 */
const INDENT_STEP = 2;

export function parseEntries(content: string): BulletEntry[] {
  const entries: BulletEntry[] = [];
  // Indent widths of the open ancestors. A deeper line pushes a level, a
  // shallower one pops back to wherever it belongs.
  const stack: number[] = [];
  content.split("\n").forEach((line, index) => {
    const m = ENTRY.exec(line);
    if (!m) return;
    const width = indentWidth(line);
    // The level this line belongs to is the one it is written closest to.
    // Ties go outward: a line that isn't clearly indented isn't indented.
    let level = stack.findIndex((open) => Math.abs(width - open) < INDENT_STEP);
    if (level === -1 && (stack.length === 0 || width >= stack[stack.length - 1] + INDENT_STEP)) {
      stack.push(width);
      level = stack.length - 1;
    } else if (level === -1) {
      // Matches no open level: it belongs one step inside the deepest
      // level it is clearly indented past. Written under a much deeper
      // line, "  - d" is still a child of the "- a" above it, not a
      // sibling of it.
      level = stack.filter((open) => open <= width - INDENT_STEP).length;
    }
    stack.length = level + 1;
    // The shallowest spelling of a level wins, so a real child of a
    // slightly over-indented line still has room to nest under it.
    stack[level] = Math.min(stack[level], width);
    const signifiers = m[1] ?? "";
    entries.push({
      glyph: m[2] as BulletEntry["glyph"],
      text: m[3],
      priority: signifiers.includes("*"),
      inspiration: signifiers.includes("!"),
      depth: stack.length - 1,
      line: index,
    });
  });
  return entries;
}

export interface OpenTask extends BulletEntry {
  /** Depth among the tasks actually shown. A subtask whose parent is
   * already ticked off would otherwise hang under nothing — it becomes a
   * top-level task here, which is what it now is. */
  displayDepth: number;
}

/** Only "-" — a task still open. "x" is done, and ">"/"<" were moved to
 * another day on purpose, so neither belongs in today's list. */
export function openTasks(content: string): OpenTask[] {
  const shownAncestors: number[] = [];
  return parseEntries(content)
    .filter((e) => e.glyph === "-")
    .map((entry) => {
      while (shownAncestors.length > 0 && shownAncestors[shownAncestors.length - 1] >= entry.depth) {
        shownAncestors.pop();
      }
      const displayDepth = shownAncestors.length;
      shownAncestors.push(entry.depth);
      return { ...entry, displayDepth };
    });
}

/** One level of nesting in a carried-over line whose parent stayed behind
 * — the same four spaces the editor's indent button inserts. */
const CARRY_INDENT = "    ";

/**
 * The lines of one day's note that move on to the next day, ready to
 * append to it.
 *
 * Every entry with a signifier comes along except a finished one ("x");
 * plain lines with no signifier are left behind — they're notes about that
 * day, not things still to do. A ">" entry was moved to the next day by
 * hand, so it arrives there as an ordinary task ("-"). A line already in
 * `existing` (the next day's note as it stands) isn't added again, so
 * carrying over never repeats something written there already.
 *
 * Lines are copied as they were typed. Only when a line's parent stayed
 * behind (a finished task with an unfinished subtask) is it re-indented,
 * one level per ancestor that did come along, so it doesn't hang under
 * whatever happens to sit above it in the new day.
 */
export function carryOverLines(content: string, existing: string): string[] {
  const lines = content.split("\n");
  const already = new Set(existing.split("\n").map((l) => l.trim()).filter(Boolean));
  // Open ancestors: their depth, and whether they came along.
  const ancestors: { depth: number; kept: boolean }[] = [];
  const out: string[] = [];
  for (const entry of parseEntries(content)) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= entry.depth) ancestors.pop();
    const keep = entry.glyph !== "x";
    if (keep) {
      let line = lines[entry.line];
      if (entry.glyph === ">") line = line.replace(/^(\s*[*!]*\s*)>/, "$1-");
      if (ancestors.some((a) => !a.kept)) {
        line = CARRY_INDENT.repeat(ancestors.filter((a) => a.kept).length) + line.trimStart();
      }
      if (!already.has(line.trim())) {
        out.push(line.replace(/\s+$/, ""));
        already.add(line.trim());
      }
    }
    ancestors.push({ depth: entry.depth, kept: keep });
  }
  return out;
}

/** `existing` with `lines` added at the end, on lines of their own. */
export function appendLines(existing: string, lines: string[]): string {
  if (lines.length === 0) return existing;
  const base = existing.replace(/\s+$/, "");
  return base ? `${base}\n${lines.join("\n")}` : lines.join("\n");
}
