import Link from "next/link";
import { PageIndex } from "@/components/PageIndex";
import { requireSession } from "@/lib/session";
import { MealWeekScreen } from "@/components/MealWeekScreen";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function MealsPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[1100px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <PageIndex current="meals" />
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {dict.nav.settingsLabel}
              </Link>
            </div>
          </HeaderMenu>
        </div>
        <MealWeekScreen />
      </div>
    </main>
  );
}
