import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { MoneyScreen } from "@/components/MoneyScreen";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function MoneyPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <AppShell view="money" userEmail={session.user?.email ?? dict.common.unknownEmail}>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8">
        <MoneyScreen />
      </div>
    </AppShell>
  );
}
