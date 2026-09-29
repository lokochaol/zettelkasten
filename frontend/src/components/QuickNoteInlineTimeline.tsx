"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { NoteTimeline } from "@/components/NoteTimeline";
import { QuickNoteActionMenu } from "@/components/QuickNoteActionMenu";
import { QuickNoteDetailOverlay } from "@/components/QuickNoteDetailOverlay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createQuickNoteAction, deleteQuickNoteAction } from "@/app/dash-off/actions";
import type { QuickNoteDetail, QuickNoteSummary } from "@/lib/quickNotes";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";
import { useAutoScrollToBottom } from "@/lib/useAutoScrollToBottom";

function previewFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? "";
}

function formatDate(date: Date, locale: Locale) {
  return new Date(date).toLocaleDateString(localeTag(locale));
}

const HEADER_FADE_MASK = "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)";

/**
 * The ③ column's quick-note list — unlike /dash-off's ScratchTimeline, add/
 * edit/delete all complete without leaving the Zettelkasten screen.
 * Editing opens the same detail layout /dash-off/[id] uses (content,
 * literature, project sections) but as an overlay (QuickNoteDetailOverlay)
 * rather than a real navigation — mirroring how a PermanentNote opens via
 * NoteDetailOverlay instead of routing to it. Selection (for promotion)
 * stays owned by the parent; this component owns the notes list + the
 * detail overlay.
 */
export interface FocusNoteRequest {
  id: string;
  /** Bumped on every request so re-focusing the same note (e.g. clicking the
   * same "referenced by" link twice) still re-triggers the scroll/highlight. */
  token: number;
}

export function QuickNoteInlineTimeline({
  notes,
  onNotesChange,
  selectedIds,
  onToggleSelect,
  onDeleted,
  header,
  focusRequest,
}: {
  notes: QuickNoteSummary[];
  onNotesChange: (notes: QuickNoteSummary[]) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleted: (id: string) => void;
  header: ReactNode;
  /** When set, scrolls the given note into view and briefly highlights it —
   * used so a "referenced by" link elsewhere (e.g. a literature memo's
   * detail view) can point at a note already visible in this list instead of
   * navigating to its own detail page. */
  focusRequest?: FocusNoteRequest | null;
}) {
  const { t, locale } = useI18n();
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useAutoScrollToBottom<HTMLDivElement>(notes.length);

  useEffect(() => {
    if (!focusRequest) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-note-id="${focusRequest.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightId(focusRequest.id);
    const timer = setTimeout(() => setHighlightId(null), 2200);
    return () => clearTimeout(timer);
  }, [focusRequest?.id, focusRequest?.token]);

  function handleContentSaved(detail: QuickNoteDetail) {
    onNotesChange(
      notes.map((n) =>
        n.id === detail.id
          ? { ...n, preview: previewFrom(detail.content), hasLiterature: !!detail.literatureMemo, literatureCitation: detail.literatureMemo?.citation ?? null }
          : n,
      ),
    );
  }

  function confirmDelete() {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    startDeleteTransition(async () => {
      await deleteQuickNoteAction(id);
      onNotesChange(notes.filter((n) => n.id !== id));
      onDeleted(id);
      setDeleteTargetId(null);
      if (openDetailId === id) setOpenDetailId(null);
    });
  }

  async function addNote() {
    setCreating(true);
    try {
      const detail = await createQuickNoteAction("SCRATCH");
      onNotesChange([
        ...notes,
        {
          id: detail.id,
          source: detail.source,
          encounteredAt: detail.encounteredAt,
          preview: "",
          hasLiterature: false,
          literatureCitation: null,
        },
      ]);
      setOpenDetailId(detail.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div
          className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 bg-bg px-4 py-3 pb-6"
          style={{ maskImage: HEADER_FADE_MASK, WebkitMaskImage: HEADER_FADE_MASK }}
        >
          {header}
        </div>

        <NoteTimeline
        emptyLabel={t.zettelkasten.emptyTimeline}
        rows={notes.map((note) => ({
            key: note.id,
            meta: <span className="font-mono text-[9.5px] text-ink-faint">{formatDate(note.encounteredAt, locale)}</span>,
            card: (
              <div
                data-note-id={note.id}
                className={`relative w-full max-w-[360px] rounded-lg transition-shadow duration-500 ${
                  highlightId === note.id ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""
                }`}
              >
                <button
                  onClick={() => onToggleSelect(note.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left text-xs text-ink transition-colors ${
                    selectedIds.has(note.id)
                      ? "border-accent/70 bg-accent-soft"
                      : "border-line bg-surface-alt hover:border-line-strong"
                  }`}
                >
                  {note.preview || t.common.noContent}
                  {note.literatureCitation && (
                    <span className="flex items-start gap-1.5 border-t border-line/60 pt-1.5 font-mono text-[9.5px] text-ink-soft">
                      <span className="shrink-0 text-accent">📖</span>
                      <span className="line-clamp-1">{note.literatureCitation}</span>
                    </span>
                  )}
                </button>
                <QuickNoteActionMenu onEdit={() => setOpenDetailId(note.id)} onDelete={() => setDeleteTargetId(note.id)} />
                <ConfirmDialog
                  open={deleteTargetId === note.id}
                  title={t.zettelkasten.deleteConfirmTitle}
                  warning={t.zettelkasten.deleteConfirmWarning}
                  confirmLabel={t.common.delete}
                  onCancel={() => setDeleteTargetId(null)}
                  onConfirm={confirmDelete}
                  confirmDisabled={deletePending}
                  confirmPending={deletePending}
                />
              </div>
            ),
            dotClassName: selectedIds.has(note.id) ? "bg-accent" : "",
          }))}
        />

        <div className="flex flex-col items-center gap-3 pt-10 pb-4">
          <button onClick={addNote} disabled={creating} className="group relative flex flex-col items-center gap-2">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <span
                aria-hidden="true"
                className="animate-glow-breathe absolute h-14 w-14 rounded-full bg-accent blur-xl transition-opacity duration-300 group-hover:opacity-90"
              />
              <span
                aria-hidden="true"
                className="animate-spin-slow absolute h-14 w-14 rounded-full border border-dashed border-accent/70 transition-colors duration-300 group-hover:border-accent"
              />
              <span aria-hidden="true" className="animate-radar-ping absolute h-3 w-3 rounded-full bg-accent" />

              <span className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-accent bg-surface text-accent shadow-[0_0_24px_-4px_var(--color-accent)] transition-transform duration-300 ease-out group-hover:scale-110 group-active:scale-95">
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 2.5V15.5M2.5 9H15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </div>
            <span className="font-mono text-xs font-bold tracking-[0.2em] text-accent uppercase">
              <span className="text-ink-soft">&gt;</span> {creating ? t.common.creating : t.zettelkasten.addNote}
            </span>
          </button>
        </div>
      </div>

      {openDetailId && (
        <QuickNoteDetailOverlay
          noteId={openDetailId}
          onClose={() => setOpenDetailId(null)}
          onContentSaved={handleContentSaved}
        />
      )}
    </div>
  );
}
