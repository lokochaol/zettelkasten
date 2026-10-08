/**
 * Whole-line edits for the note editor's touch toolbar (NoteKeyBar).
 *
 * On a phone there is no Tab key and the Bullet Journal glyphs sit two or
 * three keyboard layers deep, so the toolbar offers them as operations on
 * the line the caret is on — or every line a selection touches — rather
 * than as characters to type: "make this a done item", not "type an x".
 * That's also what makes them usable mid-line; the caret doesn't have to be
 * at the start for the line's marker to change.
 *
 * Pure: text and selection in, text and selection out. The editor applies
 * the result through execCommand so the browser's undo still works.
 */

export const INDENT = "    ";

export type Glyph = "-" | "x" | ">" | "<" | "o" | "~";
export type Signifier = "*" | "!";

export interface Edit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** What a replacement looks like to the editor: the span of whole lines to
 * replace, what goes there, and where the selection lands afterwards. */
export interface LineReplacement {
  from: number;
  to: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** `[indent][signifiers][glyph] [text]` — the same shape bulletJournal.ts
 * reads, except the text may be empty: a line being written has a marker
 * before it has words. */
const LINE = /^([ \t]*)([*!]*)\s*([-x><o~])(?:\s+|$)(.*)$/;

interface Parsed {
  indent: string;
  signifiers: string;
  glyph: Glyph | null;
  text: string;
}

function parse(line: string): Parsed {
  const m = LINE.exec(line);
  if (m) return { indent: m[1], signifiers: m[2], glyph: m[3] as Glyph, text: m[4] };
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  return { indent, signifiers: "", glyph: null, text: line.slice(indent.length) };
}

function format(p: Parsed): string {
  // Signifiers only mean something in front of a glyph; on a plain line they
  // go in front of the words, which is where someone typing them would put
  // them.
  if (!p.glyph) return `${p.indent}${p.signifiers ? `${p.signifiers} ` : ""}${p.text}`;
  return `${p.indent}${p.signifiers}${p.glyph} ${p.text}`;
}

/** Keeps "*" before "!" whichever was added first, so the same marks always
 * read the same way. */
function normaliseSignifiers(s: string): string {
  return `${s.includes("*") ? "*" : ""}${s.includes("!") ? "!" : ""}`;
}

/** Where a caret at `column` in `before` belongs in `after`: unchanged if
 * it sat in the part both share at the start, otherwise moved by however
 * much the line grew or shrank — never into the part that was rewritten.
 *
 * Two cases follow the text rather than the column. A caret at the end of
 * the line stays at the end, so a marker or an indent added while typing
 * doesn't strand the caret in front of what was just written. And a caret
 * exactly where something was inserted ends up after it: tapping "-" on an
 * empty line should leave you typing the task, not in front of its marker.
 * That second rule is for a caret only (`caret`): the start of a selection
 * stays put, so a block selected from column 0 is still selected from
 * column 0 after it's indented. */
function mapColumn(before: string, after: string, column: number, caret: boolean): number {
  if (column === before.length) return after.length;
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) common++;
  const delta = after.length - before.length;
  const pureInsertion = delta > 0 && after.slice(common + delta) === before.slice(common);
  if (caret && column === common && pureInsertion) return column + delta;
  if (column <= common) return column;
  return Math.max(common, Math.min(after.length, column + delta));
}

/**
 * Applies `transform` to every line the selection touches. A collapsed
 * selection touches one line — the caret's.
 */
export function editLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transform: (line: string) => string,
): LineReplacement {
  const from = value.lastIndexOf("\n", selectionStart - 1) + 1;
  // A selection that ends right at the start of a line doesn't include it —
  // selecting three whole lines by dragging ends on the fourth's column 0.
  const effectiveEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  const to = nextBreak === -1 ? value.length : nextBreak;

  const before = value.slice(from, to).split("\n");
  const after = before.map(transform);

  const caret = selectionStart === selectionEnd;
  const mapOffset = (offset: number): number => {
    let lineStart = from;
    let newLineStart = from;
    for (let i = 0; i < before.length; i++) {
      const lineEnd = lineStart + before[i].length;
      if (offset <= lineEnd) return newLineStart + mapColumn(before[i], after[i], offset - lineStart, caret);
      lineStart = lineEnd + 1;
      newLineStart += after[i].length + 1;
    }
    // Past the edited lines (a selection ending at the next line's start):
    // shifted by however much the block grew.
    return offset + (after.join("\n").length - (to - from));
  };

  return {
    from,
    to,
    text: after.join("\n"),
    selectionStart: mapOffset(selectionStart),
    selectionEnd: mapOffset(selectionEnd),
  };
}

export function indentLine(line: string): string {
  return INDENT + line;
}

/** Takes off one level: a tab, or up to four spaces. A line with no indent
 * is left alone rather than eating into its text. */
export function outdentLine(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  const spaces = /^ {1,4}/.exec(line)?.[0].length ?? 0;
  return line.slice(spaces);
}

/** Sets the line's glyph. The same glyph again takes it off — turning a
 * task back into a plain line is as reachable as making one. */
export function setGlyph(line: string, glyph: Glyph): string {
  const p = parse(line);
  if (p.glyph === glyph) return format({ ...p, glyph: null, signifiers: "" });
  return format({ ...p, glyph });
}

export function toggleSignifier(line: string, signifier: Signifier): string {
  const p = parse(line);
  const has = p.signifiers.includes(signifier);
  const next = has ? p.signifiers.replaceAll(signifier, "") : p.signifiers + signifier;
  return format({ ...p, signifiers: normaliseSignifiers(next) });
}

/** Convenience for tests and callers that want the whole document back. */
export function applyReplacement(value: string, r: LineReplacement): Edit {
  return {
    value: value.slice(0, r.from) + r.text + value.slice(r.to),
    selectionStart: r.selectionStart,
    selectionEnd: r.selectionEnd,
  };
}
