"use client";

import { useEffect, useState } from "react";
import { countNewDiscoveryAction } from "@/app/discovery/actions";
import { onDiscoveryRunEvent } from "@/lib/discoveryRunEvent";
import { onDiscoverySeen } from "@/lib/discoverySeenEvent";

/** How often an open screen checks again — a scheduled run lands at most
 * every hour, so this only needs to be less than that. */
const POLL_MS = 5 * 60 * 1000;

/**
 * The number of discovery finds not yet seen, for the side bar's badge.
 * Checked when a screen opens, when the tab comes back into view, after a
 * run started from the header menu, and every few minutes while open;
 * zeroed the moment /discovery marks everything seen.
 */
export function useNewDiscoveryCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      countNewDiscoveryAction()
        .then((n) => !cancelled && setCount(n))
        .catch(() => {});
    };
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => document.visibilityState === "visible" && check(), POLL_MS);
    const offRun = onDiscoveryRunEvent((d) => d.phase === "done" && check());
    const offSeen = onDiscoverySeen(() => setCount(0));
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      offRun();
      offSeen();
    };
  }, []);

  return count;
}
