import Link from "next/link";
import { notFound } from "next/navigation";
import * as projects from "@/lib/projects";
import * as projectTaskNotes from "@/lib/projectTaskNotes";
import { requireOwnerSub } from "@/lib/session";
import { NotFoundError } from "@/lib/errors";
import { ProjectGoalsSection } from "@/components/ProjectGoalsSection";
import { ProjectTaskSection } from "@/components/ProjectTaskSection";
import { ProjectLinkedNotesSection } from "@/components/ProjectLinkedNotesSection";
import { ProjectCloseButton } from "@/components/ProjectCloseButton";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, localeTag } from "@/lib/i18n/dictionary";
import { getTodayKey } from "@/lib/preferences/preferences";
import type { Locale } from "@/lib/i18n/types";

const DAY_STRIP_SIZE = 6;

function formatDate(date: Date, locale: Locale) {
  return date.toLocaleDateString(localeTag(locale), { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function ProjectDetailPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);

  let project;
  try {
    project = await projects.getDetail(ownerSub, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const [linkedNotes, days] = await Promise.all([
    projects.listLinkedNotes(ownerSub, id),
    projectTaskNotes.listRecentDays(ownerSub, id, DAY_STRIP_SIZE),
  ]);

  const requestedDate = typeof searchParams.date === "string" ? searchParams.date : undefined;
  const selectedDate = requestedDate ?? (await getTodayKey());
  const selectedNote = await projectTaskNotes.getOrEmpty(ownerSub, id, selectedDate);

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/projects"
            className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
          >
            <span className="text-accent">&lt;</span> {dict.projects.backToScratch}
          </Link>
          {project.status === "ACTIVE" && <ProjectCloseButton projectId={project.id} />}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-extrabold tracking-tight text-ink">{project.name}</h1>
            {project.isDefault && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] tracking-wider text-accent uppercase">
                {dict.projects.defaultBadge}
              </span>
            )}
            {project.status === "CLOSED" && (
              <span className="rounded-full bg-surface-alt px-2 py-0.5 font-mono text-[9px] tracking-wider text-ink-soft uppercase">
                {dict.projects.closedBadge}
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-ink-soft">
            {dict.projects.startedLabel(formatDate(project.startedAt, locale))}
            {project.closedAt && `　/　${dict.projects.closedLabel(formatDate(project.closedAt, locale))}`}
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.projects.goalsHeading}
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
            <span className="text-accent">{"//"}</span> {dict.projects.todayNoteHeading}
          </h2>
          <ProjectTaskSection projectId={project.id} days={days} initialDate={selectedDate} initialNote={selectedNote} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.projects.linkedNotesHeading}
          </h2>
          <ProjectLinkedNotesSection
            projectId={project.id}
            quickNotes={linkedNotes.quickNotes}
            permanentNotes={linkedNotes.permanentNotes}
            locale={locale}
          />
        </section>
      </div>
    </main>
  );
}
