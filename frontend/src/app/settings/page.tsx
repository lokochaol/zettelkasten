import Link from "next/link";
import { requireSession } from "@/lib/session";
import {
  getZoteroSettingsAction,
  getAiSettingsAction,
  getGoogleCalendarSettingsAction,
} from "@/app/settings/actions";
import { ZoteroSettingsForm } from "@/components/ZoteroSettingsForm";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { BulletLegendToggle } from "@/components/BulletLegendToggle";
import { GoogleCalendarSettings } from "@/components/GoogleCalendarSettings";
import { HealthSettings } from "@/components/HealthSettings";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function SettingsPage(props: PageProps<"/settings">) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const zotero = await getZoteroSettingsAction();
  const ai = await getAiSettingsAction();
  const googleCalendar = await getGoogleCalendarSettingsAction();
  // Set by the OAuth callback redirect — see api/google-calendar/callback.
  const googleCalendarResult = typeof searchParams.googleCalendar === "string" ? searchParams.googleCalendar : undefined;
  const dict = getDictionary(await getLocale());

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full max-w-[560px] flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/scratch"
            className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
          >
            <span className="text-accent">&lt;</span> {dict.nav.backToScratch}
          </Link>
          <HeaderMenu>
            <Link
              href="/literature"
              className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent"
            >
              {dict.nav.literatureLabel}
            </Link>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
            <LocaleToggle />
            <ThemeToggle />
            <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
          </HeaderMenu>
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{dict.settings.heading}</h1>
          <p className="font-mono text-xs text-ink-soft">{dict.settings.description}</p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.settings.aiHeading}
          </h2>
          <p className="font-mono text-[10.5px] text-ink-soft">{dict.settings.aiDescription}</p>
          <AiSettingsForm initial={ai} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.settings.zoteroHeading}
          </h2>
          <ZoteroSettingsForm initial={zotero} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.health.targetsHeading}
          </h2>
          <HealthSettings />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.settings.googleCalendarHeading}
          </h2>
          <p className="font-mono text-[10.5px] text-ink-soft">{dict.settings.googleCalendarDescription}</p>
          <GoogleCalendarSettings initial={googleCalendar} result={googleCalendarResult} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
            <span className="text-accent">{"//"}</span> {dict.settings.bulletLegendHeading}
          </h2>
          <p className="font-mono text-[10.5px] text-ink-soft">{dict.settings.bulletLegendDescription}</p>
          <BulletLegendToggle />
        </section>
      </div>
    </main>
  );
}
