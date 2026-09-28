"use client";

import { useEffect, useState } from "react";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { ProjectGoalsSection } from "@/components/ProjectGoalsSection";
import { ProjectTaskSection } from "@/components/ProjectTaskSection";
import { ProjectLinkedNotesSection } from "@/components/ProjectLinkedNotesSection";
import { ProjectCloseButton } from "@/components/ProjectCloseButton";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import {
  getProjectDetailAction,
  listLinkedNotesAction,
  listRecentDaysAction,
  getProjectTaskNoteAction,
} from "@/app/projects/actions";
import type { ProjectDetail, LinkedQuickNoteRef, LinkedPermanentNoteRef } from "@/lib/projects";
import type { DayStripEntry, ProjectTaskNoteView } from "@/lib/projectTaskNotes";
import { todayKey as todayKeyValue } from "@/lib/dateKey";

const DAY_STRIP_SIZE = 6;

/** A Project's detail — goal ladder, day-strip task editor, linked notes,
 * close button — rendered inline inside ZettelkastenScreen's pane area
 * (client-fetched via Server Actions) instead of navigating to the
 * standalone /projects/[id] route, so opening a project never leaves the
 * zettelkasten screen. Mirrors src/app/projects/[id]/page.tsx's layout. */
export function ZettelkastenProjectDetailPane({
  projectId,
  initialDate,
  onBack,
}: {
  projectId: string;
  initialDate: string | null;
  onBack: () => void;
}) {
  const { t, locale } = useI18n();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [linkedNotes, setLinkedNotes] = useState<{
    quickNotes: LinkedQuickNoteRef[];
    permanentNotes: LinkedPermanentNoteRef[];
  } | null>(null);
  const [days, setDays] = useState<DayStripEntry[] | null>(null);
  const [selectedNote, setSelectedNote] = useState<ProjectTaskNoteView | null>(null);

  const selectedDate = initialDate ?? todayKeyValue();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [detail, linked, dayStrip, note] = await Promise.all([
        getProjectDetailAction(projectId),
        listLinkedNotesAction(projectId),
        listRecentDaysAction(projectId, DAY_STRIP_SIZE, todayKeyValue()),
        getProjectTaskNoteAction(projectId, selectedDate),
      ]);
      if (!cancelled) {
        setProject(detail);
        setLinkedNotes(linked);
        setDays(dayStrip);
        setSelectedNote(note);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (!project || !linkedNotes || !days || !selectedNote) {
    return <LoadingBlock label={t.projects.detailLoading} />;
  }

  function formatDate(date: Date) {
    return date.toLocaleDateString(localeTag(locale), { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
        >
          <span className="text-accent">&lt;</span> {t.projects.heading}
        </button>
        {project.status === "ACTIVE" && (
          <ProjectCloseButton
            projectId={project.id}
            onClosed={() => setProject((prev) => (prev ? { ...prev, status: "CLOSED", closedAt: new Date() } : prev))}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-extrabold tracking-tight text-ink">{project.name}</h1>
          {project.isDefault && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent uppercase">
              {t.projects.defaultBadge}
            </span>
          )}
          {project.status === "CLOSED" && (
            <span className="rounded-full bg-surface-alt px-2 py-0.5 font-mono text-[9px] tracking-wider text-ink-soft uppercase">
              {t.projects.closedBadge}
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-ink-soft">
          {t.projects.startedLabel(formatDate(project.startedAt))}
          {project.closedAt && `　/　${t.projects.closedLabel(formatDate(project.closedAt))}`}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.projects.goalsHeading}
        </h2>
        <ProjectGoalsSection
          projectId={project.id}
          initialGoals={{
            goalUltimate: project.goalUltimate,
            goalYear3: project.goalYear3,
            goalYear2: project.goalYear2,
            goalYear1: project.goalYear1,
            goalMonth3: project.goalMonth3,
            goalMonth1: project.goalMonth1,
            goalDay: project.goalDay,
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.projects.todayNoteHeading}
        </h2>
        <ProjectTaskSection projectId={project.id} days={days} initialDate={selectedDate} initialNote={selectedNote} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
          <span className="text-accent">{"//"}</span> {t.projects.linkedNotesHeading}
        </h2>
        <ProjectLinkedNotesSection
          projectId={project.id}
          quickNotes={linkedNotes.quickNotes}
          permanentNotes={linkedNotes.permanentNotes}
          locale={locale}
        />
      </section>
    </div>
  );
}
