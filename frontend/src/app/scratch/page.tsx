import Link from "next/link";
import * as quickNotes from "@/lib/quickNotes";
import * as discovery from "@/lib/discovery";
import { requireSession } from "@/lib/session";
import { HomeSearchBar } from "@/components/HomeSearchBar";
import { SignOutButton } from "@/components/SignOutButton";
import { ScratchTimeline } from "@/components/ScratchTimeline";
import { ZettelkastenNavButton } from "@/components/ZettelkastenNavButton";
import { DiscoveryTriggerButton } from "@/components/DiscoveryTriggerButton";
import { DiscoveryRunToast } from "@/components/DiscoveryRunToast";
import { DiscoveryConfirmDialog } from "@/components/DiscoveryConfirmDialog";
import { DiscoveryStatusBanner } from "@/components/DiscoveryStatusBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageIndex } from "@/components/PageIndex";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDiscoveryError } from "@/lib/i18n/errors";

export default async function ScratchPage() {
  const session = await requireSession();
  const ownerSub = session.ownerSub;
  const notes = await quickNotes.listActive(ownerSub);
  const discoveryByNote = await discovery.listForQuickNotes(ownerSub, notes.map((n) => n.id));
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const runStatus = await discovery.getRunStatus(ownerSub);
  const runError =
    runStatus?.lastErrorCode && runStatus.lastErrorAt
      ? { message: translateDiscoveryError(locale, runStatus.lastErrorCode, runStatus.lastErrorStatus), occurredAt: runStatus.lastErrorAt.toISOString() }
      : null;

  const header = (
    <>
      <OfflineBanner />
      {runError && (
        <DiscoveryStatusBanner message={runError.message} occurredAt={runError.occurredAt} locale={locale} t={dict} />
      )}
      <div className="flex items-center justify-between gap-3">
        <PageIndex current="scratch" />
        <div className="flex items-center gap-2">
          <ZettelkastenNavButton />
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {dict.nav.settingsLabel}
              </Link>
            </div>
            <Link href="/literature" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.literatureLabel}
            </Link>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
            <DiscoveryTriggerButton />
            <LocaleToggle />
            <ThemeToggle />
            <SignOutButton />
          </HeaderMenu>
        </div>
      </div>

      <HomeSearchBar />
    </>
  );

  return (
    <main className="flex h-dvh flex-col items-center overflow-hidden bg-bg px-6 py-6">
      <DiscoveryRunToast />
      <DiscoveryConfirmDialog />
      <div className="flex h-full w-full max-w-[720px] min-h-0 flex-col landscape:lg:max-w-[1120px]">
        <ScratchTimeline initialNotes={notes} initialDiscovery={discoveryByNote} header={header} />
      </div>
    </main>
  );
}
