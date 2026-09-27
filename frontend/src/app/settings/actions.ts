"use server";

import { revalidatePath } from "next/cache";
import * as zoteroCredentials from "@/lib/zoteroCredentials";
import type { ZoteroCredentialSummary } from "@/lib/zoteroCredentials";
import * as aiCredentials from "@/lib/aiCredentials";
import { AiProvider } from "@/lib/aiCredentials";
import type { AiCredentialSummary } from "@/lib/aiCredentials";
import * as googleCalendarCredentials from "@/lib/googleCalendarCredentials";
import type { GoogleCalendarSummary } from "@/lib/googleCalendarCredentials";
import * as health from "@/lib/health";
import { EncryptionConfigError } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import { translateDomainError } from "@/lib/i18n/errors";
import { requireOwnerSub } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export async function getZoteroSettingsAction(): Promise<ZoteroCredentialSummary | null> {
  const ownerSub = await requireOwnerSub();
  return zoteroCredentials.getSummary(ownerSub);
}

export async function saveZoteroSettingsAction(input: {
  apiKey: string;
  libraryId: string;
  libraryType: string;
}): Promise<{ error: string } | { ok: true }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const apiKey = input.apiKey.trim();
  const libraryId = input.libraryId.trim();
  const libraryType = input.libraryType === "group" ? "group" : "user";

  if (!apiKey || !libraryId) {
    return { error: dict.settings.missingFieldsError };
  }

  try {
    await zoteroCredentials.upsert(ownerSub, { apiKey, libraryId, libraryType });
  } catch (e) {
    if (e instanceof EncryptionConfigError) {
      return { error: dict.errors.encryptionNotConfigured };
    }
    throw e;
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function removeZoteroSettingsAction(): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await zoteroCredentials.remove(ownerSub);
  revalidatePath("/settings");
}

export async function getAiSettingsAction(): Promise<AiCredentialSummary | null> {
  const ownerSub = await requireOwnerSub();
  return aiCredentials.getSummary(ownerSub);
}

export async function saveAiSettingsAction(input: {
  provider: string;
  apiKey: string;
}): Promise<{ error: string } | { ok: true }> {
  const ownerSub = await requireOwnerSub();
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const apiKey = input.apiKey.trim();
  const provider =
    input.provider === "OPENAI" ? AiProvider.OPENAI : input.provider === "GOOGLE" ? AiProvider.GOOGLE : AiProvider.ANTHROPIC;

  if (!apiKey) {
    return { error: dict.settings.missingFieldsError };
  }

  try {
    await aiCredentials.upsert(ownerSub, { provider, apiKey });
  } catch (e) {
    if (e instanceof EncryptionConfigError) {
      return { error: dict.errors.encryptionNotConfigured };
    }
    throw e;
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function removeAiSettingsAction(): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await aiCredentials.remove(ownerSub);
  revalidatePath("/settings");
}

export async function getGoogleCalendarSettingsAction(): Promise<GoogleCalendarSummary | null> {
  const ownerSub = await requireOwnerSub();
  return googleCalendarCredentials.getSummary(ownerSub);
}

/** Drops the stored refresh token. The grant itself still exists in the
 * owner's Google account until they revoke it there — worth saying in the
 * UI if this ever grows a confirmation, but deleting our copy is what stops
 * the app reading the calendar. */
export async function disconnectGoogleCalendarAction(): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await googleCalendarCredentials.remove(ownerSub);
  revalidatePath("/settings");
  revalidatePath("/calendar");
}

export interface HealthOverview {
  profile: health.HealthProfile | null;
  current: health.CurrentTargets | null;
  recent: health.HealthDailyMetric[];
  token: health.IngestTokenView | null;
}

export async function getHealthOverviewAction(todayKey: string): Promise<HealthOverview> {
  const ownerSub = await requireOwnerSub();
  const [profile, current, recent, token] = await Promise.all([
    health.getProfile(ownerSub),
    health.currentTargets(ownerSub, todayKey),
    health.listRecentMetrics(ownerSub, 7),
    health.getIngestToken(ownerSub),
  ]);
  return { profile, current, recent, token };
}

export async function saveHealthProfileAction(
  input: health.ProfileInput,
  todayKey: string,
): Promise<{ current: health.CurrentTargets | null } | { error: string }> {
  const ownerSub = await requireOwnerSub();
  try {
    await health.upsertProfile(ownerSub, input);
    revalidatePath("/settings");
    revalidatePath("/calendar");
    return { current: await health.currentTargets(ownerSub, todayKey) };
  } catch (e) {
    if (e instanceof ValidationError) return { error: translateDomainError(await getLocale(), e) };
    throw e;
  }
}

/** Issuing a new token silently breaks the automation already on the
 * phone, so the UI confirms before calling this. */
export async function issueHealthTokenAction(): Promise<health.IngestTokenView> {
  const ownerSub = await requireOwnerSub();
  const token = await health.issueIngestToken(ownerSub);
  revalidatePath("/settings");
  return token;
}
