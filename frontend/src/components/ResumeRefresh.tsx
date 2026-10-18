"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAnyChange, RESUME_EVENT } from "@/lib/dataSync";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";

/** How long the app has to have been out of sight before coming back
 * counts as "things may have moved". Short glances away don't re-read. */
const AWAY_MS = 30_000;

/**
 * Brings the open screen up to date when the app comes back into view
 * after a while — switching back to the home-screen app, unlocking the
 * phone, returning to the tab — and when another tab saves something.
 *
 * Two halves: router.refresh() re-renders the server-rendered parts of the
 * page in place (the URL, the scroll position and what's typed stay), and
 * RESUME_EVENT tells each screen that reads its own data to read it again
 * (useRefreshOn). Nothing happens while an editor holds unsaved text —
 * that text must never be replaced — and the next return tries again.
 */
export function ResumeRefresh() {
  const router = useRouter();
  const { hasUnsaved } = useUnsavedChanges();

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const resume = () => {
      if (hasUnsaved()) return;
      router.refresh();
      window.dispatchEvent(new Event(RESUME_EVENT));
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= AWAY_MS) resume();
    };
    // Back/forward can restore the page from memory exactly as it was.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && resume();
    // Another tab saved something: the server-rendered parts here re-read.
    // (Screens that read their own data hear the same message through
    // useRefreshOn.)
    const offChange = onAnyChange((_, fromOtherTab) => fromOtherTab && !hasUnsaved() && router.refresh());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      offChange();
    };
  }, [router, hasUnsaved]);

  return null;
}
