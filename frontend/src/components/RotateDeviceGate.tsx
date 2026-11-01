"use client";

import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Blocks the Zettelkasten screen behind a full-screen overlay while the
 * viewport is portrait — its 3-column layout genuinely needs the width, so
 * rather than let it render cramped, we ask for landscape outright. Pure CSS
 * (`flex landscape:hidden`) rather than a JS orientation check, so it's
 * correct on first paint with no flash and updates instantly on rotation.
 */
export function RotateDeviceGate() {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 hidden flex-col items-center justify-center gap-6 bg-bg px-10 text-center portrait:flex">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span aria-hidden="true" className="animate-glow-breathe absolute h-20 w-20 rounded-full bg-accent blur-2xl" />
        <svg
          width="52"
          height="52"
          viewBox="0 0 52 52"
          fill="none"
          aria-hidden="true"
          className="relative animate-rotate-device text-accent"
        >
          <rect x="16" y="6" width="20" height="34" rx="4" stroke="currentColor" strokeWidth="2.4" />
          <line x1="26" y1="34" x2="26" y2="34.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm font-bold tracking-wide text-ink">{t.zettelkasten.rotateTitle}</p>
        <p className="max-w-[280px] font-mono text-xs leading-relaxed text-ink-soft">{t.zettelkasten.rotateBody}</p>
      </div>
    </div>
  );
}
