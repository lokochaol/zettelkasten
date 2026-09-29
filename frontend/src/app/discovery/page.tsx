import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { ZettelkastenDiscoveryPane } from "@/components/ZettelkastenDiscoveryPane";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

/** 探索 — which 走り書き the web search looks at, and how often. It was a
 * pane with no address for as long as it lived inside the zettelkasten
 * screen; it is one of the six screens the icon bar switches between, so it
 * has a page like the other five. The pane component reads its own data on
 * the client, so there is nothing for this page to fetch. */
export default async function DiscoveryPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <AppShell view="discovery" userEmail={session.user?.email ?? dict.common.unknownEmail} bleed>
      <ZettelkastenDiscoveryPane />
    </AppShell>
  );
}
