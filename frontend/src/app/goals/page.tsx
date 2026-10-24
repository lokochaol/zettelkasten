import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { GoalsScreen } from "@/components/GoalsScreen";
import * as plan from "@/lib/goalPlan";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getTodayKey } from "@/lib/preferences/preferences";

// Applying a plan document is a Server Action on this page, and a detailed
// plan is dozens of writes to the hosted database; the platform's default
// limit cut it off before the transaction finished.
export const maxDuration = 300;

export default async function GoalsPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());
  const todayKey = await getTodayKey();
  const overview = await plan.getPlanOverview(session.ownerSub, todayKey);

  return (
    <AppShell view="goals" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8">
        <GoalsScreen initial={overview} todayKey={todayKey} />
      </div>
    </AppShell>
  );
}
