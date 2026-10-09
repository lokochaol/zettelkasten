import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { MealWeekScreen } from "@/components/MealWeekScreen";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function MealsPage(props: PageProps<"/meals">) {
  const { week } = await props.searchParams;
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <AppShell view="meals" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8">
        <MealWeekScreen initialWeek={typeof week === "string" ? week : undefined} />
      </div>
    </AppShell>
  );
}
