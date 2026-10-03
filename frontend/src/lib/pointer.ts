"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the primary input is a mouse or trackpad — the JS side of the
 * `mouse:` / `touch:` variants in globals.css, and the same query, so the
 * two can never disagree.
 *
 * Live rather than read once: attaching a trackpad to a tablet, or
 * switching device emulation in devtools, flips it mid-session.
 */
export const MOUSE_QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOUSE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useHasMouse(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOUSE_QUERY).matches,
    // The server can't know; anything gated on this is decoration that is
    // fine to add after hydration.
    () => false,
  );
}
