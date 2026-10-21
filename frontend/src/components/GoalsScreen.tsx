"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlanOverviewAction } from "@/app/goals/planActions";
import type { PlanOverview } from "@/lib/goalPlan";
import { AdvisorDrawer } from "@/components/goals/AdvisorDrawer";
import { CompassTab } from "@/components/goals/CompassTab";
import { CycleTab } from "@/components/goals/CycleTab";
import { ObserveTab } from "@/components/goals/ObserveTab";
import { OverviewTab } from "@/components/goals/OverviewTab";
import { PlanImportPanel } from "@/components/goals/PlanImportPanel";
import { RecordsTab } from "@/components/goals/RecordsTab";
import { WeekTab } from "@/components/goals/WeekTab";
import { goalHexes, type TabProps } from "@/components/goals/ui";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import { useRefreshOn } from "@/lib/dataSync";

type Tab = "overview" | "cycle" | "week" | "records" | "observe" | "compass";
const TABS: Tab[] = ["overview", "cycle", "week", "records", "observe", "compass"];
const TAB_KEY = "goals:tab";

/**
 * /goals — the goals as a plan to live by, the way the owner's roadmap
 * document runs it, from furthest out to today:
 *
 *   全体     vision, the roadmap (a Gantt of every goal's phases), the goals
 *   実行期間 the current 12 weeks: targets, evidence, 4-week phases, dates
 *   1週間    the weekly budget, the 168 hours, the standard week
 *   記録     the daily record and the weekly / 4- / 12-week reviews
 *   観測     what the records say, and what the rules suggest changing
 *   指針     the rules, open questions, the change log, the compass
 *
 * The advisor sits beside all of it and proposes changes; a document can be
 * imported into it. Each goal keeps one colour across every tab.
 */
export function GoalsScreen({ initial, todayKey }: { initial: PlanOverview; todayKey: string }) {
  const { t } = useI18n();
  const { guard, hasUnsaved } = useUnsavedChanges();
  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOvState] = useState(initial);
  // Bumped when the plan is re-read as a whole, so every editor remounts.
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as Tab | null;
      // Read after hydration, so the server's render (全体) still matches.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && TABS.includes(saved)) setTab(saved);
    } catch {
      // storage unavailable: start on 全体
    }
  }, []);
  const chooseTab = (next: Tab) =>
    guard(() => {
      setTab(next);
      try {
        window.localStorage.setItem(TAB_KEY, next);
      } catch {
        // fine without it
      }
    });

  const replaceAll = (next: PlanOverview) => {
    setOvState(next);
    setGeneration((g) => g + 1);
  };

  // Back in the app after a while, re-read — unless something is mid-edit
  // (src/lib/dataSync.ts).
  useRefreshOn(
    ["goals"],
    () =>
      void getPlanOverviewAction(todayKey).then((next) => {
        if (!hasUnsaved()) replaceAll(next);
      }),
    hasUnsaved,
  );

  const active = useMemo(() => ov.goals.filter((g) => g.status === "ACTIVE"), [ov.goals]);
  // Colours by position among all goals, so archiving one doesn't recolour the rest.
  const hexes = useMemo(() => goalHexes(ov.goals), [ov.goals]);

  const props: TabProps = { ov, setOv: (u) => setOvState(u), todayKey, active, hexes, generation, onError: setError };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <div role="tablist" className="flex w-max rounded-full border border-line-strong p-0.5">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => chooseTab(key)}
                className={`rounded-full px-3 py-1 font-mono text-[11px] whitespace-nowrap transition-colors ${
                  tab === key ? "bg-accent text-on-accent" : "text-ink-soft hover:text-accent"
                }`}
              >
                {t.plan.tab[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setImportOpen((v) => !v)}
            aria-expanded={importOpen}
            className="rounded-full border border-line-strong px-3 py-1 font-mono text-[10.5px] text-ink-soft hover:border-accent hover:text-accent"
          >
            {t.plan.importOpen}
          </button>
          <button
            type="button"
            onClick={() => setAdvisorOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 font-mono text-[10.5px] font-semibold text-surface hover:bg-accent hover:text-on-accent"
          >
            <span aria-hidden="true">✦</span>
            {t.plan.advisorOpen}
          </button>
        </div>
      </div>

      {importOpen && (
        <PlanImportPanel
          todayKey={todayKey}
          goalCount={ov.goals.length}
          onClose={() => setImportOpen(false)}
          onImported={replaceAll}
          onLegacyImported={(next) => replaceAll({ ...ov, ...next })}
        />
      )}
      {error && (
        <p className="flex items-center gap-2 text-[11px] text-accent">
          {error}
          <button type="button" onClick={() => setError(null)} className="font-mono text-ink-faint hover:text-accent" aria-label={t.plan.close}>
            ×
          </button>
        </p>
      )}

      {tab === "overview" && <OverviewTab {...props} />}
      {tab === "cycle" && <CycleTab {...props} />}
      {tab === "week" && <WeekTab {...props} />}
      {tab === "records" && <RecordsTab {...props} />}
      {tab === "observe" && <ObserveTab {...props} />}
      {tab === "compass" && <CompassTab {...props} />}

      {advisorOpen && <AdvisorDrawer todayKey={todayKey} onClose={() => setAdvisorOpen(false)} onApplied={replaceAll} />}
    </div>
  );
}
