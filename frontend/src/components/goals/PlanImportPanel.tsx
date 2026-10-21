"use client";

import { useState } from "react";
import { applyPlanImportAction } from "@/app/goals/planActions";
import type { GoalsOverview } from "@/app/goals/actions";
import type { PlanDraft } from "@/lib/goalPlanImport";
import type { PlanOverview } from "@/lib/goalPlan";
import { ChatThinking } from "@/components/ChatThinking";
import { GoalsImportPanel } from "@/components/GoalsImportPanel";
import { PILL, PRIMARY, useDay } from "@/components/goals/ui";
import { GOAL_COLORS, tint } from "@/lib/goalColors";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Bringing in a plan written as a document — the roadmap, the 12 weeks,
 * the standard week, the dates, the open questions. A .md file or pasted
 * text goes to the AI (goalPlanImport.draftPlanImport); what it found is
 * shown before anything is written, and applying merges it into the plan.
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
  const day = useDay();
  const [format, setFormat] = useState<"plan" | "legacy">("plan");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState<{ progress: ChatProgress | null; startedAt: number } | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [archiveOthers, setArchiveOthers] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function read() {
    setError(null);
    setDone(null);
    setDraft(null);
    setPending({ progress: null, startedAt: Date.now() });
    try {
      const res = await postChatStream<PlanDraft>("/api/goals/plan-import", { text, todayKey }, (progress) => setPending((p) => (p ? { ...p, progress } : p)), t.plan.importFailed);
      if ("error" in res) setError(res.error);
      else setDraft(res.messages[0] ?? null);
    } finally {
      setPending(null);
    }
  }

  async function apply() {
    if (!draft) return;
    setApplying(true);
    setError(null);
    try {
      const res = await applyPlanImportAction(draft, todayKey, archiveOthers);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onImported(res.overview);
      setDraft(null);
      setText("");
      setFileName(null);
      setDone(t.plan.importDone(res.counts.goalsCreated, res.counts.goalsUpdated));
    } catch {
      setError(t.plan.importFailed);
    } finally {
      setApplying(false);
    }
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
            disabled={pending !== null}
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
        disabled={pending !== null}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      <button type="button" onClick={() => void read()} disabled={!text.trim() || pending !== null} className={`${PRIMARY} w-fit px-4 py-2`}>
        {pending ? t.plan.importReading : t.plan.importRead}
      </button>

      {pending && (
        <ChatThinking
          progress={pending.progress}
          startedAt={pending.startedAt}
          stageLabel={t.plan.importStage}
          itemsHeading={t.plan.importItems}
          elapsedLabel={t.meals.chatElapsed}
          itemLabel={(item) => item.title}
        />
      )}

      {draft && (
        <div className="flex flex-col gap-3 rounded-lg border border-line px-3 py-3">
          {draft.summary && <p className="text-[12px] leading-relaxed text-ink">{draft.summary}</p>}
          {draft.vision && <p className="border-l-2 border-accent pl-2 text-[11.5px] text-ink-soft">{draft.vision}</p>}

          <ul className="flex flex-col gap-2">
            {draft.goals.map((g, i) => {
              const hex = GOAL_COLORS[(goalCount + i) % GOAL_COLORS.length].hex;
              return (
                <li key={i} className="flex flex-col gap-1 border-l-4 pl-2" style={{ borderColor: hex }}>
                  <p className="text-[12.5px] font-bold text-ink">
                    {g.title}
                    {g.weeklyHours > 0 && <span className="ml-2 font-mono text-[10px] font-normal" style={{ color: hex }}>{t.plan.hoursUnit(g.weeklyHours)}</span>}
                  </p>
                  {g.phases.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {g.phases.map((p, j) => (
                        <span key={j} className="rounded px-1.5 py-0.5 font-mono text-[9.5px] text-ink" style={{ background: tint(hex, 0.16) }}>
                          {p.label}
                          {(p.startDateKey || p.dueDateKey) && (
                            <span className="ml-1 text-ink-faint">
                              {p.startDateKey ? day.short(p.startDateKey) : ""}→{p.dueDateKey ? day.short(p.dueDateKey) : ""}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-1.5">
            {[
              t.plan.importPreviewGoals(draft.goals.length),
              t.plan.importPreviewPhases(draft.goals.reduce((a, g) => a + g.phases.length, 0)),
              draft.cycle && t.plan.importPreviewCycle(draft.cycle.label, day.short(draft.cycle.fromDateKey), day.short(draft.cycle.toDateKey), draft.cycle.outcomes.length),
              draft.slots.length > 0 && t.plan.importPreviewSlots(draft.slots.length),
              draft.events.length > 0 && t.plan.importPreviewEvents(draft.events.length),
              draft.checks.length > 0 && t.plan.importPreviewChecks(draft.checks.length),
              draft.tasks.length > 0 && t.plan.importPreviewTasks(draft.tasks.length),
              draft.lifeBudget.length > 0 && t.plan.importPreviewBudget(draft.lifeBudget.length),
            ]
              .filter(Boolean)
              .map((label) => (
                <span key={label as string} className="rounded-full bg-surface-alt px-2 py-0.5 font-mono text-[10px] text-ink-soft">
                  {label}
                </span>
              ))}
          </div>

          <p className="text-[10.5px] leading-relaxed text-ink-faint">{t.plan.importNote}</p>
          <label className="flex items-start gap-2 text-[11.5px] text-ink-soft">
            <input type="checkbox" checked={archiveOthers} onChange={(e) => setArchiveOthers(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
            {t.plan.importArchive}
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void apply()} disabled={applying} className={PRIMARY}>
              {applying ? t.plan.importApplying : t.plan.importApply}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={applying} className={PILL}>
              {t.plan.cancel}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-accent">{error}</p>}
      {done && <p className="text-[11.5px] text-ink">{done}</p>}
    </section>
  );
}
