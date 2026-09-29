"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { QuickNoteContentSection } from "@/components/QuickNoteContentSection";
import { QuickNoteLiteratureSection } from "@/components/QuickNoteLiteratureSection";
import { QuickNoteProjectSection } from "@/components/QuickNoteProjectSection";
import { getQuickNoteDetailAction } from "@/app/dash-off/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import { useBackdropDismiss } from "@/lib/useBackdropDismiss";
import type { QuickNoteDetail } from "@/lib/quickNotes";
import type { Locale } from "@/lib/i18n/types";

function formatDate(date: Date, locale: Locale) {
  return new Date(date).toLocaleString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The same layout /dash-off/[id] uses (source/date header, content,
 * literature, and project sections) rendered as an overlay inside
 * ZettelkastenScreen's ③ column instead — editing a 走り書き from here never
 * navigates to the real /dash-off/[id] URL, mirroring how NoteDetailOverlay
 * already opens a PermanentNote in-place rather than routing to it.
 */
export function QuickNoteDetailOverlay({
  noteId,
  onClose,
  onContentSaved,
}: {
  noteId: string;
  onClose: () => void;
  /** Notified after a content save so the caller's own summary list (card
   * preview, literature badge) can be kept in sync without a page reload. */
  onContentSaved: (detail: QuickNoteDetail) => void;
}) {
  const { t, locale } = useI18n();
  const { guard } = useUnsavedChanges();
  const [detail, setDetail] = useState<QuickNoteDetail | null>(null);
  /** Closing throws the content editor away, so unsaved edits get a 保存 /
   * 破棄 prompt first — for the backdrop click too, which is the easiest way
   * to lose a buffer by accident. */
  const requestClose = () => guard(onClose);
  const backdrop = useBackdropDismiss(requestClose);

  useEffect(() => {
    let cancelled = false;
    getQuickNoteDetailAction(noteId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-6" {...backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85vh] w-full max-w-[720px] flex-col gap-6 overflow-auto rounded-xl border border-line bg-surface p-6 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]"
      >
        {!detail ? (
          <LoadingBlock label={t.zettelkasten.detailLoading} size="md" />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <p className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">
                  {detail.source === "VOICE" ? t.scratch.sourceVoice : t.scratch.sourceScratch}
                  {detail.status === "ARCHIVED" && <span className="ml-2 text-ink-soft">{t.scratch.archivedSuffix}</span>}
                </p>
                <p className="font-mono text-xs text-ink-soft">
                  {t.scratch.createdLabel(formatDate(detail.encounteredAt, locale))}
                  {"　/　"}
                  {t.scratch.updatedLabel(formatDate(detail.updatedAt, locale))}
                </p>
              </div>
              <button onClick={requestClose} className="shrink-0 font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {t.zettelkasten.detailClose}
              </button>
            </div>

            <section className="flex flex-col gap-3">
              <h3 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
                <span className="text-accent">{"//"}</span> {t.scratch.contentHeading}
              </h3>
              <QuickNoteContentSection noteId={detail.id} content={detail.content} onSaved={onContentSaved} />
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
                <span className="text-accent">{"//"}</span> {t.scratch.literatureHeading}
              </h3>
              <QuickNoteLiteratureSection noteId={detail.id} literatureMemo={detail.literatureMemo} />
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
                <span className="text-accent">{"//"}</span> {t.scratch.projectHeading}
              </h3>
              <QuickNoteProjectSection noteId={detail.id} initialProject={detail.project} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
