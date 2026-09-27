"use client";

import { useEffect, useState, useTransition } from "react";
import { runDiscoveryAction } from "@/app/scratch/actions";
import { dispatchDiscoveryRunEvent } from "@/lib/discoveryRunEvent";
import { onDiscoveryConfirmRequest } from "@/lib/discoveryConfirmEvent";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const RELOAD_DELAY_MS = 1200;

/** Gate in front of the "今すぐ探す" force-refresh: it replaces every note's
 * current AI candidates and spends tokens on the owner's connected AI
 * account, bypassing the usual 12h-per-note cooldown (see
 * runForEnabledNotes's `force` option) — worth a confirmation rather than
 * firing on a single misclick. Mounted at page level, outside HeaderMenu, so
 * it (and the events it drives — see discoveryConfirmEvent.ts /
 * discoveryRunEvent.ts) survive that menu closing the instant its trigger
 * button is clicked. */
export function DiscoveryConfirmDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => onDiscoveryConfirmRequest(() => setOpen(true)), []);

  function confirm() {
    setOpen(false);
    dispatchDiscoveryRunEvent({ phase: "running" });
    startTransition(async () => {
      try {
        const { notesChecked, candidatesFound } = await runDiscoveryAction(true);
        dispatchDiscoveryRunEvent({ phase: "done", notesChecked, candidatesFound });
        setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
      } catch {
        dispatchDiscoveryRunEvent({ phase: "error" });
      }
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
      <div className="relative w-full max-w-[380px] overflow-hidden rounded-2xl border border-accent/50 bg-surface shadow-[0_0_60px_-15px_var(--color-accent)]">
        <div className="relative flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="animate-pulse-dot h-2 w-2 rounded-full bg-accent" />
            <p className="font-mono text-xs font-bold tracking-[0.15em] text-accent uppercase">{t.discovery.confirmTitle}</p>
          </div>
          <p className="rounded-r-md border-l-2 border-accent bg-accent-soft px-3 py-2 text-xs leading-relaxed text-ink-soft">
            {t.discovery.confirmBody}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink transition-colors hover:bg-surface-alt disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={confirm}
              disabled={pending}
              className="btn-sheen rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
            >
              {t.discovery.confirmAction}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
