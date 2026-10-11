"use client";

import { useState } from "react";
import { deleteFocusPeriodAction, saveFocusPeriodAction, type FocusPeriodView, type GoalView } from "@/app/goals/actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useRegisterUnsavedEditor } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import type { FocusLine, FocusSlot } from "@/lib/goals";

const SLOTS: FocusSlot[] = ["weekday", "holiday", "spare"];
const INPUT =
  "rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink focus:border-accent focus:outline-none";
const PILL =
  "rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50";

type Draft = Omit<FocusPeriodView, "id">;

function draftOf(p: FocusPeriodView): Draft {
  return { label: p.label, fromDateKey: p.fromDateKey, toDateKey: p.toDateKey, weekday: p.weekday, holiday: p.holiday, spare: p.spare };
}

/**
 * One stretch of days and what each kind of day in it goes to — "7/1以降:
 * 平日は 🚩英語 (IELTS) と 🚩仕事 (面接)". Edited as a small form and saved
 * as a whole; leaving with it unsaved asks first, like the notes do.
 */
export function FocusPeriodCard({
  period,
  goals,
  current,
  todayKind,
  onSaved,
  onDeleted,
}: {
  period: FocusPeriodView;
  /** Active goals, for the pickers. */
  goals: GoalView[];
  /** This is the period the calendar is using today. */
  current: boolean;
  todayKind: "weekday" | "holiday";
  onSaved: (period: FocusPeriodView) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftOf(period));
  const [saved, setSaved] = useState<Draft>(() => draftOf(period));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await saveFocusPeriodAction(period.id, draft);
      if ("error" in res) {
        setError(res.error);
        throw new Error(res.error);
      }
      const next = draftOf(res.period);
      setDraft(next);
      setSaved(next);
      onSaved(res.period);
    } finally {
      setSaving(false);
    }
  }

  useRegisterUnsavedEditor({ isDirty: () => dirty, save, discard: () => setDraft(saved) });

  const setLines = (slot: FocusSlot, lines: FocusLine[]) => setDraft((d) => ({ ...d, [slot]: lines }));
  const goalTitle = (id: string | null) => goals.find((g) => g.id === id)?.title;

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 ${current ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder={t.goals.periodLabelPlaceholder}
          aria-label={t.goals.periodLabel}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-bold text-ink hover:border-line focus:border-accent focus:outline-none"
        />
        {current && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent uppercase">
            {t.goals.periodCurrent}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-soft">
        <input
          type="date"
          value={draft.fromDateKey ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, fromDateKey: e.target.value || null }))}
          aria-label={t.goals.periodFrom}
          className={INPUT}
        />
        <span>〜</span>
        <input
          type="date"
          value={draft.toDateKey ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, toDateKey: e.target.value || null }))}
          aria-label={t.goals.periodTo}
          className={INPUT}
        />
        <span className="text-ink-faint">{t.goals.periodOpenHint}</span>
      </div>

      <div className="@container">
        <div className="grid gap-3 @[640px]:grid-cols-3">
          {SLOTS.map((slot) => (
            <div
              key={slot}
              className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${current && (slot === todayKind || slot === "spare") ? "border-accent/50 bg-accent/5" : "border-line"}`}
            >
              <p className="font-mono text-[10px] font-semibold tracking-wider text-ink-soft">{t.goals.slot[slot]}</p>
              {draft[slot].map((line, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <select
                      value={line.goalId ?? ""}
                      onChange={(e) => {
                        const next = [...draft[slot]];
                        next[i] = { ...line, goalId: e.target.value || null };
                        setLines(slot, next);
                      }}
                      aria-label={t.goals.lineGoal}
                      className={`${INPUT} min-w-0 flex-1`}
                    >
                      <option value="">{t.goals.lineNoGoal}</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          🚩 {g.title}
                        </option>
                      ))}
                      {/* An archived goal still named here stays selectable,
                          so opening the form doesn't silently drop it. */}
                      {line.goalId && !goalTitle(line.goalId) && <option value={line.goalId}>{t.goals.lineArchivedGoal}</option>}
                    </select>
                    <button
                      type="button"
                      onClick={() => setLines(slot, draft[slot].filter((_, j) => j !== i))}
                      aria-label={t.common.delete}
                      className={PILL}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    value={line.note}
                    onChange={(e) => {
                      const next = [...draft[slot]];
                      next[i] = { ...line, note: e.target.value };
                      setLines(slot, next);
                    }}
                    placeholder={t.goals.lineNotePlaceholder}
                    aria-label={t.goals.lineNote}
                    className={INPUT}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLines(slot, [...draft[slot], { goalId: null, note: "" }])}
                className={`${PILL} w-fit`}
              >
                + {t.common.add}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {error && <p className="text-[11px] text-accent">{error}</p>}
        <button type="button" onClick={() => setConfirmDelete(true)} className={`${PILL} ml-auto`}>
          {t.common.delete}
        </button>
        <button
          type="button"
          onClick={() => void save().catch(() => {})}
          disabled={!dirty || saving}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent disabled:opacity-40"
        >
          {saving ? t.common.saving : t.common.save}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t.goals.periodDeleteConfirm}
        confirmLabel={t.common.delete}
        onConfirm={() => {
          setConfirmDelete(false);
          onDeleted();
          void deleteFocusPeriodAction(period.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}
