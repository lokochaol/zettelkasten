"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import * as discovery from "@/lib/discovery";
import * as push from "@/lib/push";
import { requireOwnerSub } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";
import { translateDomainError } from "@/lib/i18n/errors";

export type DiscoveryTopicView = discovery.DiscoveryTopicView;

type Result<T> = T | { error: string };

async function run<T>(work: (ownerSub: string) => Promise<T>): Promise<Result<T>> {
  const ownerSub = await requireOwnerSub();
  try {
    return await work(ownerSub);
  } catch (e) {
    if (e instanceof DomainError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

export async function listTopicsAction(): Promise<DiscoveryTopicView[]> {
  return discovery.listTopics(await requireOwnerSub());
}

export async function createTopicAction(content: string): Promise<Result<{ topics: DiscoveryTopicView[] }>> {
  return run(async (ownerSub) => {
    await discovery.createTopic(ownerSub, content);
    return { topics: await discovery.listTopics(ownerSub) };
  });
}

export async function updateTopicAction(topicId: string, patch: { content?: string; enabled?: boolean }): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await discovery.updateTopic(ownerSub, topicId, patch);
    return { ok: true as const };
  });
}

export async function deleteTopicAction(topicId: string): Promise<Result<{ ok: true }>> {
  return run(async (ownerSub) => {
    await discovery.deleteTopic(ownerSub, topicId);
    return { ok: true as const };
  });
}

/** Searches one topic right now, whatever the schedule and cooldown — the
 * owner is looking at it. The result is on screen, so no notification. */
export async function runTopicAction(topicId: string): Promise<Result<{ found: number; topics: DiscoveryTopicView[] }>> {
  return run(async (ownerSub) => {
    const fresh = await discovery.runForTopic(ownerSub, topicId);
    return { found: fresh.length, topics: await discovery.listTopics(ownerSub) };
  });
}

export async function dismissFindingAction(findingId: string): Promise<void> {
  await discovery.dismissFinding(await requireOwnerSub(), findingId);
}

export async function markFindingsSeenAction(findingIds: string[]): Promise<void> {
  await discovery.markFindingsSeen(await requireOwnerSub(), findingIds);
}

export async function findingToLiteratureAction(findingId: string): Promise<Result<{ literatureMemoId: string }>> {
  return run(async (ownerSub) => {
    const literatureMemoId = await discovery.resolveLiteratureForFinding(ownerSub, findingId);
    revalidatePath("/literature");
    return { literatureMemoId };
  });
}

/* ---------- notifications ---------- */

export async function pushStatusAction(endpoint: string | null): Promise<{ publicKey: string | null; subscribed: boolean }> {
  const ownerSub = await requireOwnerSub();
  return { publicKey: push.publicKey(), subscribed: endpoint ? await push.isSubscribed(ownerSub, endpoint) : false };
}

export async function subscribePushAction(subscription: unknown): Promise<Result<{ ok: true }>> {
  const userAgent = (await headers()).get("user-agent") ?? "";
  return run(async (ownerSub) => {
    await push.subscribe(ownerSub, subscription, userAgent);
    return { ok: true as const };
  });
}

export async function unsubscribePushAction(endpoint: string): Promise<void> {
  await push.unsubscribe(await requireOwnerSub(), endpoint);
}

export async function sendTestPushAction(): Promise<{ sent: number }> {
  const ownerSub = await requireOwnerSub();
  const t = getDictionary(await getLocale()).discoveryTab;
  return { sent: await push.sendToOwner(ownerSub, { title: t.notifyTestTitle, body: t.notifyTestBody, url: "/discovery", tag: "discovery-test" }) };
}
