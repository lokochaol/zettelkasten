"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Small corner button (outside the note card, top-right) that expands into
 * an 編集/削除 menu — used on both /dash-off's timeline and Zettelkasten's ③
 * column so every quick-note card has the same action entry point. Deliberately
 * overlaps outside the card rather than sitting inside it; the list
 * containers that render these cards reserve horizontal padding on both
 * sides specifically so this has room to spill over without overflowing the
 * viewport (see ScratchTimeline / QuickNoteInlineTimeline).
 */
export function QuickNoteActionMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="absolute -top-2.5 -right-2.5 z-10">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t.quickNoteActionMenu.actionsAriaLabel}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/60 bg-surface text-accent shadow-[0_0_10px_-3px_var(--color-accent)] transition-transform hover:scale-110"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </button>

      {open && (
        <div className="absolute top-8 right-0 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)]">
          <button
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="whitespace-nowrap px-3.5 py-2 text-left font-mono text-[10.5px] text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
          >
            {t.common.edit}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="whitespace-nowrap border-t border-line px-3.5 py-2 text-left font-mono text-[10.5px] text-ink-soft transition-colors hover:bg-surface-alt hover:text-accent"
          >
            {t.common.delete}
          </button>
        </div>
      )}
    </div>
  );
}
