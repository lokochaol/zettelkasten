"use client";

import { useEffect, useRef, useState } from "react";
import { applyPlanImportAction } from "@/app/goals/planActions";
import type { AdvisorMessageView } from "@/lib/goalAdvisor";
import type { PlanDraft } from "@/lib/goalPlanImport";
import type { PlanOverview } from "@/lib/goalPlan";
import { ChatThinking } from "@/components/ChatThinking";
import { PILL, PRIMARY, useDay } from "@/components/goals/ui";
import { GOAL_COLORS, tint } from "@/lib/goalColors";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import { useI18n } from "@/lib/i18n/LocaleProvider";

export type ApplyMode = "replace" | "merge";

/**
 * A plan document on its way into the plan: read by the AI into a draft
 * (goalPlanImport.draftPlanImport), the draft shown — areas in their
 * colours, phases with dates, the cycle, the week — and applied either as
 * the whole plan from now on (書き換える) or merged into what's here (追加).
 *
 * Shared by the file import, the advisor's plan documents and the stored
 * 計画書; each hands in the markdown and, for the advisor, its message.
 */
export function PlanDocumentApply({
  markdown,
  messageId,
  todayKey,
  goalCount,
  defaultMode,
  autoRead = false,
  onApplied,
  onCancel,
}: {
  markdown: string;
  messageId?: string;
  todayKey: string;
  /** Goals there already, for the colours new ones will get. */
  goalCount: number;
  defaultMode: ApplyMode;
  /** Start reading as soon as it's shown. */
  autoRead?: boolean;
  onApplied: (result: { overview: PlanOverview; messages: AdvisorMessageView[] | null; message: string }) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const day = useDay();
  const [pending, setPending] = useState<{ progress: ChatProgress | null; startedAt: number } | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [mode, setMode] = useState<ApplyMode>(defaultMode);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const area = draft?.scope === "area";

  async function read(startedAt: number) {
    setError(null);
    setDraft(null);
    setPending({ progress: null, startedAt });
    try {
      const res = await postChatStream<PlanDraft>(
        "/api/goals/plan-import",
        { text: markdown, todayKey },
        (progress) => setPending((p) => (p ? { ...p, progress } : p)),
        t.plan.importFailed,
      );
      if ("error" in res) setError(res.error);
      else setDraft(res.messages[0] ?? null);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (!autoRead || started.current) return;
    started.current = true;
    void read(Date.now());
    // Read once, for the document it was shown with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead]);

  async function apply() {
    if (!draft) return;
    setApplying(true);
    setError(null);
    try {
      const res = await applyPlanImportAction(draft, todayKey, { archiveOthers: mode === "replace", replace: mode === "replace" }, { markdown, messageId });
      if ("error" in res) {
        setError(res.error ?? t.plan.applyFailed);
        return;
      }
      setDraft(null);
      onApplied({ overview: res.overview, messages: res.messages, message: t.plan.importDone(res.counts.goalsCreated, res.counts.goalsUpdated) });
    } catch {
      // The request itself didn't come back (cut off, or the connection dropped).
      setError(t.plan.applyFailed);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!draft && !pending && (
        <div className="flex gap-2">
          <button type="button" onClick={() => void read(Date.now())} disabled={!markdown.trim()} className={`${PRIMARY} px-4 py-2`}>
            {t.plan.importRead}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={PILL}>
              {t.plan.cancel}
            </button>
          )}
        </div>
      )}

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
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-3 py-3">
          {draft.scope === "area" && draft.area && (
            <p className="rounded-md bg-accent/10 px-2 py-1 text-[11.5px] font-semibold text-ink">{t.plan.importPreviewArea(draft.area)}</p>
          )}
          {draft.summary && <p className="text-[12px] leading-relaxed text-ink">{draft.summary}</p>}
          {draft.vision && <p className="border-l-2 border-accent pl-2 text-[11.5px] whitespace-pre-wrap text-ink-soft">{draft.vision}</p>}

          {draft.subPlans.map((sp, i) => {
            const groups = [...new Set(sp.items.map((x) => x.group))];
            return (
              <div key={`sp${i}`} className="flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
                <p className="text-[12.5px] font-bold text-ink">{t.plan.importPreviewSubPlan(sp.title, sp.items.length, sp.steps.length, sp.weeks.length, sp.days.length)}</p>
                {groups.map((g) => (
                  <p key={g} className="text-[11px] leading-relaxed text-ink-soft">
                    <span className="mr-1 font-mono text-[9.5px] text-ink-faint">{g || "—"}</span>
                    {sp.items
                      .filter((x) => x.group === g)
                      .map((x) => `${x.title}${x.size ? ` ${x.size}${sp.unitLabel}` : ""}`)
                      .join("、")}
                  </p>
                ))}
                {sp.steps.filter((x) => x.kind === "DUE").length > 0 && (
                  <p className="font-mono text-[10px] text-ink-faint">
                    {t.plan.stepKind.DUE}:{" "}
                    {sp.steps
                      .filter((x) => x.kind === "DUE")
                      .slice(0, 8)
                      .map((x) => `${day.short(x.dateKey)} ${x.label}`)
                      .join(" / ")}
                  </p>
                )}
              </div>
            );
          })}

          <ul className="flex flex-col gap-2">
            {(draft.scope === "area" ? [] : draft.goals).map((g, i) => {
              const hex = GOAL_COLORS[(goalCount + i) % GOAL_COLORS.length].hex;
              return (
                <li key={i} className="flex flex-col gap-1 border-l-4 pl-2" style={{ borderColor: hex }}>
                  <p className="text-[12.5px] font-bold text-ink">
                    {g.title}
                    {g.weeklyHours > 0 && (
                      <span className="ml-2 font-mono text-[10px] font-normal" style={{ color: hex }}>
                        {t.plan.hoursUnit(g.weeklyHours)}
                      </span>
                    )}
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

          {/* How it goes in: the whole plan (or the area's detailed plan) from now on, or added to what's here. */}
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t.plan.applyModeLabel}>
            {(["replace", "merge"] as ApplyMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left ${mode === m ? "border-accent bg-accent/5" : "border-line hover:border-line-strong"}`}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-bold text-ink">
                  <span className={`h-3 w-3 rounded-full border-2 ${mode === m ? "border-accent bg-accent" : "border-line-strong"}`} />
                  {m === "replace" ? (area ? t.plan.applyReplaceArea : t.plan.applyReplace) : t.plan.applyMerge}
                </span>
                <span className="text-[10.5px] leading-relaxed text-ink-soft">
                  {m === "replace" ? (area ? t.plan.applyReplaceAreaNote : t.plan.applyReplaceNote) : area ? t.plan.applyMergeAreaNote : t.plan.applyMergeNote}
                </span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => void apply()} disabled={applying} className={PRIMARY}>
              {applying ? t.plan.importApplying : t.plan.advisorApply}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                onCancel?.();
              }}
              disabled={applying}
              className={PILL}
            >
              {t.plan.cancel}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-accent">{error}</p>}
    </div>
  );
}

/** Saves a document as a .md file. */
export function downloadMarkdown(markdown: string, name: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "plan"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A document's title: its first heading. */
export function documentTitle(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? "";
}

/** A document's section headings (##), leaving out code blocks such as templates. */
export function documentHeadings(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^## /.test(line)) out.push(line.slice(3).trim());
  }
  return out;
}
