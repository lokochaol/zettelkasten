"use client";

import { useState } from "react";
import { applyImportAction, type GoalsOverview, type ImportDraft } from "@/app/goals/actions";
import { ChatThinking } from "@/components/ChatThinking";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Bringing in goals written elsewhere: paste the page, the AI sorts it into
 * the compass, goals and steps, and focus periods, and the result is shown
 * before anything is written. Applying adds to what's here (see
 * goals.applyImport) — it never overwrites.
 */
export function GoalsImportPanel({
  todayKey,
  onClose,
  onImported,
}: {
  todayKey: string;
  onClose: () => void;
  onImported: (overview: GoalsOverview) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ progress: ChatProgress | null; startedAt: number } | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function read() {
    setError(null);
    setDone(null);
    setDraft(null);
    setPending({ progress: null, startedAt: Date.now() });
    try {
      const res = await postChatStream<ImportDraft>(
        "/api/goals/import",
        { text, todayKey },
        (progress) => setPending((p) => (p ? { ...p, progress } : p)),
        t.goals.importFailed,
      );
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
      const res = await applyImportAction(draft);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onImported(res.overview);
      setDraft(null);
      setText("");
      setDone(t.goals.importDone(res.goals, res.periods));
    } catch {
      setError(t.goals.importFailed);
    } finally {
      setApplying(false);
    }
  }

  const compassFilled = draft ? (Object.keys(draft.compass) as (keyof ImportDraft["compass"])[]).filter((k) => draft.compass[k]) : [];

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.goals.importHeading}</p>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="ml-auto font-mono text-[12px] text-ink-faint hover:text-accent">
          ×
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.goals.importIntro}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={t.goals.importPlaceholder}
        disabled={pending !== null}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void read()}
        disabled={!text.trim() || pending !== null}
        className="w-fit rounded-md bg-accent px-4 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
      >
        {pending ? t.goals.importReading : t.goals.importRead}
      </button>

      {pending && (
        <ChatThinking
          progress={pending.progress}
          startedAt={pending.startedAt}
          stageLabel={t.goals.importStage}
          itemsHeading={t.goals.importItemsHeading}
          elapsedLabel={t.meals.chatElapsed}
          itemLabel={(item) => `🚩 ${item.title}`}
        />
      )}

      {draft && (
        <div className="flex flex-col gap-3 rounded-lg border border-line px-3 py-3">
          {draft.summary && <p className="text-[12px] text-ink">{draft.summary}</p>}
          {compassFilled.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {compassFilled.map((k) => (
                <span key={k} className="rounded-full bg-surface-alt px-2 py-0.5 font-mono text-[10px] text-ink-soft">
                  {t.goals.compass[k].title}
                </span>
              ))}
            </div>
          )}
          {draft.goals.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <p className="text-[12.5px] font-bold text-ink">🚩 {g.title}</p>
              {g.milestones.length > 0 && (
                <p className="font-mono text-[10px] text-ink-soft">
                  {g.milestones.map((m) => (m.dueDateKey ? `${m.label} (${m.dueDateKey})` : m.label)).join(" · ")}
                </p>
              )}
            </div>
          ))}
          {draft.periods.map((p, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <p className="text-[12px] font-semibold text-ink">
                {p.label || t.goals.periodUntitled}
                <span className="ml-2 font-mono text-[10px] font-normal text-ink-faint">
                  {p.fromDateKey ?? ""} 〜 {p.toDateKey ?? ""}
                </span>
              </p>
              {(["weekday", "holiday", "spare"] as const).map(
                (slot) =>
                  p[slot].length > 0 && (
                    <p key={slot} className="font-mono text-[10px] text-ink-soft">
                      {t.goals.slot[slot]}: {p[slot].map((l) => [l.goal, l.note].filter(Boolean).join(" - ")).join(" / ")}
                    </p>
                  ),
              )}
            </div>
          ))}
          <p className="text-[10.5px] text-ink-faint">{t.goals.importApplyNote}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying}
              className="rounded-md bg-accent px-4 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
            >
              {applying ? t.goals.importApplying : t.goals.importApply}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md border border-line-strong px-3 py-2 font-mono text-[11px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}
      {done && <p className="text-[11px] text-ink">{done}</p>}
    </section>
  );
}
