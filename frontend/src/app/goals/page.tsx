import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { GoalsScreen } from "@/components/GoalsScreen";
import * as goals from "@/lib/goals";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function GoalsPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());
  const overview = await goals.getOverview(session.ownerSub);

  return (
    <AppShell view="goals" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
        <GoalsScreen initial={overview} />
      </div>
    </AppShell>
  );
}
