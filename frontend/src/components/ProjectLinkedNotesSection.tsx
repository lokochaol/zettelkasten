"use client";

import { useState } from "react";
import Link from "next/link";
import { QuickNoteDetailOverlay } from "@/components/QuickNoteDetailOverlay";
import { Spinner } from "@/components/LoadingSpinner";
import { getDictionary } from "@/lib/i18n/dictionary";
import { createQuickNoteForProjectAction } from "@/app/calendar/actions";
import type { Locale } from "@/lib/i18n/types";
import type { LinkedPermanentNoteRef, LinkedQuickNoteRef } from "@/lib/projects";
import type { QuickNoteDetail } from "@/lib/quickNotes";

function previewFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? "";
}

/** "またdash-off, 永久保存版メモに保存されたプロジェクトに関連付けられたメモ
 * を一覧表示する" — every QuickNote/PermanentNote ever linked to this
 * project, both still-active and (for QuickNote) archived-by-project-close.
 * Opening a QuickNote shows it in QuickNoteDetailOverlay in place — never a
 * real navigation to /dash-off/[id] — the same pattern the Zettelkasten
 * screen's own 走り書き list uses. Also lets you create a new QuickNote
 * already linked to this project directly from here (reusing the same
 * createQuickNoteForProjectAction the Calendar project cards use). */
export function ProjectLinkedNotesSection({
  projectId,
  quickNotes: initialQuickNotes,
  permanentNotes,
  locale,
}: {
  projectId: string;
  quickNotes: LinkedQuickNoteRef[];
  permanentNotes: LinkedPermanentNoteRef[];
  locale: Locale;
}) {
  const t = getDictionary(locale);
  const [quickNotes, setQuickNotes] = useState(initialQuickNotes);
  const [openQuickNoteId, setOpenQuickNoteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const isEmpty = quickNotes.length === 0 && permanentNotes.length === 0;

  function handleContentSaved(detail: QuickNoteDetail) {
    setQuickNotes((prev) => prev.map((n) => (n.id === detail.id ? { ...n, preview: previewFrom(detail.content) } : n)));
  }

  async function createQuickNote() {
    setCreating(true);
    try {
      const note = await createQuickNoteForProjectAction(projectId);
      setQuickNotes((prev) => [{ id: note.id, preview: "", status: "ACTIVE" }, ...prev]);
      setOpenQuickNoteId(note.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={createQuickNote}
        disabled={creating}
        className="flex w-fit items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {creating && <Spinner size="xs" />}
        {t.calendar.createQuickNoteButton}
      </button>

      {isEmpty && <p className="text-sm text-ink-soft">{t.projects.noLinkedNotes}</p>}

      {quickNotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] font-semibold tracking-[0.15em] text-ink-soft uppercase">
            {t.projects.linkedQuickNotesHeading(quickNotes.length)}
          </h3>
          <div className="flex flex-col gap-1.5">
            {quickNotes.map((note) => (
              <button
                key={note.id}
                onClick={() => setOpenQuickNoteId(note.id)}
                className="truncate rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs text-ink transition-colors hover:border-accent"
              >
                {note.preview || t.common.noContent}
                {note.status === "ARCHIVED" && <span className="ml-2 text-ink-faint">{t.projects.archivedSuffix}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {permanentNotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] font-semibold tracking-[0.15em] text-ink-soft uppercase">
            {t.projects.linkedPermanentNotesHeading(permanentNotes.length)}
          </h3>
          <div className="flex flex-col gap-1.5">
            {permanentNotes.map((note) => (
              <Link
                key={note.id}
                href={`/zettelkasten?open=${note.id}`}
                className="truncate rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent"
              >
                {note.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {openQuickNoteId && (
        <QuickNoteDetailOverlay
          noteId={openQuickNoteId}
          onClose={() => setOpenQuickNoteId(null)}
          onContentSaved={handleContentSaved}
        />
      )}
    </div>
  );
}
