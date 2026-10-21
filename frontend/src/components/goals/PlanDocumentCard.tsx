"use client";

import { useState } from "react";
import { getPlanDocumentAction, savePlanDocumentAction } from "@/app/goals/planActions";
import type { PlanDocumentView } from "@/lib/goalPlan";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { PlanDocumentApply, documentHeadings, documentTitle, downloadMarkdown } from "@/components/goals/PlanDocumentApply";
import { Card, PILL, PRIMARY, okOr, useDay, type TabProps } from "@/components/goals/ui";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * 計画書 — the plan as one document, the way it was talked through or
 * written: the advisor's, an imported file, or edited here. Each change is
 * kept as a version. Rebuilding reads the document back into the plan.
 */
export function PlanDocumentCard({ ov, setOv, todayKey, generation, onError, openAdvisor, openImport }: TabProps) {
  const { t } = useI18n();
  const day = useDay();
  const doc = ov.document;
  const [open, setOpen] = useState(false);
  const [rebuild, setRebuild] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PlanDocumentView | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const meta = (d: { createdOn: string; source: string; applied: string }) =>
    `${day.full(d.createdOn)} · ${t.plan.documentSource[d.source] ?? d.source} · ${t.plan.documentApplied[d.applied] ?? d.applied}`;

  if (!doc) {
    return (
      <Card title={t.plan.documentHeading} intro={t.plan.documentEmpty}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openAdvisor(t.plan.startPrompt)} className={PRIMARY}>
            ✦ {t.plan.startChat}
          </button>
          <button type="button" onClick={openImport} className={PILL}>
            {t.plan.startImport}
          </button>
        </div>
      </Card>
    );
  }

  const title = documentTitle(doc.markdown) || t.plan.documentHeading;
  const headings = documentHeadings(doc.markdown);

  return (
    <Card
      title={t.plan.documentHeading}
      intro={t.plan.documentIntro}
      action={
        <button type="button" onClick={() => downloadMarkdown(doc.markdown, title)} className={PILL}>
          {t.plan.download}
        </button>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-bold text-ink">{title}</p>
        <p className="font-mono text-[10px] text-ink-faint">{meta(doc)}</p>
      </div>
      {headings.length > 0 && (
        <ol className="gap-x-6 border-l-2 border-accent/40 pl-2 sm:columns-2">
          {headings.map((h, i) => (
            <li key={i} className="truncate text-[11px] text-ink-soft">
              {h}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className={PILL}>
          {open ? `▲ ${t.plan.hideFull}` : `▼ ${t.plan.showFull}`}
        </button>
        <button type="button" onClick={() => setRebuild(doc.markdown)} className={PILL}>
          {t.plan.documentRebuild}
        </button>
        <button type="button" onClick={() => openAdvisor(t.plan.documentDiscussPrompt)} className={PILL}>
          ✦ {t.plan.documentDiscuss}
        </button>
      </div>
      {open && (
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-line p-1">
          <MarkdownNoteEditor
            key={`${doc.id}:${generation}`}
            content={doc.markdown}
            draftKey="goal-plan-document"
            onSave={async (markdown) => {
              const res = await savePlanDocumentAction(markdown);
              if ("error" in res) {
                onError(res.error);
                throw new Error(res.error);
              }
              setOv((o) => ({
                ...o,
                document: res.document,
                documentVersions:
                  o.document && o.document.id !== res.document.id
                    ? [{ id: o.document.id, source: o.document.source, applied: o.document.applied, createdOn: o.document.createdOn, chars: o.document.markdown.length }, ...o.documentVersions]
                    : o.documentVersions,
              }));
            }}
          />
        </div>
      )}
      {rebuild !== null && (
        <PlanDocumentApply
          markdown={rebuild}
          todayKey={todayKey}
          goalCount={ov.goals.length}
          defaultMode="replace"
          autoRead
          onApplied={(r) => {
            setRebuild(null);
            setDone(r.message);
            setOv(() => r.overview);
          }}
          onCancel={() => setRebuild(null)}
        />
      )}
      {done && <p className="text-[11.5px] text-ink">{done}</p>}

      {ov.documentVersions.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">{t.plan.documentVersions(ov.documentVersions.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {ov.documentVersions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-soft">
                <span>{meta(v)}</span>
                <span className="text-ink-faint">{t.plan.advisorDocumentChars(v.chars)}</span>
                <button
                  type="button"
                  onClick={async () => {
                    const res = okOr(await getPlanDocumentAction(v.id), onError);
                    if (res) setViewing(res.document);
                  }}
                  className={PILL}
                >
                  {t.plan.documentOpen}
                </button>
              </li>
            ))}
          </ul>
          {viewing && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-ink-faint">{meta(viewing)}</span>
                <button type="button" onClick={() => downloadMarkdown(viewing.markdown, documentTitle(viewing.markdown) || "plan")} className={`${PILL} ml-auto`}>
                  {t.plan.download}
                </button>
                <button type="button" onClick={() => setRebuild(viewing.markdown)} className={PILL}>
                  {t.plan.documentRebuild}
                </button>
                <button type="button" onClick={() => setViewing(null)} aria-label={t.plan.close} className="font-mono text-[12px] text-ink-faint hover:text-accent">
                  ×
                </button>
              </div>
              <pre className="max-h-80 overflow-auto font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink">{viewing.markdown}</pre>
            </div>
          )}
        </details>
      )}
    </Card>
  );
}
