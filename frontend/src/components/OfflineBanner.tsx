"use client";

import { useOffline } from "next/offline";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Shown whenever the browser is offline — requires next.config.ts's
 * experimental.useOffline (without it useOffline() always returns false).
 * Purely informational: it doesn't change what's usable — walking-書き can
 * already be added offline (see NewQuickNoteOverlay); this just makes that
 * state visible instead of silent. */
export function OfflineBanner() {
  const { t } = useI18n();
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-alert/50 bg-alert-soft px-3 py-2">
      <span className="text-accent">⚠</span>
      <span className="font-mono text-[10.5px] text-ink">{t.common.offlineBanner}</span>
    </div>
  );
}
