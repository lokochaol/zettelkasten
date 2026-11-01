"use client";

import { useState } from "react";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { validateGoals, type ProjectGoals } from "@/lib/projectValidation";
import { updateProjectGoalsAction } from "@/app/projects/actions";

const TIERS: { key: keyof ProjectGoals; label: (t: ReturnType<typeof useI18n>["t"]) => string }[] = [
  { key: "goalUltimate", label: (t) => t.projects.goalUltimateLabel },
  { key: "goalYear3", label: (t) => t.projects.goalYear3Label },
  { key: "goalYear2", label: (t) => t.projects.goalYear2Label },
  { key: "goalYear1", label: (t) => t.projects.goalYear1Label },
  { key: "goalMonth3", label: (t) => t.projects.goalMonth3Label },
  { key: "goalMonth1", label: (t) => t.projects.goalMonth1Label },
  { key: "goalDay", label: (t) => t.projects.goalDayLabel },
];

function hasAnyGoal(goals: ProjectGoals): boolean {
  return TIERS.some(({ key }) => goals[key]?.trim());
}

export function ProjectGoalsSection({ projectId, initialGoals }: { projectId: string; initialGoals: ProjectGoals }) {
  const { t, locale } = useI18n();
  const [goals, setGoals] = useState(initialGoals);
  const [savedGoals, setSavedGoals] = useState(initialGoals);
  // Nothing set yet? Go straight to the form — there's nothing to display.
  // Otherwise start read-only, showing only the tiers that are registered.
  const [editing, setEditing] = useState(() => !hasAnyGoal(initialGoals));
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const problems = validateGoals(goals, locale);

  async function handleSave() {
    if (problems.length > 0 || status === "saving") return;
    setStatus("saving");
    setError(null);
    const result = await updateProjectGoalsAction(projectId, goals);
    if ("error" in result) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("idle");
    setSavedGoals(goals);
    setEditing(false);
  }

  function startEditing() {
    setGoals(savedGoals);
    setError(null);
    setEditing(true);
  }

  if (!editing) {
    const setTiers = TIERS.filter(({ key }) => savedGoals[key]?.trim());
    return (
      <div className="flex flex-col gap-3">
        {setTiers.length === 0 ? (
          <p className="text-sm text-ink-soft">{t.projects.goalOptionalHint}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {setTiers.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="font-mono text-[9.5px] tracking-wide text-ink-faint uppercase">{label(t)}</span>
                <p className="text-sm text-ink">{savedGoals[key]}</p>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={startEditing}
          className="w-fit rounded-lg border border-line-strong px-3 py-1.5 font-mono text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
        >
          {t.common.edit}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] text-ink-soft">{t.projects.goalOptionalHint}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TIERS.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] tracking-wide text-ink-faint uppercase">{label(t)}</span>
            <input
              value={goals[key] ?? ""}
              onChange={(e) => setGoals((prev) => ({ ...prev, [key]: e.target.value }))}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </label>
        ))}
      </div>
      {problems.length > 0 && <p className="font-mono text-[10px] text-accent">{problems.join(" / ")}</p>}
      {error && <p className="font-mono text-[10px] text-alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {hasAnyGoal(savedGoals) && (
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border border-line-strong px-3 py-2 font-mono text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            {t.common.cancel}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={problems.length > 0 || status === "saving"}
          className="btn-sheen flex items-center gap-2 rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
        >
          {status === "saving" && <Spinner size="xs" />}
          {status === "saving" ? t.projects.goalSaving : t.projects.goalSaveButton}
        </button>
      </div>
    </div>
  );
}
