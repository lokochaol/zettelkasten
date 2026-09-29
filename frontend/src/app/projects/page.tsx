import Link from "next/link";
import { PageIndex } from "@/components/PageIndex";
import { requireSession } from "@/lib/session";
import * as projects from "@/lib/projects";
import { ProjectsGrid } from "@/components/ProjectsGrid";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
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
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <PageIndex current="projects" />
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {dict.nav.settingsLabel}
              </Link>
            </div>
            <Link href="/calendar" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.calendarLabel}
            </Link>
            <Link href="/literature" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.literatureLabel}
            </Link>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
          </HeaderMenu>
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-extrabold tracking-tight text-ink">{dict.projects.heading}</h1>
          <p className="font-mono text-xs text-ink-soft">{dict.projects.description}</p>
        </div>

        <ProjectsGrid initialProjects={list} />
      </div>
    </main>
  );
}
