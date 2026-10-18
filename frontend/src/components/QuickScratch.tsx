"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";
import { createQuickNoteWithContentAction } from "@/app/dash-off/actions";
import { readDraft, removeDraft, writeDraft } from "@/lib/draftBackup";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const DRAFT_KEY = "quick-scratch";

/**
 * Write, save, write the next one. The box is focused when the app opens;
 * saving clears it for the next thought and puts what was saved at the top
 * of the list underneath. Unsaved text is kept in this browser
 * (draftBackup), so closing the app mid-sentence loses nothing; offline,
 * the save waits for the connection.
 */
export function QuickScratch({ initialRecent }: { initialRecent: { id: string; preview: string }[] }) {
  const { t } = useI18n();
  const offline = useOffline();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState(initialRecent);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Put back what was left unsaved last time. Read after mount: the server
  // render has no localStorage.
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft = readDraft(DRAFT_KEY);
      if (draft?.value) setText(draft.value);
      boxRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function change(value: string) {
    setText(value);
    setMessage(null);
    if (value.trim()) writeDraft(DRAFT_KEY, value, "");
    else removeDraft(DRAFT_KEY);
  }

  async function save() {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const note = await createQuickNoteWithContentAction(content);
      removeDraft(DRAFT_KEY);
      setText("");
      setRecent((prev) => [{ id: note.id, preview: content.split("\n").find((l) => l.trim())?.trim().slice(0, 200) ?? "" }, ...prev].slice(0, 5));
      setMessage(t.quickApps.saved);
      boxRef.current?.focus();
    } catch {
      setMessage(t.quickApps.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={boxRef}
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          // Enter is a newline (and confirms Japanese conversion);
          // Cmd/Ctrl+Enter saves on a computer.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        rows={7}
        placeholder={t.quickApps.scratchPlaceholder}
        style={{ caretColor: "var(--color-accent)" }}
        className="w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[15px] leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!text.trim() || saving}
          className="btn-sheen rounded-lg bg-accent px-5 py-2.5 font-mono text-[12px] font-semibold text-on-accent disabled:opacity-40"
        >
          {saving ? (offline ? t.common.savingOffline : t.common.saving) : t.common.save}
        </button>
        {message && <span className="font-mono text-[11px] text-accent">{message}</span>}
      </div>

      {recent.length > 0 && (
        <ul className="flex flex-col border-t border-line pt-2">
          <li className="pb-1 font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.quickApps.recent}</li>
          {recent.map((n) => (
            <li key={n.id}>
              <Link href={`/dash-off/${n.id}`} className="block truncate py-1.5 text-[13px] text-ink hover:text-accent">
                {n.preview || t.common.noContent}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
