"use client";

import { useEffect, useState } from "react";
import { ProjectsGrid } from "@/components/ProjectsGrid";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { ensureDefaultProjectAction, listActiveProjectsAction } from "@/app/projects/actions";
import type { ProjectSummary } from "@/lib/projects";

/** ①②③のツェッテルカステン本体の代わりに、ペイン部分にそのままプロジェクト
 * 一覧を表示する（別画面への遷移ではなく、ZettelkastenSideActionBar経由の
 * インプレース切り替え）。個々のプロジェクトを開く操作自体は
 * /projects/[id] への実ナビゲーション — 詳細ページは目標編集・日毎メモ・
 * 紐づいたメモ一覧を持つ独立した画面として維持する。 */
export function ZettelkastenProjectsPane({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureDefaultProjectAction();
      const list = await listActiveProjectsAction();
      if (!cancelled) setProjects(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (projects === null) {
    return <LoadingBlock />;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-extrabold tracking-tight text-ink">{t.projects.heading}</h1>
        <p className="font-mono text-xs text-ink-soft">{t.projects.description}</p>
      </div>
      <ProjectsGrid initialProjects={projects} onOpenProject={onOpenProject} />
    </div>
  );
}
