"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { listActiveProjectsAction } from "@/app/projects/actions";
import { setQuickNoteProjectAction } from "@/app/dash-off/actions";
import type { ProjectSummary } from "@/lib/projects";
import type { QuickNoteProjectRef } from "@/lib/quickNotes";

/** Links this 走り書き to a Project — a QuickNote with a Project is exempt
 * from the 1-week stale-auto-archive sweep until that Project itself
 * closes (see archiveStaleQuickNotes in src/lib/quickNoteArchiving.ts). */
export function QuickNoteProjectSection({
  noteId,
  initialProject,
}: {
  noteId: string;
  initialProject: QuickNoteProjectRef | null;
}) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState(initialProject?.id ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listActiveProjectsAction().then((result) => {
      if (!cancelled) setProjects(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextId = e.target.value;
    setSelectedId(nextId);
    setSaving(true);
    try {
      await setQuickNoteProjectAction(noteId, nextId || null);
    } finally {
      setSaving(false);
    }
  }

  // Show the currently-linked project even if it isn't ACTIVE anymore (e.g.
  // it was closed after this note was linked) so the select never silently
  // drops the note's actual selection.
  const options =
    projects === null
      ? initialProject
        ? [initialProject]
        : []
      : initialProject && !projects.some((p) => p.id === initialProject.id)
        ? [...projects, initialProject]
        : projects;

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedId}
        onChange={handleChange}
        disabled={projects === null}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
      >
        <option value="">{t.scratch.projectNoneOption}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {saving && (
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
          <Spinner size="xs" />
          {t.scratch.projectSaving}
        </span>
      )}
    </div>
  );
}
