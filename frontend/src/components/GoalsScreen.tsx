"use client";

import { useState, type FormEvent } from "react";
import {
  createFocusPeriodAction,
  createGoalAction,
  deleteGoalAction,
  reorderGoalsAction,
  saveCompassFieldAction,
  type GoalsOverview,
  type GoalView,
} from "@/app/goals/actions";
import { FocusPeriodCard } from "@/components/FocusPeriodCard";
import { GoalCard } from "@/components/GoalCard";
import { GoalsImportPanel } from "@/components/GoalsImportPanel";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { dayKindOf, periodFor } from "@/lib/goalFocus";
import { todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import type { CompassField } from "@/lib/goals";

type Tab = "goals" | "days" | "compass";
const TABS: Tab[] = ["goals", "days", "compass"];
/** The compass in the order it's read: why, what's already here, what's
 * enough, what gets in the way — then the years behind. */
const COMPASS_ORDER: CompassField[] = ["principles", "happiness", "essentials", "obstacles", "archive"];

/**
 * /goals — the 🚩s and the path to each, what the days go to, and the
 * ground under both.
 *
 * Three tabs rather than one long page because they're read at different
 * moments: the goals when reviewing, the days when planning a week, the
 * compass when unsure. The goals tab comes first: it's the one to land on.
 */
export function GoalsScreen({ initial }: { initial: GoalsOverview }) {
  const { t } = useI18n();
  const { guard } = useUnsavedChanges();
  const todayKey = todayKeyValue();
  const [tab, setTab] = useState<Tab>("goals");
  const [overview, setOverview] = useState(initial);
  // Bumped after an import, so every editor remounts on the new contents.
  const [generation, setGeneration] = useState(0);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const active = overview.goals.filter((g) => g.status === "ACTIVE");
  const archived = overview.goals.filter((g) => g.status === "ARCHIVED");
  const currentPeriod = periodFor(overview.periods, todayKey);
  const todayKind = dayKindOf(todayKey);

  const setGoals = (goals: GoalView[]) => setOverview((o) => ({ ...o, goals }));
  const replaceGoal = (goal: GoalView) => setOverview((o) => ({ ...o, goals: o.goals.map((g) => (g.id === goal.id ? goal : g)) }));

  async function addGoal(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    const res = await createGoalAction(title, todayKey);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setNewTitle("");
    setOverview((o) => ({ ...o, goals: [...o.goals.filter((g) => g.status === "ACTIVE"), res.goal, ...o.goals.filter((g) => g.status === "ARCHIVED")] }));
  }

  function moveGoal(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= active.length) return;
    const next = [...active];
    [next[index], next[to]] = [next[to], next[index]];
    setGoals([...next, ...archived]);
    void reorderGoalsAction(next.map((g) => g.id));
  }

  function changeGoal(goal: GoalView) {
    const before = overview.goals.find((g) => g.id === goal.id);
    if (before && before.status !== goal.status) {
      // Archiving or restoring moves it between the lists: to the end of
      // the active ones, or the top of the archive.
      const rest = overview.goals.filter((g) => g.id !== goal.id);
      setGoals([...rest.filter((g) => g.status === "ACTIVE"), goal, ...rest.filter((g) => g.status === "ARCHIVED")]);
    } else replaceGoal(goal);
  }

  function removeGoal(id: string) {
    setGoals(overview.goals.filter((g) => g.id !== id));
    void deleteGoalAction(id);
  }

  async function addPeriod() {
    setError(null);
    const res = await createFocusPeriodAction({ label: "", fromDateKey: null, toDateKey: null, weekday: [], holiday: [], spare: [] });
    if ("error" in res) setError(res.error);
    else setOverview((o) => ({ ...o, periods: [...o.periods, res.period] }));
  }

  const renderGoal = (goal: GoalView, i: number, list: GoalView[]) => (
    <GoalCard
      key={`${goal.id}:${generation}`}
      goal={goal}
      todayKey={todayKey}
      isFirst={i === 0}
      isLast={i === list.length - 1}
      onChange={changeGoal}
      onMove={(d) => moveGoal(i, d)}
      onDelete={() => removeGoal(goal.id)}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex rounded-full border border-line-strong p-0.5">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => guard(() => setTab(key))}
              className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors ${
                tab === key ? "bg-accent text-on-accent" : "text-ink-soft hover:text-accent"
              }`}
            >
              {t.goals.tab[key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          aria-expanded={importOpen}
          className="ml-auto rounded-full border border-line-strong px-3 py-1 font-mono text-[10.5px] text-ink-soft hover:border-accent hover:text-accent"
        >
          {t.goals.importOpen}
        </button>
      </div>

      {importOpen && (
        <GoalsImportPanel
          todayKey={todayKey}
          onClose={() => setImportOpen(false)}
          onImported={(next) => {
            setOverview(next);
            setGeneration((g) => g + 1);
          }}
        />
      )}
      {error && <p className="text-[11px] text-accent">{error}</p>}

      {tab === "goals" && (
        <div className="flex flex-col gap-4">
          {active.length === 0 && <p className="text-[12px] leading-relaxed text-ink-soft">{t.goals.empty}</p>}
          {active.map(renderGoal)}
          <form onSubmit={addGoal} className="flex items-center gap-2">
            <span aria-hidden="true">🚩</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t.goals.newGoalPlaceholder}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newTitle.trim()}
              className="rounded-md bg-accent px-3 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
            >
              {t.goals.newGoal}
            </button>
          </form>
          {archived.length > 0 && (
            <details className="flex flex-col gap-3">
              <summary className="cursor-pointer font-mono text-[10px] tracking-wider text-ink-soft">
                {t.goals.archivedHeading(archived.length)}
              </summary>
              <div className="mt-3 flex flex-col gap-3">{archived.map(renderGoal)}</div>
            </details>
          )}
        </div>
      )}

      {tab === "days" && (
        <div className="flex flex-col gap-4">
          <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.goals.daysIntro}</p>
          {overview.periods.map((p) => (
            <FocusPeriodCard
              key={`${p.id}:${generation}`}
              period={p}
              goals={active}
              current={currentPeriod?.id === p.id}
              todayKind={todayKind}
              onSaved={(next) => setOverview((o) => ({ ...o, periods: o.periods.map((x) => (x.id === next.id ? next : x)) }))}
              onDeleted={() => setOverview((o) => ({ ...o, periods: o.periods.filter((x) => x.id !== p.id) }))}
            />
          ))}
          <button
            type="button"
            onClick={() => void addPeriod()}
            className="w-fit rounded-md border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft hover:border-accent hover:text-accent"
          >
            + {t.goals.addPeriod}
          </button>
        </div>
      )}

      {tab === "compass" && (
        <div className="@container">
          <div className="grid items-start gap-4 @[900px]:grid-cols-2">
            {COMPASS_ORDER.map((field) => (
              <section
                key={field}
                className={`flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 ${field === "archive" ? "@[900px]:col-span-2" : ""}`}
              >
                <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.goals.compass[field].title}</p>
                <p className="text-[11px] text-ink-faint">{t.goals.compass[field].hint}</p>
                <MarkdownNoteEditor
                  key={`${field}:${generation}`}
                  content={overview.compass[field]}
                  draftKey={`goal-compass:${field}`}
                  onSave={async (content) => {
                    const res = await saveCompassFieldAction(field, content);
                    if ("error" in res) throw new Error(res.error);
                    setOverview((o) => ({ ...o, compass: { ...o.compass, [field]: content } }));
                  }}
                />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
