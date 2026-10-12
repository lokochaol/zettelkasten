"use server";

import { revalidatePath } from "next/cache";
import * as discovery from "@/lib/discovery";
import { requireOwnerSub } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { getLocale } from "@/lib/i18n/locale";
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
 * owner is looking at it, so what it finds is seen as it arrives. */
export async function runTopicAction(topicId: string): Promise<Result<{ found: number; topics: DiscoveryTopicView[] }>> {
  return run(async (ownerSub) => {
    const fresh = await discovery.runForTopic(ownerSub, topicId);
    await discovery.markAllSeen(ownerSub);
    return { found: fresh.length, topics: await discovery.listTopics(ownerSub) };
  });
}

export async function dismissFindingAction(findingId: string): Promise<void> {
  await discovery.dismissFinding(await requireOwnerSub(), findingId);
}

export async function findingToLiteratureAction(findingId: string): Promise<Result<{ literatureMemoId: string }>> {
  return run(async (ownerSub) => {
    const literatureMemoId = await discovery.resolveLiteratureForFinding(ownerSub, findingId);
    revalidatePath("/literature");
    return { literatureMemoId };
  });
}

/* ---------- what's new ---------- */

/** The side bar's count of finds not yet seen on /discovery. */
export async function countNewDiscoveryAction(): Promise<number> {
  return discovery.countNewFindings(await requireOwnerSub());
}

export async function markDiscoverySeenAction(): Promise<void> {
  await discovery.markAllSeen(await requireOwnerSub());
}
