"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Spinner } from "@/components/LoadingSpinner";
import { removeLiteratureMemoAction, updateLiteratureMemoDetailsAction } from "@/app/literature/actions";
import type { LiteratureMemoDetail as LiteratureMemoDetailType } from "@/lib/literatureMemos";
import { useI18n } from "@/lib/i18n/LocaleProvider";

export function LiteratureMemoDetail({ initialDetail }: { initialDetail: LiteratureMemoDetailType }) {
  const router = useRouter();
  const { t } = useI18n();
  const [detail, setDetail] = useState(initialDetail);
  const [citation, setCitation] = useState(initialDetail.citation);
  const [url, setUrl] = useState(initialDetail.url ?? "");
  const [summary, setSummary] = useState(initialDetail.summary ?? "");
  const [savePending, startSaveTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();

  function save() {
    startSaveTransition(async () => {
      const updated = await updateLiteratureMemoDetailsAction(detail.id, {
        citation,
        url: url.trim() || null,
        summary,
      });
      setDetail(updated);
      setCitation(updated.citation);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function remove() {
    startDeleteTransition(async () => {
      await removeLiteratureMemoAction(detail.id);
      router.push("/literature");
    });
  }

  return (
    <div className="relative flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">
          {t.literature.heading}{detail.zoteroKey && <span className="ml-2 text-ink-soft">{t.literature.zoteroLinkedSuffix}</span>}
        </p>
        <input
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          placeholder={t.literature.citationPlaceholder}
          className="w-full rounded-lg border border-line bg-surface-alt px-3 py-2 text-2xl font-extrabold tracking-tight text-ink focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.literature.urlPlaceholder}
            className="w-full rounded-lg border border-line bg-surface-alt px-3 py-1.5 font-mono text-xs text-ink-soft focus:border-accent focus:outline-none"
          />
          {url.trim() && (
            <a
              href={url.trim()}
              target="_blank"
              rel="noreferrer"
              aria-label={t.literature.openUrlAriaLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-accent/60 hover:text-accent"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3M9.5 2H14v4.5M14 2 7 9"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.literature.summaryHeading}
        </h2>
        <p className="font-mono text-[10px] text-ink-faint">{t.literature.summaryHint}</p>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          className="w-full resize-none rounded-lg border border-line bg-surface-alt px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="flex justify-end">
          <button
            disabled={savePending || !citation.trim()}
            onClick={save}
            className="btn-sheen flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
          >
            {savePending && <Spinner size="xs" />}
            {savePending ? t.common.saving : saved ? t.common.saved : t.common.save}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.literature.permanentNotesHeading(detail.permanentNotes.length)}
        </h2>
        {detail.permanentNotes.length === 0 ? (
          <p className="font-mono text-xs text-ink-soft">{t.literature.noneYet}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {detail.permanentNotes.map((n) => (
              <Link
                key={n.id}
                href={`/zettelkasten?open=${n.id}`}
                className="rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm text-ink transition-colors hover:border-accent/60"
              >
                {n.title}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.literature.quickNotesHeading(detail.quickNotes.length)}
        </h2>
        {detail.quickNotes.length === 0 ? (
          <p className="font-mono text-xs text-ink-soft">{t.literature.noneYet}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {detail.quickNotes.map((n) => (
              <Link
                key={n.id}
                href={`/dash-off/${n.id}`}
                className="rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm text-ink transition-colors hover:border-accent/60"
              >
                {n.preview || t.common.noContent}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex justify-end border-t border-line pt-5">
        <button
          onClick={() => setConfirmOpen(true)}
          className="font-mono text-[10.5px] text-ink-soft transition-colors hover:text-accent"
        >
          {t.literature.deleteButton}
        </button>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={t.literature.deleteConfirmTitle}
        warning={t.literature.deleteConfirmWarning(detail.quickNotes.length, detail.permanentNotes.length)}
        confirmLabel={t.common.delete}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={remove}
        confirmDisabled={deletePending}
        confirmPending={deletePending}
      />
    </div>
  );
}
