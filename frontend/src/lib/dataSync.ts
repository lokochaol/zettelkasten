"use client";

import { useEffect, useRef } from "react";

/**
 * Keeping each screen's data current without a reload.
 *
 * Most screens read their data once, when they open. That leaves two ways
 * for what's on screen to fall behind what's saved:
 *
 *   - a change made in one part of the app that another part depends on —
 *     the meal week's start day moves the week the meal table shows, an
 *     expense moves the day's totals on the calendar;
 *   - the app left open in the background (an app on the home screen has
 *     no reload button to speak of) while time passes or another device or
 *     tab changes things.
 *
 * So a change is announced by topic once it has been saved, and the parts
 * that show that kind of data re-read just themselves — not the page, not
 * the header or the side bar. Coming back to the app after a while counts
 * as a change to everything (see ResumeRefresh). Announcements also reach
 * the app's other open tabs and windows, through a BroadcastChannel.
 */

export type DataTopic = "meals" | "inventory" | "purchase" | "money" | "health" | "training" | "schedule" | "goals" | "discovery";

/** Coming back to the app: every topic may have moved. */
export const RESUME_EVENT = "app-resumed";
const CHANGE_EVENT = "data-changed";
const CHANNEL_NAME = "hibino-data";

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

/** Says that data of these kinds was just saved. Call it after the save
 * has gone through, not before. */
export function announceChange(...topics: DataTopic[]) {
  window.dispatchEvent(new CustomEvent<DataTopic[]>(CHANGE_EVENT, { detail: topics }));
  try {
    getChannel()?.postMessage(topics);
  } catch {
    // A closed channel only means other tabs won't hear it.
  }
}

/** Every announcement from this tab and the others, for listeners that
 * don't care which topic it was (ResumeRefresh). */
export function onAnyChange(handler: (topics: DataTopic[], fromOtherTab: boolean) => void): () => void {
  const local = (e: Event) => handler((e as CustomEvent<DataTopic[]>).detail, false);
  const remote = (e: MessageEvent) => Array.isArray(e.data) && handler(e.data as DataTopic[], true);
  window.addEventListener(CHANGE_EVENT, local);
  const ch = getChannel();
  ch?.addEventListener("message", remote);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    ch?.removeEventListener("message", remote);
  };
}

/**
 * Runs `refetch` when data of one of `topics` changes — here or in another
 * tab — and when the app comes back after a while. The callback is read
 * through a ref, so it can be a fresh closure every render.
 *
 * `skip` is checked at the moment of the change: a screen with an edit in
 * progress can say "not now" rather than have it replaced under the cursor.
 */
export function useRefreshOn(topics: DataTopic[], refetch: () => void, skip?: () => boolean) {
  const latest = useRef({ refetch, skip });
  useEffect(() => {
    latest.current = { refetch, skip };
  });
  const key = topics.join(",");
  useEffect(() => {
    const wanted = new Set(key.split(","));
    const run = () => {
      if (!latest.current.skip?.()) latest.current.refetch();
    };
    const offChange = onAnyChange((changed) => changed.some((t) => wanted.has(t)) && run());
    window.addEventListener(RESUME_EVENT, run);
    return () => {
      offChange();
      window.removeEventListener(RESUME_EVENT, run);
    };
  }, [key]);
}
