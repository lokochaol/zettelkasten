import Link from "next/link";
import { PageIndex } from "@/components/PageIndex";
import * as literatureMemos from "@/lib/literatureMemos";
import { requireSession } from "@/lib/session";
import { LiteratureMemoList } from "@/components/LiteratureMemoList";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function LiteraturePage() {
  const session = await requireSession();
  const ownerSub = session.ownerSub;
  const memos = await literatureMemos.list(ownerSub);
  const dict = getDictionary(await getLocale());

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <PageIndex current="literature" />
          <HeaderMenu>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
            <LocaleToggle />
            <ThemeToggle />
            <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
          </HeaderMenu>
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{dict.literature.heading}</h1>
          <p className="font-mono text-xs text-ink-soft">{dict.literature.description(memos.length)}</p>
        </div>

        <LiteratureMemoList initialMemos={memos} />
      </div>
    </main>
  );
}
