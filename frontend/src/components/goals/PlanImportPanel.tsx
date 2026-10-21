"use client";

import { useState } from "react";
import type { GoalsOverview } from "@/app/goals/actions";
import type { PlanOverview } from "@/lib/goalPlan";
import { GoalsImportPanel } from "@/components/GoalsImportPanel";
import { PlanDocumentApply } from "@/components/goals/PlanDocumentApply";
import { PILL } from "@/components/goals/ui";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Bringing in a plan written as a document — the roadmap, the 12 weeks,
 * the standard week, the dates, the open questions. A .md file or pasted
 * text goes to the AI (goalPlanImport.draftPlanImport); what it found is
 * shown before anything is written (PlanDocumentApply), and the document is
 * kept as a version of the 計画書.
 *
 * The earlier import (compass and focus periods) is still here, as the
 * second format.
 */
export function PlanImportPanel({
  todayKey,
  goalCount,
  onClose,
  onImported,
  onLegacyImported,
}: {
  todayKey: string;
  goalCount: number;
  onClose: () => void;
  onImported: (ov: PlanOverview) => void;
  onLegacyImported: (ov: GoalsOverview) => void;
}) {
  const { t } = useI18n();
  const [format, setFormat] = useState<"plan" | "legacy">("plan");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (format === "legacy") {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setFormat("plan")} className={`${PILL} w-fit`}>
          ← {t.plan.importHeading}
        </button>
        <GoalsImportPanel todayKey={todayKey} onClose={onClose} onImported={onLegacyImported} />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.plan.importHeading}</p>
        <button type="button" onClick={() => setFormat("legacy")} className="ml-auto font-mono text-[10px] text-ink-faint hover:text-accent">
          {t.goals.importHeading} →
        </button>
        <button type="button" onClick={onClose} aria-label={t.plan.close} className="font-mono text-[12px] text-ink-faint hover:text-accent">
          ×
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.plan.importIntro}</p>

      <div className="flex flex-wrap items-center gap-2">
        <label className={`${PILL} cursor-pointer`}>
          {t.plan.importFile}
          <input
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setText(await file.text());
              setFileName(file.name);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && <span className="font-mono text-[10.5px] text-ink-soft">{fileName}</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={text ? 10 : 5}
        placeholder={t.plan.importPlaceholder}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      {text.trim() && (
        <PlanDocumentApply
          key={text}
          markdown={text}
          todayKey={todayKey}
          goalCount={goalCount}
          defaultMode={goalCount > 0 ? "merge" : "replace"}
          onApplied={(r) => {
            onImported(r.overview);
            setText("");
            setFileName(null);
            setDone(r.message);
          }}
        />
      )}
      {done && <p className="text-[11.5px] text-ink">{done}</p>}
    </section>
  );
}
