/**
 * What a chat shows while the model is still answering.
 *
 * The answer arrives as JSON being written left to right — `{"reply": "…",
 * "meals": [{…}, {…}` — so while it streams, the reply sentence can be read
 * as it forms and each proposed meal or session counted as it closes.
 * That's real progress, from the model's own output, rather than a timer
 * pretending to know how far along it is.
 *
 * Pure (no server imports): the server reads it out of the stream, and the
 * types are what the browser receives.
 */

import type { AiProgress } from "@/lib/aiJson";

/** Where a request is, in the order it gets there. */
export type ChatStage = "context" | "thinking" | "writing" | "saving";

export interface ProgressItem {
  dateKey: string;
  /** Meals only: BREAKFAST / LUNCH / DINNER. */
  slot: string | null;
  title: string;
}

export interface ChatProgress {
  stage: ChatStage;
  /** The reply sentence as far as it has been written. */
  reply: string;
  /** The proposed meals or sessions whose titles are complete so far. */
  items: ProgressItem[];
}

/** One line of the streamed response body (newline-delimited JSON). */
export type ChatStreamEvent<T> =
  | { type: "progress"; progress: ChatProgress }
  | { type: "done"; messages: T[] }
  | { type: "error"; error: string };

function decodeJsonString(raw: string): string {
  // A cut-off escape at the very end ("\" or "\u30") can't be decoded yet;
  // drop it rather than the whole string.
  const safe = raw.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, "");
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return safe;
  }
}

/** The value of a top-level string field, complete or still being written. */
export function partialString(text: string, field: string): string {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(text);
  if (!match) return "";
  let i = match.index + match[0].length;
  let raw = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      raw += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') break;
    raw += ch;
    i++;
  }
  return decodeJsonString(raw);
}

/**
 * The items of an array field whose title has been written out in full.
 * Each item is read as the dateKey that comes before its title (the order
 * the prompts ask for), with the slot if one sits between them. An answer
 * that orders its fields differently just shows fewer items — this is a
 * progress display, not the parser that decides what's applied.
 */
export function partialItems(text: string, arrayField: string): ProgressItem[] {
  const start = text.search(new RegExp(`"${arrayField}"\\s*:\\s*\\[`));
  if (start === -1) return [];
  const body = text.slice(start);
  const items: ProgressItem[] = [];
  const pattern = /"dateKey"\s*:\s*"(\d{4}-\d{2}-\d{2})"((?:(?!"dateKey")[\s\S])*?)"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const m of body.matchAll(pattern)) {
    const slot = /"slot"\s*:\s*"([A-Za-z]+)"/.exec(m[2])?.[1]?.toUpperCase() ?? null;
    items.push({ dateKey: m[1], slot, title: decodeJsonString(m[3]) });
  }
  return items;
}

export function progressFromText(text: string, arrayField: string): ChatProgress {
  return { stage: "writing", reply: partialString(text, "reply"), items: partialItems(text, arrayField) };
}

/** Turns the model's stream into chat progress: "thinking" until answer
 * text appears, then the reply and items read from it. */
export function progressReporter(onProgress: (p: ChatProgress) => void, arrayField: string): (p: AiProgress) => void {
  let writing = false;
  return (p) => {
    if (p.kind === "thinking") {
      if (!writing) onProgress({ stage: "thinking", reply: "", items: [] });
      return;
    }
    writing = true;
    onProgress(progressFromText(p.text, arrayField));
  };
}
