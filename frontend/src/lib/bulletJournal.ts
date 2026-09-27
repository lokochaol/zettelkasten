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
}

export function parseEntries(content: string): BulletEntry[] {
  const entries: BulletEntry[] = [];
  for (const line of content.split("\n")) {
    const m = ENTRY.exec(line);
    if (!m) continue;
    const signifiers = m[1] ?? "";
    entries.push({
      glyph: m[2] as BulletEntry["glyph"],
      text: m[3],
      priority: signifiers.includes("*"),
      inspiration: signifiers.includes("!"),
    });
  }
  return entries;
}

/** Only "-" — a task still open. "x" is done, and ">"/"<" were moved to
 * another day on purpose, so neither belongs in today's list. */
export function openTasks(content: string): BulletEntry[] {
  return parseEntries(content).filter((e) => e.glyph === "-");
}
