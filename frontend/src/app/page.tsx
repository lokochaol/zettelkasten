import Link from "next/link";
import { requireSession } from "@/lib/session";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { IndexList } from "@/components/IndexList";
import { PageIndex } from "@/components/PageIndex";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

/**
 * The index of the app.
 *
 * This used to redirect to /dash-off on the grounds that the way in should
 * always be the scratch timeline. That held while the app was only notes.
 * It now holds a week of meals, a year of money and a body — and which of
 * those you came for is not something the app can guess. So the root is
 * the list of everything, and going straight to writing is one click from
 * here (or a bookmark on /dash-off, for the days it is always that).
 */
export default async function RootPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[680px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <PageIndex current="home" />
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {dict.nav.settingsLabel}
              </Link>
            </div>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
          </HeaderMenu>
        </div>

        <IndexList />
      </div>
    </main>
  );
}
