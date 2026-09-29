import { requireSession } from "@/lib/session";
import * as projects from "@/lib/projects";
import { AppShell } from "@/components/AppShell";
import { ProjectsGrid } from "@/components/ProjectsGrid";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function ProjectsPage() {
  const session = await requireSession();
  const ownerSub = session.ownerSub;
  // Lazily creates the owner's single default "自分" project on first visit.
  await projects.ensureDefaultProject(ownerSub, session.user?.name ?? "自分");
  const list = await projects.listActive(ownerSub);
  const dict = getDictionary(await getLocale());

  return (
    <AppShell view="projects" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-extrabold tracking-tight text-ink">{dict.projects.heading}</h1>
          <p className="font-mono text-xs text-ink-soft">{dict.projects.description}</p>
        </div>

        <ProjectsGrid initialProjects={list} />
      </div>
    </AppShell>
  );
}
