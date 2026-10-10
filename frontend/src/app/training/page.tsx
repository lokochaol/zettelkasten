import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { TrainingScreen } from "@/components/TrainingScreen";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function TrainingPage(props: PageProps<"/training">) {
  const { week } = await props.searchParams;
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <AppShell view="training" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8">
        <TrainingScreen initialWeek={typeof week === "string" ? week : undefined} />
      </div>
    </AppShell>
  );
}
