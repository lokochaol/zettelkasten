"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { HudFrame } from "@/components/HudFrame";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { createProjectAction } from "@/app/projects/actions";
import type { ProjectSummary } from "@/lib/projects";

function daysSince(startedAt: Date): number {
  return Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

/** ①プロジェクト一覧 — a grid of boxes, one per active project, plus an
 * always-visible "add" form. Reuses HudFrame the same way every other
 * card/panel in the app does. */
export function ProjectsGrid({
  initialProjects,
  onOpenProject,
}: {
  initialProjects: ProjectSummary[];
  /** When provided, opening a project calls this instead of navigating to
   * /projects/[id] — used inline within ZettelkastenScreen so the whole
   * flow stays on that one screen. Omitted, this falls back to a real
   * <Link> (the standalone /projects page's own behavior). */
  onOpenProject?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState(initialProjects);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createProjectAction(name);
      setItems((prev) => [...prev, created]);
      setName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((project) => {
          const card = (
            <HudFrame active={false} innerClassName="flex flex-col gap-2 rounded-xl px-4 py-3.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-bold text-ink">{project.name}</span>
                {project.isDefault && (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent uppercase">
                    {t.projects.defaultBadge}
                  </span>
                )}
              </div>
              <p className="font-mono text-[10px] text-ink-soft">
                {t.projects.daysSinceStart(daysSince(project.startedAt))}
              </p>
            </HudFrame>
          );
          return onOpenProject ? (
            <button key={project.id} onClick={() => onOpenProject(project.id)} className="text-left">
              {card}
            </button>
          ) : (
            <Link key={project.id} href={`/projects/${project.id}`}>
              {card}
            </Link>
          );
        })}
        {items.length === 0 && <p className="col-span-full py-8 text-center text-sm text-ink-soft">{t.projects.emptyList}</p>}
      </div>

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.projects.namePlaceholder}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!name.trim() || creating}
          className="btn-sheen flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
        >
          {creating && <Spinner size="xs" />}
          {creating ? t.projects.creating : t.projects.addButton}
        </button>
      </form>
    </div>
  );
}
