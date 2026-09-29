import Link from "next/link";
import { notFound } from "next/navigation";
import * as quickNotes from "@/lib/quickNotes";
import { requireOwnerSub } from "@/lib/session";
import { NotFoundError } from "@/lib/errors";
import { QuickNoteContentSection } from "@/components/QuickNoteContentSection";
import { QuickNoteLiteratureSection } from "@/components/QuickNoteLiteratureSection";
import { QuickNoteProjectSection } from "@/components/QuickNoteProjectSection";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, localeTag } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";

function formatDate(date: Date, locale: Locale) {
  return date.toLocaleString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function QuickNoteDetailPage(props: PageProps<"/dash-off/[id]">) {
  const { id } = await props.params;
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);

  let note;
  try {
    note = await quickNotes.getDetail(ownerSub, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[860px] flex-col gap-8">
        <Link
          href="/dash-off"
          className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
        >
          <span className="text-accent">&lt;</span> {dict.nav.backToScratch}
        </Link>

        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">
            {note.source === "VOICE" ? dict.scratch.sourceVoice : dict.scratch.sourceScratch}
            {note.status === "ARCHIVED" && <span className="ml-2 text-ink-soft">{dict.scratch.archivedSuffix}</span>}
          </p>
          <p className="font-mono text-xs text-ink-soft">
            {dict.scratch.createdLabel(formatDate(note.encounteredAt, locale))}
            {"　/　"}
            {dict.scratch.updatedLabel(formatDate(note.updatedAt, locale))}
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.scratch.contentHeading}
          </h2>
          <QuickNoteContentSection noteId={note.id} content={note.content} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.scratch.literatureHeading}
          </h2>
          <QuickNoteLiteratureSection noteId={note.id} literatureMemo={note.literatureMemo} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.scratch.projectHeading}
          </h2>
          <QuickNoteProjectSection noteId={note.id} initialProject={note.project} />
        </section>
      </div>
    </main>
  );
}
