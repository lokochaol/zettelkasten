"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BulletJournalLegend } from "@/components/BulletJournalLegend";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { HudFrame } from "@/components/HudFrame";
import { QuickNoteDetailOverlay } from "@/components/QuickNoteDetailOverlay";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { upsertCalendarTaskNoteAction, createQuickNoteForProjectAction } from "@/app/calendar/actions";
import type { TodayProjectNote } from "@/lib/projectTaskNotes";

/** ③カレンダー・今日 — every active project's task note for a given day, all
 * shown fully expanded and editable at once (never a summarized/collapsed
 * list), per spec: "省略した一覧表示ではなく、編集可能な開いた状態で、すべて
 * 表示する". `dateKey` defaults to "today" for the ③今日 tab itself, but this
 * same view is reused to show any day tapped on the ④タイムライン — the
 * selection there is per-day, not per-project. Each project's card also
 * carries a way into its detail page and a way to start a new 走り書き
 * already linked to it. */
export function CalendarTodayView({
  dateKey,
  initialNotes,
  onOpenProject,
}: {
  dateKey: string;
  initialNotes: TodayProjectNote[];
  /** When provided, opening a project's detail calls this instead of
   * navigating to /projects/[id] — used inline within ZettelkastenScreen so
   * the whole flow stays on that one screen. Omitted, this falls back to a
   * real navigation (the standalone /calendar page's own behavior). */
  onOpenProject?: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [creatingForProject, setCreatingForProject] = useState<string | null>(null);
  const [openQuickNoteId, setOpenQuickNoteId] = useState<string | null>(null);

  function openProject(projectId: string) {
    if (onOpenProject) onOpenProject(projectId);
    else router.push(`/projects/${projectId}`);
  }

  async function createQuickNote(projectId: string) {
    setCreatingForProject(projectId);
    try {
      const note = await createQuickNoteForProjectAction(projectId);
      setOpenQuickNoteId(note.id);
    } finally {
      setCreatingForProject(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One legend for the whole day rather than one per project card —
          it's the same notation in every card, and repeating it down the
          column would be the opposite of unobtrusive. */}
      {initialNotes.length > 0 && <BulletJournalLegend />}

      {/* Side by side where there's room: a day's task note is a few lines,
          and one card per full-width row left most of the screen empty. */}
      <div className="@container">
        <div className="grid items-start gap-4 @[640px]:grid-cols-2 @[1000px]:grid-cols-3">
          {initialNotes.map((note) => (
            <HudFrame key={note.projectId} active={false} innerClassName="flex flex-col gap-2 rounded-xl px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-bold text-ink">{note.projectName}</span>
                  {note.isDefault && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent uppercase">
                      {t.projects.defaultBadge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => createQuickNote(note.projectId)}
                    disabled={creatingForProject === note.projectId}
                    className="flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {creatingForProject === note.projectId && <Spinner size="xs" />}
                    {t.calendar.createQuickNoteButton}
                  </button>
                  <button
                    onClick={() => openProject(note.projectId)}
                    className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                  >
                    {t.calendar.openProjectDetail}
                  </button>
                </div>
              </div>
              <MarkdownNoteEditor
                content={note.content}
                // Same key as the project page's editor for this day, so text left
                // unsaved in one place comes back in the other.
                draftKey={`task:${note.projectId}:${dateKey}`}
                onSave={async (content) => {
                  await upsertCalendarTaskNoteAction(note.projectId, dateKey, content);
                }}
              />
            </HudFrame>
          ))}
        </div>
      </div>

      {openQuickNoteId && (
        <QuickNoteDetailOverlay
          noteId={openQuickNoteId}
          onClose={() => setOpenQuickNoteId(null)}
          onContentSaved={() => {}}
        />
      )}
    </div>
  );
}
