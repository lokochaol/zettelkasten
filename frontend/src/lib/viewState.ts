"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeping a reload where it was.
 *
 * A reload — Cmd+R, pull-to-refresh, the "reload" offered after a failed
 * save, or Chrome quietly reloading a tab it had discarded — used to land
 * back at the top of the screen with the screen's own choices reset: this
 * week instead of the week being planned, no note open, today instead of
 * the day being written. Every screen fetches fresh on load already, so all
 * a reload needs to keep is *where* you were. Two pieces do that:
 *
 * - replaceQuery: what's being looked at goes into the address (?week=,
 *   ?open=, ?date=) as it changes, without adding history entries, so the
 *   server renders the same view again on reload.
 * - usePaneScrollMemory: the scroll position of the pane is kept for this
 *   tab (sessionStorage — it outlives a reload, not the tab) and put back
 *   once the reloaded content is tall enough to hold it.
 */
export function replaceQuery(updates: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
}

const SCROLL_PREFIX = "pane-scroll:";
/** Long enough for a screen's data to arrive; after that, a position the
 * content never grew back to isn't worth jumping to late. */
const RESTORE_WINDOW_MS = 5000;

/** Only the page load itself is a reload; moving between screens inside
 * the app afterwards starts each one at the top, as before. */
let initialLoadHandled = false;
function isReloadedLoad() {
  if (initialLoadHandled) return false;
  // After this turn, not synchronously: a development-mode remount runs the
  // effect twice in a row and the second run is the one that stays.
  setTimeout(() => {
    initialLoadHandled = true;
  }, 0);
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  // `wasDiscarded`: Chrome reloading a tab it had dropped to save memory.
  return nav?.type === "reload" || nav?.type === "back_forward" || (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;
}

function scrollKey() {
  return `${SCROLL_PREFIX}${window.location.pathname}${window.location.search}`;
}

export function usePaneScrollMemory(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;

    let target = 0;
    try {
      if (isReloadedLoad()) target = Number(sessionStorage.getItem(scrollKey())) || 0;
    } catch {
      // Storage blocked: nothing to restore, and nothing will be saved.
    }

    // Restoring: content arrives in pieces (each screen fetches after
    // mount), so try again whenever the pane's contents change, until the
    // position fits, the person scrolls themselves, or the window passes.
    let restoring = target > 0;
    const tryRestore = () => {
      if (!restoring) return;
      if (pane.scrollHeight - pane.clientHeight >= target) {
        pane.scrollTop = target;
        restoring = false;
      }
    };
    const stopRestoring = () => {
      restoring = false;
    };
    const observer = new MutationObserver(tryRestore);
    if (restoring) {
      observer.observe(pane, { childList: true, subtree: true });
      tryRestore();
    }
    const giveUp = setTimeout(stopRestoring, RESTORE_WINDOW_MS);
    const interactions = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    for (const type of interactions) pane.addEventListener(type, stopRestoring, { passive: true });

    // Saving: once per frame at most while scrolling.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          if (pane.scrollTop > 0) sessionStorage.setItem(scrollKey(), String(Math.round(pane.scrollTop)));
          else sessionStorage.removeItem(scrollKey());
        } catch {
          // Storage full or blocked: the reload just starts at the top.
        }
      });
    };
    pane.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
      if (frame) cancelAnimationFrame(frame);
      for (const type of interactions) pane.removeEventListener(type, stopRestoring);
      pane.removeEventListener("scroll", onScroll);
    };
  }, [ref]);
}
