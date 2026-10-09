/**
 * A copy of unsaved note text kept in this browser, so the text survives
 * whatever happens to the page before Save is pressed.
 *
 * Saving is explicit in this app (see MarkdownNoteEditor), which means the
 * only copy of what's being typed lives in the page until then. Several
 * ordinary things end that page without warning: Chrome discards tabs left
 * in the background to save memory and reloads them when you come back; a
 * new deploy makes the open page's save calls point at code that no longer
 * exists, so Save fails; and a login that has run out sends the next page
 * load to the sign-in screen. Each of those used to take the text with it.
 *
 * localStorage, not the server: the cases above are exactly the ones where
 * the server can't be reached or won't accept the write. Every access is
 * guarded — private windows, blocked storage and full quotas all throw, and
 * a backup that breaks the editor would be worse than none.
 */

const PREFIX = "note-draft:";

export interface DraftBackup {
  /** The unsaved text. */
  value: string;
  /** The saved text it was written on top of — if what's saved has since
   * changed (edited on another device), restoring would overwrite that, and
   * the editor says so. */
  base: string;
  /** When it was last written, ms since epoch. */
  at: number;
}

export function readDraft(key: string): DraftBackup | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftBackup>;
    if (typeof parsed.value !== "string" || typeof parsed.base !== "string") return null;
    return { value: parsed.value, base: parsed.base, at: typeof parsed.at === "number" ? parsed.at : 0 };
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: string, base: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ value, base, at: Date.now() } satisfies DraftBackup));
  } catch {
    // Storage unavailable or full — the editor carries on without a backup.
  }
}

export function removeDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clean up if storage can't be reached.
  }
}
