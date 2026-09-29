"use client";

import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { updateQuickNoteContentAction } from "@/app/dash-off/actions";
import type { QuickNoteDetail } from "@/lib/quickNotes";

export function QuickNoteContentSection({
  noteId,
  content,
  onSaved,
}: {
  noteId: string;
  content: string;
  /** Notified with the freshly-saved detail — used by callers that keep
   * their own summary list in sync (e.g. QuickNoteInlineTimeline's list of
   * cards) instead of relying on a page navigation to pick up the change. */
  onSaved?: (detail: QuickNoteDetail) => void;
}) {
  async function save(next: string) {
    const detail = await updateQuickNoteContentAction(noteId, next);
    onSaved?.(detail);
  }

  return <MarkdownNoteEditor content={content} onSave={save} />;
}
