import Link from "next/link";
import { PageIndex } from "@/components/PageIndex";
import { auth } from "@/auth";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { GuideContentJa } from "@/components/guide/GuideContentJa";
import { GuideContentEn } from "@/components/guide/GuideContentEn";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

/** The only page in the app that renders without a session — it explains
 * how the app works (every page, and the Zettelkasten method behind the
 * writing side) rather than showing anyone's notes, so it's the one thing
 * worth letting a crawler (or a curious stranger following a link) read.
 * See the exemption in proxy.ts. The header menu is account plumbing, so
 * it only appears for someone signed in. */
export default async function GuidePage() {
  const session = await auth();
  const locale = await getLocale();
  const dict = getDictionary(locale);

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[760px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <PageIndex current="guide" />
          <HeaderMenu>
            {session && (
              <>
                <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
                  <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
                  <Link
                    href="/settings"
                    className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent"
                  >
                    {dict.nav.settingsLabel}
                  </Link>
                </div>
                <Link
                  href="/literature"
                  className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent"
                >
                  {dict.nav.literatureLabel}
                </Link>
              </>
            )}
            <LocaleToggle />
            <ThemeToggle />
          </HeaderMenu>
        </div>

        {locale === "ja" ? <GuideContentJa /> : <GuideContentEn />}
      </div>
    </main>
  );
}
