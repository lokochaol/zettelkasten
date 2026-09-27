import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/** Mirrors src/lib/zoteroCredentials.ts — same "gracefully unconfigured"
 * contract: no row means the owner hasn't linked a calendar, which is a
 * normal state, never an error. */

export interface GoogleCalendarCredential {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  calendarId: string;
  grantedScope: string;
}

export interface GoogleCalendarSummary {
  calendarId: string;
  grantedScope: string;
  /** False when the consent came back without write access — the timeline
   * still reads, but every write is refused, and Settings says so rather
   * than letting the owner discover it at the first failed save. */
  canWrite: boolean;
  updatedAt: Date;
}

export const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function scopeAllowsWrite(grantedScope: string): boolean {
  return grantedScope.split(/\s+/).includes(EVENTS_SCOPE);
}

export async function get(ownerSub: string): Promise<GoogleCalendarCredential | null> {
  const row = await prisma.googleCalendarCredential.findUnique({ where: { ownerSub } });
  if (!row) return null;
  return {
    refreshToken: decryptSecret(row.refreshTokenEncrypted),
    accessToken: row.accessTokenEncrypted ? decryptSecret(row.accessTokenEncrypted) : null,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    calendarId: row.calendarId,
    grantedScope: row.grantedScope,
  };
}

export async function getSummary(ownerSub: string): Promise<GoogleCalendarSummary | null> {
  const row = await prisma.googleCalendarCredential.findUnique({ where: { ownerSub } });
  if (!row) return null;
  return {
    calendarId: row.calendarId,
    grantedScope: row.grantedScope,
    canWrite: scopeAllowsWrite(row.grantedScope),
    updatedAt: row.updatedAt,
  };
}

/** Called from the OAuth callback. Google only returns a refresh token on a
 * consent it considers "new" (access_type=offline + prompt=consent), so a
 * re-link that somehow arrives without one must keep the token already
 * stored rather than wipe the link. */
export async function upsertFromConsent(
  ownerSub: string,
  input: { refreshToken: string | null; accessToken: string; expiresInSeconds: number; grantedScope: string },
): Promise<void> {
  const accessTokenEncrypted = encryptSecret(input.accessToken);
  const accessTokenExpiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
  const existing = await prisma.googleCalendarCredential.findUnique({ where: { ownerSub } });

  if (!input.refreshToken && !existing) {
    throw new Error("Google did not return a refresh token and there is none stored");
  }
  const refreshTokenEncrypted = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : (existing as NonNullable<typeof existing>).refreshTokenEncrypted;

  await prisma.googleCalendarCredential.upsert({
    where: { ownerSub },
    create: { ownerSub, refreshTokenEncrypted, accessTokenEncrypted, accessTokenExpiresAt, grantedScope: input.grantedScope },
    update: { refreshTokenEncrypted, accessTokenEncrypted, accessTokenExpiresAt, grantedScope: input.grantedScope },
  });
}

/** Caches a freshly refreshed access token so the next read within the hour
 * skips the refresh round-trip. */
export async function storeAccessToken(ownerSub: string, accessToken: string, expiresInSeconds: number): Promise<void> {
  await prisma.googleCalendarCredential.update({
    where: { ownerSub },
    data: {
      accessTokenEncrypted: encryptSecret(accessToken),
      accessTokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    },
  });
}

export async function remove(ownerSub: string): Promise<void> {
  await prisma.googleCalendarCredential.deleteMany({ where: { ownerSub } });
}
