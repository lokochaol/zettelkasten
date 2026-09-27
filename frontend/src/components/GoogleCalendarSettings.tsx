"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGoogleCalendarAction } from "@/app/settings/actions";
import type { GoogleCalendarSummary } from "@/lib/googleCalendarCredentials";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The Google Calendar link, alongside the Zotero and AI-key panels it's
 * modelled on. Connecting is a plain link, not a Server Action: the consent
 * flow is a full-page redirect out to Google and back (see
 * src/app/api/google-calendar/connect), which an action can't perform.
 *
 * `result` carries what the callback decided, so the outcome of a redirect
 * the owner just came back from is stated here rather than left to be
 * inferred from whether the panel looks different.
 */
export function GoogleCalendarSettings({
  initial,
  result,
}: {
  initial: GoogleCalendarSummary | null;
  result?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [pending, startTransition] = useTransition();

  const message =
    result === "linked" || result === "linked_readonly"
      ? t.settings.googleCalendarResultLinked
      : result === "cancelled"
        ? t.settings.googleCalendarResultCancelled
        : result
          ? t.settings.googleCalendarResultFailed
          : null;

  function disconnect() {
    startTransition(async () => {
      await disconnectGoogleCalendarAction();
      setSummary(null);
      router.replace("/settings");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      {message && <p className="font-mono text-[10.5px] text-accent">{message}</p>}

      {summary ? (
        <>
          <p className="text-xs text-ink">{t.settings.googleCalendarLinked(summary.calendarId)}</p>
          {!summary.canWrite && <p className="text-[11px] text-ink-soft">{t.settings.googleCalendarReadonly}</p>}
          <div className="flex gap-2">
            <a
              href="/api/google-calendar/connect"
              className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink transition-colors hover:bg-surface-alt"
            >
              {t.settings.googleCalendarReconnect}
            </a>
            <button
              onClick={disconnect}
              disabled={pending}
              className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-alt disabled:opacity-50"
            >
              {t.settings.googleCalendarDisconnect}
            </button>
          </div>
        </>
      ) : (
        <a
          href="/api/google-calendar/connect"
          className="btn-sheen w-fit rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97]"
        >
          {t.settings.googleCalendarConnect}
        </a>
      )}
    </div>
  );
}
