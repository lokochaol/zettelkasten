"use client";

import { useState } from "react";
import { LiteratureMemoPicker } from "@/components/LiteratureMemoPicker";
import type { LiteratureSelection } from "@/lib/literatureMemos";
import { useI18n } from "@/lib/i18n/LocaleProvider";

function citationOf(selection: LiteratureSelection): string | null {
  if (selection.type === "zotero" || selection.type === "manual") return selection.citation;
  if (selection.type === "existing") return selection.citation ?? null;
  return null;
}

function urlOf(selection: LiteratureSelection): string | null {
  return selection.type === "zotero" || selection.type === "manual" ? selection.url : null;
}

/**
 * 文献メモ linking for a not-yet-created 走り書き — same picker
 * (LiteratureMemoPicker) as the /dash-off/[id] detail page's
 * LiteratureMemoField, but there's no note id yet to persist a link
 * against, so this just holds the picked LiteratureSelection as plain local
 * state. NewQuickNoteOverlay passes it to createQuickNoteWithContentAction,
 * which resolves it (dedup included, same as the detail page's
 * setLiteratureMemoAction) at the moment the note itself is created. */
export function PendingLiteratureMemoField({
  selection,
  onChange,
}: {
  selection: LiteratureSelection | null;
  onChange: (selection: LiteratureSelection | null) => void;
}) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (selection && !pickerOpen) {
    const citation = citationOf(selection);
    const url = urlOf(selection);
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {citation && <p className="text-xs font-semibold break-words text-ink">{citation}</p>}
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="block font-mono text-[10.5px] text-accent underline break-all">
                {url}
              </a>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setPickerOpen(true)} className="font-mono text-[10px] text-ink-soft hover:text-accent">
              {t.common.change}
            </button>
            <button onClick={() => onChange(null)} className="font-mono text-[10px] text-ink-soft hover:text-accent">
              {t.literatureField.remove}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!selection && !pickerOpen) {
    return (
      <button
        onClick={() => setPickerOpen(true)}
        className="w-fit rounded-lg border border-dashed border-line px-3 py-2 text-left font-mono text-[10.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
      >
        {t.literatureField.linkButton}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {selection && (
        <button onClick={() => setPickerOpen(false)} className="w-fit font-mono text-[10px] text-ink-soft hover:text-accent">
          ✕ {t.common.cancel}
        </button>
      )}
      <LiteratureMemoPicker
        onPick={(picked) => {
          onChange(picked);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
