import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ExpenseQuickEntry } from "@/components/ExpenseQuickEntry";
import { NewDayReload } from "@/components/NewDayReload";
import { getTodayKey } from "@/lib/preferences/preferences";
import { formatDateKey } from "@/lib/dateKey";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, localeTag } from "@/lib/i18n/dictionary";
import { quickAppMetadata, quickAppViewport } from "@/lib/quickAppMetadata";

export const metadata = quickAppMetadata("money");
export const viewport = quickAppViewport;

/**
 * The money quick app: today's date, the entry line with the cursor
 * already in the amount, and today's list under it. Nothing else — the
 * month and the plan are on /money, one link away.
 */
export default async function QuickMoneyPage() {
  await requireSession();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const todayKey = await getTodayKey();

  return (
    <main className="flex min-h-dvh flex-col items-center bg-bg px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8">
      <NewDayReload renderedDateKey={todayKey} />
      <div className="flex w-full max-w-[560px] flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">
            {formatDateKey(todayKey, localeTag(locale), { month: "long", day: "numeric", weekday: "short" })}
          </h1>
          <Link href="/money" className="font-mono text-[10.5px] text-ink-soft hover:text-accent">
            {dict.quickApps.openMoney} →
          </Link>
        </div>
        <ExpenseQuickEntry dateKey={todayKey} autoFocus />
      </div>
    </main>
  );
}
