"use server";

import { revalidatePath } from "next/cache";
import * as zoteroCredentials from "@/lib/zoteroCredentials";
import type { ZoteroCredentialSummary } from "@/lib/zoteroCredentials";
import * as aiCredentials from "@/lib/aiCredentials";
import { AiProvider } from "@/lib/aiCredentials";
import type { AiCredentialSummary } from "@/lib/aiCredentials";
import * as googleCalendarCredentials from "@/lib/googleCalendarCredentials";
import type { GoogleCalendarSummary } from "@/lib/googleCalendarCredentials";
import * as discovery from "@/lib/discovery";
import type { DiscoverySchedule } from "@/lib/discovery";
import { EncryptionConfigError } from "@/lib/crypto";
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

export async function getDiscoveryScheduleAction(): Promise<DiscoverySchedule> {
  const ownerSub = await requireOwnerSub();
  return discovery.getSchedule(ownerSub);
}

export async function saveDiscoveryScheduleAction(input: DiscoverySchedule): Promise<void> {
  const ownerSub = await requireOwnerSub();
  await discovery.saveSchedule(ownerSub, input);
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
