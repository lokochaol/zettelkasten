"use client";

import { useEffect, useState } from "react";
import { pushStatusAction, sendTestPushAction, subscribePushAction, unsubscribePushAction } from "@/app/discovery/actions";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "notConfigured" }
  | { kind: "denied" }
  | { kind: "off"; publicKey: string }
  | { kind: "on"; publicKey: string; endpoint: string };

/** The VAPID key as the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Turning discovery's notifications on for this device. Per device, because
 * a push subscription is: switching it on on the phone doesn't switch it
 * on on the laptop.
 */
export function DiscoveryNotifySettings() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState({ kind: "unsupported" });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const status = await pushStatusAction(existing?.endpoint ?? null);
      if (cancelled) return;
      if (!status.publicKey) setState({ kind: "notConfigured" });
      else if (Notification.permission === "denied") setState({ kind: "denied" });
      else if (existing && status.subscribed) setState({ kind: "on", publicKey: status.publicKey, endpoint: existing.endpoint });
      else setState({ kind: "off", publicKey: status.publicKey });
    }
    void check().catch(() => !cancelled && setState({ kind: "unsupported" }));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable(publicKey: string) {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { kind: "denied" } : { kind: "off", publicKey });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      // A subscription made with another key (a rotated VAPID pair) can't be
      // sent to, so start over rather than reuse it.
      const old = await registration.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const res = await subscribePushAction(subscription.toJSON());
      if ("error" in res) {
        setMessage(res.error);
        return;
      }
      setState({ kind: "on", publicKey, endpoint: subscription.endpoint });
    } catch {
      setMessage(t.discoveryTab.notifyFailed);
    } finally {
      setBusy(false);
    }
  }

  async function disable(publicKey: string, endpoint: string) {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      await unsubscribePushAction(endpoint);
      setState({ kind: "off", publicKey });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { sent } = await sendTestPushAction();
      setMessage(t.discoveryTab.notifyTestSent(sent));
    } finally {
      setBusy(false);
    }
  }

  const button = "flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10.5px] disabled:opacity-40";

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.discoveryTab.notifyHeading}</p>
      <p className="text-[11px] leading-relaxed text-ink-soft">{t.discoveryTab.notifyIntro}</p>
      {state.kind === "loading" && <Spinner size="xs" />}
      {state.kind === "unsupported" && <p className="font-mono text-[10px] text-ink-faint">{t.discoveryTab.notifyUnsupported}</p>}
      {state.kind === "notConfigured" && <p className="font-mono text-[10px] text-ink-faint">{t.discoveryTab.notifyNotConfigured}</p>}
      {state.kind === "denied" && <p className="font-mono text-[10px] text-accent">{t.discoveryTab.notifyDenied}</p>}
      {state.kind === "off" && (
        <button type="button" onClick={() => void enable(state.publicKey)} disabled={busy} className={`${button} w-fit bg-accent font-semibold text-on-accent`}>
          {busy && <Spinner size="xs" />}
          {t.discoveryTab.notifyEnable}
        </button>
      )}
      {state.kind === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[10px] text-accent">{t.discoveryTab.notifyOn}</span>
          <button type="button" onClick={() => void test()} disabled={busy} className={`${button} border border-line-strong text-ink-soft hover:text-accent`}>
            {t.discoveryTab.notifyTest}
          </button>
          <button
            type="button"
            onClick={() => void disable(state.publicKey, state.endpoint)}
            disabled={busy}
            className={`${button} border border-line-strong text-ink-soft hover:text-accent`}
          >
            {t.discoveryTab.notifyDisable}
          </button>
        </div>
      )}
      <p className="font-mono text-[9.5px] leading-relaxed text-ink-faint">{t.discoveryTab.notifyIosHint}</p>
      {message && <p className="font-mono text-[10px] text-accent">{message}</p>}
    </section>
  );
}
