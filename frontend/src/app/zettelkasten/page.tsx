import * as permanentNotes from "@/lib/permanentNotes";
import * as quickNotes from "@/lib/quickNotes";
import * as indexEntries from "@/lib/indexEntries";
import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { ZettelkastenScreen } from "@/components/ZettelkastenScreen";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/locale";

export default async function ZettelkastenPage(props: PageProps<"/zettelkasten">) {
  const params = await props.searchParams;
  const openId = typeof params.open === "string" ? params.open : undefined;

  const session = await requireSession();
  const ownerSub = session.ownerSub;
  const dict = getDictionary(await getLocale());
  const [globalOrder, activeQuickNotes, entries] = await Promise.all([
    permanentNotes.getGlobalOrder(ownerSub),
    quickNotes.listActive(ownerSub),
    indexEntries.list(ownerSub),
  ]);

  return (
    <AppShell view="notes" userEmail={session.user?.email ?? dict.common.unknownEmail} bleed>
      <ZettelkastenScreen
        initialGlobalOrder={globalOrder}
        initialActiveQuickNotes={activeQuickNotes}
        initialIndexEntries={entries}
        deepLinkOpenId={openId}
      />
    </AppShell>
  );
}
