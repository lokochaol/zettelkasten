"use client";

import { useRef, useState } from "react";
import { useOffline } from "next/offline";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { PendingLiteratureMemoField } from "@/components/PendingLiteratureMemoField";
import { createQuickNoteWithContentAction, updateQuickNoteContentAction, setLiteratureMemoAction } from "@/app/dash-off/actions";
import type { LiteratureSelection } from "@/lib/literatureMemos";
import type { QuickNoteSummary } from "@/lib/quickNotes";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";

function previewFrom(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? "";
}

/**
 * A new 走り書き's compose surface — a full-screen overlay laid out just
 * like the real /dash-off/[id] detail page, rather than a small inline card
 * sitting in the timeline among other notes. All editing lives on "the
 * detail screen" this way, even for a note that doesn't have a real route
 * yet: this mirrors that page's structure/width instead of an actual
 * navigation, specifically so it can render instantly and accept typing
 * offline (a real `router.push` would sit pending until connectivity
 * returns, same as any Next.js navigation under experimental.useOffline —
 * exactly the immediacy this is meant to preserve).
 *
 * The very first save has to *create* the note; every one after that just
 * replaces its content. `onCreated` fires once, right when that first save
 * lands, so the owner ScratchTimeline can add it to the synced notes list —
 * but this overlay itself stays open and editable regardless, so a save
 * landing never yanks the screen out from under whoever's still writing.
 */
export function NewQuickNoteOverlay({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (note: QuickNoteSummary) => void;
}) {
  const { t } = useI18n();
  const { guard } = useUnsavedChanges();
  const isOffline = useOffline();
  const noteIdRef = useRef<string | null>(null);
  const [literatureSelection, setLiteratureSelectionState] = useState<LiteratureSelection | null>(null);

  async function handleSave(content: string) {
    if (!noteIdRef.current) {
      const note = await createQuickNoteWithContentAction(content, literatureSelection);
      noteIdRef.current = note.id;
      onCreated({
        id: note.id,
        source: note.source,
        encounteredAt: note.encounteredAt,
        preview: previewFrom(note.content),
        hasLiterature: !!note.literatureMemo,
        literatureCitation: note.literatureMemo?.citation ?? null,
      });
    } else {
      await updateQuickNoteContentAction(noteIdRef.current, content);
    }
  }

  async function handleLiteratureChange(selection: LiteratureSelection | null) {
    setLiteratureSelectionState(selection);
    if (noteIdRef.current) {
      await setLiteratureMemoAction(noteIdRef.current, selection ?? { type: "none" });
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center overflow-y-auto bg-bg px-6 py-16">
      <div className="flex w-full max-w-[860px] flex-col gap-8">
        <button
          onClick={() => guard(onClose)}
          className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
        >
          <span className="text-accent">&lt;</span> {t.nav.backToScratch}
        </button>

        <p className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">{t.scratch.sourceScratch}</p>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {t.scratch.contentHeading}
          </h2>
          <MarkdownNoteEditor
            content=""
            onSave={handleSave}
            savingLabelOverride={isOffline ? t.common.savingOffline : undefined}
            draftKey="quicknote:new"
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {t.scratch.literatureHeading}
          </h2>
          <PendingLiteratureMemoField selection={literatureSelection} onChange={handleLiteratureChange} />
        </section>
      </div>
    </div>
  );
}
