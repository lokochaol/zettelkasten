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
