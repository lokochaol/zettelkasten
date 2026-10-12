import webpush from "web-push";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

/**
 * Web Push — how discovery tells the owner it found something while the
 * app is closed.
 *
 * Each browser (or the app installed to a home screen) that switches
 * notifications on leaves a PushSubscription; a send goes to every one of
 * the owner's. The keys are the server's VAPID pair, set as environment
 * variables (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, and VAPID_SUBJECT as a
 * mailto: or https: contact). Without them nothing is sent and the screen
 * says notifications aren't set up — the rest of discovery works the same.
 *
 * On iPhone, Web Push only reaches the app once it's been added to the home
 * screen and opened from there (iOS 16.4+).
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping the notification opens. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag?: string;
}

function config(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT?.trim() || "https://hibino.vercel.app";
  return { publicKey, privateKey, subject };
}

/** The key the browser subscribes with, or null when push isn't set up. */
export function publicKey(): string | null {
  return config()?.publicKey ?? null;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function cleanSubscription(input: unknown): SubscriptionInput {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const keys = (o.keys && typeof o.keys === "object" ? o.keys : {}) as Record<string, unknown>;
  const endpoint = typeof o.endpoint === "string" ? o.endpoint : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new ValidationError("pushSubscriptionInvalid", "bad push subscription");
  }
  return { endpoint, keys: { p256dh, auth } };
}

/** Keeps a device's subscription. An endpoint is one browser profile, so a
 * second sign-in on the same browser takes it over. */
export async function subscribe(ownerSub: string, input: unknown, userAgent: string): Promise<void> {
  const { endpoint, keys } = cleanSubscription(input);
  const data = { ownerSub, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent.slice(0, 300) };
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
}

export async function unsubscribe(ownerSub: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { ownerSub, endpoint } });
}

export async function isSubscribed(ownerSub: string, endpoint: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { ownerSub, endpoint } })) > 0;
}

/**
 * Sends to every device the owner switched notifications on for. A
 * subscription the push service says is gone (the owner revoked the
 * permission, or the browser dropped it) is deleted; any other failure is
 * logged and skipped, so one broken device doesn't stop the rest. Returns
 * how many devices it reached.
 */
export async function sendToOwner(ownerSub: string, payload: PushPayload): Promise<number> {
  const keys = config();
  if (!keys) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { ownerSub } });
  if (subscriptions.length === 0) return 0;

  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60 * 24,
          urgency: "normal",
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        else console.error("push failed", status, e instanceof Error ? e.message : e);
      }
    }),
  );
  return sent;
}
