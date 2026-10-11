"use client";

import { useEffect } from "react";
import { todayKey as todayKeyValue } from "@/lib/dateKey";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";

/** How often an open, visible page checks whether the day has turned. */
const CHECK_INTERVAL_MS = 60_000;

/**
 * Reloads the page once the owner's day has turned over, so a page left
 * open across midnight — or an installed app brought back the next morning —
 * shows the new day, with yesterday's open tasks already carried into it
 * (projectTaskNotes.carryForward runs when the page is read).
 *
 * Checked when the page comes back into view and once a minute while it's
 * visible. Never while something is being edited: an unsaved buffer is worth
 * more than a fresh date, so it waits for the next check instead of asking.
 */
export function NewDayReload({ renderedDateKey }: { renderedDateKey: string }) {
  const { hasUnsaved } = useUnsavedChanges();
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = todayKeyValue();
      if (now === renderedDateKey || hasUnsaved()) return;
      // Once per day at most: should the server ever read the date
      // differently from the browser (its time zone comes from a cookie),
      // the page would otherwise reload every minute.
      const marker = `new-day-reload:${now}`;
      try {
        if (sessionStorage.getItem(marker)) return;
        sessionStorage.setItem(marker, "1");
      } catch {
        return; // no storage to remember it in: don't risk the loop
      }
      window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [renderedDateKey, hasUnsaved]);
  return null;
}
