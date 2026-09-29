import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/types";
import { localeTag } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";

/** Shown at the top of /dash-off when the most recent discovery batch run
 * (manual trigger or cron) failed outright — expired/invalid API key, rate
 * limit, etc. See discovery.getRunStatus / DiscoveryRunStatus. A run
 * that simply found nothing is not an error and never shows this. */
export function DiscoveryStatusBanner({
  message,
  occurredAt,
  locale,
  t,
}: {
  message: string;
  occurredAt: string;
  locale: Locale;
  t: Dictionary;
}) {
  const formatted = new Date(occurredAt).toLocaleString(localeTag(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/50 bg-accent-soft px-3 py-2">
      <span className="font-mono text-[10.5px] text-ink">
        <span className="text-accent">⚠</span> {t.discovery.runErrorLabel}: {message}{" "}
        <span className="text-ink-faint">{t.discovery.runErrorAt(formatted)}</span>
      </span>
      <Link
        href="/settings"
        className="shrink-0 font-mono text-[10px] text-ink-soft transition-colors hover:text-accent"
      >
        {t.discovery.runErrorSettingsLink}
      </Link>
    </div>
  );
}
