"use client";

import { useState, type CSSProperties } from "react";
import {
  addMilestoneAction,
  deleteMilestoneAction,
  deleteRevisionAction,
  moveMilestoneAction,
  reviewGoalAction,
  updateGoalAction,
  updateMilestoneAction,
  type GoalView,
  type MilestoneView,
} from "@/app/goals/actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { HORIZON_PRESETS, horizonDateKey } from "@/lib/goalFocus";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";

const INPUT =
  "rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none";
const PILL =
  "rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50";

/** Throws the action's error, so MarkdownNoteEditor shows the save as failed
 * and keeps the text. */
function orThrow<T extends object>(res: T | { error: string }): T {
  if ("error" in res) throw new Error(res.error);
  return res;
}

/**
 * One 🚩: the title, what it means, and the steps at each horizon — each
 * step a note of its own, with a date when the horizon has one.
 *
 * 見直す keeps the goal as it stands (GoalRevision) and dates the review
 * today; after that the goal is simply edited. The kept versions are under
 * 過去の版, so last year's "1年後" can be read next to this year's.
 */
export function GoalCard({
  goal,
  todayKey,
  isFirst,
  isLast,
  onChange,
  onMove,
  onDelete,
}: {
  goal: GoalView;
  todayKey: string;
  isFirst: boolean;
  isLast: boolean;
  onChange: (goal: GoalView) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState(goal.title);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReview, setConfirmReview] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const archived = goal.status === "ARCHIVED";
  const day = (key: string) => formatDateKey(key, localeTag(locale), { year: "numeric", month: "numeric", day: "numeric" });

  async function patch(p: Parameters<typeof updateGoalAction>[1]) {
    setError(null);
    const res = await updateGoalAction(goal.id, p);
    if ("error" in res) setError(res.error);
    else onChange(res.goal);
  }

  function saveTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(goal.title);
      return;
    }
    if (next !== goal.title) void patch({ title: next });
  }

  async function review() {
    setBusy(true);
    setError(null);
    try {
      const res = await reviewGoalAction(goal.id, todayKey);
      if ("error" in res) setError(res.error);
      else onChange(res.goal);
    } finally {
      setBusy(false);
      setConfirmReview(false);
    }
  }

  async function addMilestone(label: string) {
    setError(null);
    const due = horizonDateKey(label, goal.reviewedOnDateKey ?? todayKey);
    const res = await addMilestoneAction(goal.id, label, due);
    if ("error" in res) setError(res.error);
    else onChange({ ...goal, milestones: [...goal.milestones, res.milestone] });
  }

  function replaceMilestone(next: MilestoneView) {
    onChange({ ...goal, milestones: goal.milestones.map((m) => (m.id === next.id ? next : m)) });
  }

  async function patchMilestone(m: MilestoneView, p: Parameters<typeof updateMilestoneAction>[1]) {
    setError(null);
    const res = await updateMilestoneAction(m.id, p);
    if ("error" in res) {
      setError(res.error);
      // The editor needs to hear it failed, to keep the text as unsaved.
      if (p.body !== undefined) throw new Error(res.error);
    } else replaceMilestone(res.milestone);
  }

  async function moveMilestone(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= goal.milestones.length) return;
    const next = [...goal.milestones];
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ ...goal, milestones: next });
    await moveMilestoneAction(goal.milestones[index].id, direction);
  }

  async function removeMilestone(m: MilestoneView) {
    onChange({ ...goal, milestones: goal.milestones.filter((x) => x.id !== m.id) });
    await deleteMilestoneAction(m.id);
  }

  async function removeRevision(id: string) {
    onChange({ ...goal, revisions: goal.revisions.filter((r) => r.id !== id) });
    await deleteRevisionAction(id);
  }

  const doneCount = goal.milestones.filter((m) => m.done).length;

  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 ${archived ? "border-line opacity-80" : "border-line-strong"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t.goals.collapse : t.goals.expand}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-alt hover:text-accent"
        >
          <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </button>
        <span aria-hidden="true" className="text-base">
          🚩
        </span>
        {/* A textarea so a long goal wraps instead of being cut off on a
            phone; Enter still ends the edit, as in a one-line field. */}
        <textarea
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label={t.goals.titleLabel}
          style={{ fieldSizing: "content" } as CSSProperties}
          className="min-w-0 flex-1 resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] leading-snug font-bold text-ink hover:border-line focus:border-accent focus:outline-none"
        />
        {goal.milestones.length > 0 && (
          <span className="font-mono text-[10px] text-ink-faint">{t.goals.stepsDone(doneCount, goal.milestones.length)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:pl-8">
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-soft">
          {t.goals.reviewedOn}
          <input
            type="date"
            value={goal.reviewedOnDateKey ?? ""}
            onChange={(e) => void patch({ reviewedOnDateKey: e.target.value || null })}
            className={INPUT}
          />
        </label>
        {!archived && (
          <button type="button" onClick={() => setConfirmReview(true)} disabled={busy} className={PILL}>
            {t.goals.review}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!archived && (
            <>
              <button type="button" onClick={() => onMove(-1)} disabled={isFirst} aria-label={t.goals.moveUp} className={PILL}>
                ↑
              </button>
              <button type="button" onClick={() => onMove(1)} disabled={isLast} aria-label={t.goals.moveDown} className={PILL}>
                ↓
              </button>
            </>
          )}
          <button type="button" onClick={() => void patch({ status: archived ? "ACTIVE" : "ARCHIVED" })} className={PILL}>
            {archived ? t.goals.unarchive : t.goals.archive}
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className={PILL}>
            {t.common.delete}
          </button>
        </div>
      </div>
      {error && <p className="text-[11px] text-accent sm:pl-8">{error}</p>}

      {open && (
        <div className="flex flex-col gap-4 sm:pl-8">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{t.goals.statementLabel}</p>
            <MarkdownNoteEditor
              content={goal.statement}
              draftKey={`goal:${goal.id}:statement`}
              onSave={async (content) => {
                onChange(orThrow(await updateGoalAction(goal.id, { statement: content })).goal);
              }}
            />
          </div>

          {/* The steps, nearest horizon first as the owner orders them. A
              left rule ties them together as one path. */}
          <div className="flex flex-col gap-3 border-l-2 border-line pl-3">
            {goal.milestones.map((m, i) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                todayKey={todayKey}
                isFirst={i === 0}
                isLast={i === goal.milestones.length - 1}
                onPatch={(p) => patchMilestone(m, p)}
                onMove={(d) => void moveMilestone(i, d)}
                onDelete={() => void removeMilestone(m)}
              />
            ))}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-ink-faint">{t.goals.addStep}</span>
              {HORIZON_PRESETS.map((label) => (
                <button key={label} type="button" onClick={() => void addMilestone(label)} className={PILL}>
                  {label}
                </button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customLabel.trim()) return;
                  void addMilestone(customLabel.trim());
                  setCustomLabel("");
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder={t.goals.customStepPlaceholder}
                  className={`${INPUT} w-28`}
                />
                <button type="submit" className={PILL}>
                  {t.common.add}
                </button>
              </form>
            </div>
          </div>

          {goal.revisions.length > 0 && (
            <details className="rounded-lg border border-line px-3 py-2">
              <summary className="cursor-pointer font-mono text-[10px] text-ink-soft">{t.goals.revisionsHeading(goal.revisions.length)}</summary>
              <div className="mt-2 flex flex-col gap-3">
                {goal.revisions.map((r) => (
                  <div key={r.id} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-ink-soft">{t.goals.revisionUntil(day(r.dateKey))}</span>
                      <button type="button" onClick={() => void removeRevision(r.id)} className={`${PILL} ml-auto`}>
                        {t.common.delete}
                      </button>
                    </div>
                    <p className="text-[12px] font-bold text-ink-soft">
                      {r.snapshot.title}
                      {r.snapshot.reviewedOnDateKey && (
                        <span className="ml-2 font-mono text-[10px] font-normal text-ink-faint">{day(r.snapshot.reviewedOnDateKey)}</span>
                      )}
                    </p>
                    {r.snapshot.statement && <p className="text-[11.5px] whitespace-pre-wrap text-ink-soft">{r.snapshot.statement}</p>}
                    {r.snapshot.milestones.map((m, i) => (
                      <div key={i} className="flex flex-col">
                        <p className="font-mono text-[10px] text-accent">
                          {m.done ? "✓ " : ""}
                          {m.label}
                          {m.dueDateKey && <span className="ml-2 text-ink-faint">{day(m.dueDateKey)}</span>}
                        </p>
                        {m.body && <p className="text-[11.5px] whitespace-pre-wrap text-ink-soft">{m.body}</p>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmReview}
        title={t.goals.reviewConfirmTitle}
        warning={t.goals.reviewConfirmBody}
        confirmLabel={t.goals.review}
        confirmPending={busy}
        onConfirm={() => void review()}
        onCancel={() => setConfirmReview(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t.goals.deleteConfirmTitle(goal.title)}
        warning={t.goals.deleteConfirmBody}
        confirmLabel={t.common.delete}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}

function MilestoneRow({
  milestone,
  todayKey,
  isFirst,
  isLast,
  onPatch,
  onMove,
  onDelete,
}: {
  milestone: MilestoneView;
  todayKey: string;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (p: Parameters<typeof updateMilestoneAction>[1]) => Promise<void>;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(milestone.label);
  const overdue = !milestone.done && milestone.dueDateKey !== null && milestone.dueDateKey < todayKey;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={milestone.done}
          onChange={(e) => void onPatch({ done: e.target.checked })}
          aria-label={t.goals.stepDone}
          className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() !== milestone.label && void onPatch({ label })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
          placeholder={t.goals.stepLabelPlaceholder}
          aria-label={t.goals.stepLabel}
          className={`min-w-0 flex-1 basis-32 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[12px] font-semibold hover:border-line focus:border-accent focus:outline-none ${
            milestone.done ? "text-ink-faint line-through" : "text-accent"
          }`}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <input
            type="date"
            value={milestone.dueDateKey ?? ""}
            onChange={(e) => void onPatch({ dueDateKey: e.target.value || null })}
            aria-label={t.goals.stepDue}
            className={`${INPUT} ${overdue ? "border-accent text-accent" : ""}`}
          />
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst} aria-label={t.goals.moveUp} className={PILL}>
            ↑
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} aria-label={t.goals.moveDown} className={PILL}>
            ↓
          </button>
          <button type="button" onClick={onDelete} aria-label={t.common.delete} className={PILL}>
            ×
          </button>
        </div>
      </div>
      <MarkdownNoteEditor
        content={milestone.body}
        draftKey={`goal-step:${milestone.id}`}
        onSave={async (content) => {
          await onPatch({ body: content });
        }}
      />
    </div>
  );
}
