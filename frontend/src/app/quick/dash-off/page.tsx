import Link from "next/link";
import { requireSession } from "@/lib/session";
import * as quickNotes from "@/lib/quickNotes";
import { QuickScratch } from "@/components/QuickScratch";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { quickAppMetadata, quickAppViewport } from "@/lib/quickAppMetadata";

export const metadata = quickAppMetadata("dash-off");
export const viewport = quickAppViewport;

const RECENT = 5;

/** The 走り書き quick app: a box to write in, already focused, and the
 * last few written under it. */
export default async function QuickScratchPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());
  const notes = await quickNotes.listActive(session.ownerSub);
  const recent = notes
    .slice(-RECENT)
    .reverse()
    .map((n) => ({ id: n.id, preview: n.preview }));

  return (
    <main className="flex min-h-dvh flex-col items-center bg-bg px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8">
      <div className="flex w-full max-w-[560px] flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">{dict.quickApps.scratchHeading}</h1>
          <Link href="/dash-off" className="font-mono text-[10.5px] text-ink-soft hover:text-accent">
            {dict.quickApps.openScratch} →
          </Link>
        </div>
        <QuickScratch initialRecent={recent} />
      </div>
    </main>
  );
}
