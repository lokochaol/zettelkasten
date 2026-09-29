"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { NoteTimeline, type TimelineRow } from "@/components/NoteTimeline";
import { QuickNoteActionMenu } from "@/components/QuickNoteActionMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NewQuickNoteOverlay } from "@/components/NewQuickNoteOverlay";
import { AddQuickNoteTrigger } from "@/components/AddQuickNoteTrigger";
import { DiscoveryShelf } from "@/components/DiscoveryShelf";
import { DiscoveryRail } from "@/components/DiscoveryRail";
import { deleteQuickNoteAction } from "@/app/dash-off/actions";
import type { QuickNoteSummary } from "@/lib/quickNotes";
import type { DiscoveryCandidateSummary } from "@/lib/discovery";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";
import { useAutoScrollToBottom } from "@/lib/useAutoScrollToBottom";

function formatDate(date: Date, locale: Locale) {
  return date.toLocaleString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HEADER_FADE_MASK = "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)";

/** /dash-off's timeline — extracted to a client component so each card can
 * carry a corner 編集/削除 menu (both navigate to the full detail page)
 * alongside the "+" add flow. Editing always happens on "the detail screen" —
 * for an already-synced note that's a real navigation to /dash-off/[id]; for
 * a brand-new one, NewQuickNoteOverlay is a full-screen overlay laid out
 * like that same detail page rather than an inline card sitting in this
 * list, so composing never happens in-place among the other notes. It's
 * still a plain client component (no real navigation), specifically so it
 * renders instantly and accepts typing offline — see NewQuickNoteOverlay's
 * own doc comment. The screen itself doesn't scroll — only the list does,
 * anchored to the bottom (latest note) by default, matching a chat-style
 * history view. The add button lives inside the scrollable area, after the
 * last note, so it scrolls out of view when scrolling up into history — it
 * isn't a pinned footer here (unlike QuickNoteInlineTimeline's ③ pane).
 *
 * `header` (brand/nav/search) is rendered inside the same scroll container,
 * pinned via `sticky` with a bottom gradient mask — so notes scrolling up
 * don't get clipped by a hard edge, they fade out under the header instead. */
export function ScratchTimeline({
  initialNotes,
  initialDiscovery,
  header,
}: {
  initialNotes: QuickNoteSummary[];
  initialDiscovery: Record<string, DiscoveryCandidateSummary[]>;
  header: ReactNode;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState(initialNotes);
  const [discoveryByNote, setDiscoveryByNote] = useState(initialDiscovery);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();
  const [composingNew, setComposingNew] = useState(false);
  const scrollRef = useAutoScrollToBottom<HTMLDivElement>(notes.length);

  function confirmDelete() {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    startDeleteTransition(async () => {
      await deleteQuickNoteAction(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setDeleteTargetId(null);
    });
  }

  return (
    <div className="min-h-0 flex-1" style={{ viewTransitionName: "note-timeline" } as CSSProperties}>
      {composingNew && (
        <NewQuickNoteOverlay
          onClose={() => setComposingNew(false)}
          onCreated={(note) => setNotes((prev) => [...prev, note])}
        />
      )}
      <div ref={scrollRef} className="scrollbar-hidden h-full overflow-y-auto px-4">
        <div
          className="sticky top-0 z-20 -mx-4 flex flex-col gap-6 bg-bg px-4 pt-6 pb-8"
          style={{ maskImage: HEADER_FADE_MASK, WebkitMaskImage: HEADER_FADE_MASK }}
        >
          {header}
        </div>

        <NoteTimeline
          emptyLabel={t.scratch.emptyTimeline}
          rows={[
            ...notes.map((note): TimelineRow => {
              const noteCard = (
                <div className="relative w-full max-w-[420px]">
                  <button
                    onClick={() => router.push(`/dash-off/${note.id}`)}
                    className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface-alt p-4 text-left text-sm text-ink transition-colors hover:border-line-strong"
                  >
                    {note.preview || t.common.noContent}
                    {note.literatureCitation && (
                      <span className="flex items-start gap-1.5 border-t border-line pt-2 font-mono text-[10.5px] text-ink-soft">
                        <span className="shrink-0 text-accent">📖</span>
                        <span className="line-clamp-1">{note.literatureCitation}</span>
                      </span>
                    )}
                  </button>
                  <QuickNoteActionMenu
                    onEdit={() => router.push(`/dash-off/${note.id}`)}
                    onDelete={() => setDeleteTargetId(note.id)}
                  />
                  <ConfirmDialog
                    open={deleteTargetId === note.id}
                    title={t.scratch.deleteConfirmTitle}
                    warning={t.scratch.deleteConfirmWarning}
                    confirmLabel={t.common.delete}
                    onCancel={() => setDeleteTargetId(null)}
                    onConfirm={confirmDelete}
                    confirmDisabled={deletePending}
                    confirmPending={deletePending}
                  />
                </div>
              );
              const candidates = discoveryByNote[note.id] ?? [];
              const onCandidatesChange = (next: DiscoveryCandidateSummary[]) =>
                setDiscoveryByNote((prev) => ({ ...prev, [note.id]: next }));

              return {
                key: note.id,
                meta: (
                  <span className="font-mono text-[10px] tracking-wider text-ink-soft">
                    {formatDate(note.encounteredAt, locale)}
                  </span>
                ),
                card: (
                  <>
                    {/* Narrow/portrait: unchanged card + shelf-below layout.
                        min-w-0 matters here: as a flex item of NoteTimeline's
                        `items-center` row, this would otherwise default to
                        min-width:auto and refuse to shrink below
                        DiscoveryShelf's un-scrolled content width, pushing
                        the whole row past the viewport instead of letting
                        the shelf's own overflow-x-auto scroll internally. */}
                    <div className="w-full min-w-0 max-w-[420px] landscape:lg:hidden">
                      {noteCard}
                      <DiscoveryShelf candidates={candidates} onCandidatesChange={onCandidatesChange} />
                    </div>
                    {/* Wide landscape: news/note/literature laid out as three
                        connected columns instead — see DiscoveryRail. */}
                    <div className="hidden w-full landscape:lg:block">
                      <DiscoveryRail candidates={candidates} onCandidatesChange={onCandidatesChange} noteCard={noteCard} />
                    </div>
                  </>
                ),
              };
            }),
          ]}
        />

        {!composingNew && <AddQuickNoteTrigger onClick={() => setComposingNew(true)} />}
      </div>
    </div>
  );
}
