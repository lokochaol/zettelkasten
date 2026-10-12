const EVENT_NAME = "discovery-seen";

/** /discovery has just recorded everything new as seen — the side bar's
 * count drops to zero without waiting for its next check. */
export function announceDiscoverySeen() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function onDiscoverySeen(handler: () => void): () => void {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
