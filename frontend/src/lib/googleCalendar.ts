import { dayBoundsUtc } from "@/lib/dateKey";
import * as credentials from "@/lib/googleCalendarCredentials";

/**
 * Thin Google Calendar v3 client, scoped to what the day timeline needs.
 *
 * Deliberately hand-rolled over `fetch` rather than pulling in googleapis:
 * this touches three endpoints, and the SDK is a large dependency for a
 * project whose whole point is that one Next.js app talks straight to
 * Postgres. The same reasoning as src/lib/zotero.ts.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";
/** Refresh a little early — an access token that expires mid-request is a
 * 401 the owner sees as "the calendar broke". */
const EXPIRY_SKEW_MS = 60_000;

export class GoogleCalendarNotLinkedError extends Error {
  code = "googleCalendarNotLinked" as const;
}
export class GoogleCalendarAuthError extends Error {
  /** The stored refresh token no longer works (revoked in the Google
   * account, or the consent was withdrawn). Only re-linking fixes it, so
   * the UI says that rather than retrying. */
  code = "googleCalendarReauthRequired" as const;
}
export class GoogleCalendarApiError extends Error {
  code = "googleCalendarApiError" as const;
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** Null for an all-day event — those have a date, not an instant. */
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
  /** False when Google says this copy is read-only (someone else's
   * calendar, or an event the owner can't edit) — the UI hides its edit
   * affordances instead of letting a save fail. */
  editable: boolean;
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) throw new Error("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are not set");
  return { clientId, clientSecret };
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const { clientId, clientSecret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const json = await res.json();
  if (!res.ok) throw new GoogleCalendarApiError(res.status, json.error_description ?? json.error ?? "token exchange failed");
  return {
    refreshToken: (json.refresh_token as string | undefined) ?? null,
    accessToken: json.access_token as string,
    expiresInSeconds: (json.expires_in as number | undefined) ?? 3600,
    grantedScope: (json.scope as string | undefined) ?? "",
  };
}

/** A usable access token for this owner, refreshing (and re-caching) only
 * when the stored one is gone or about to expire. */
async function accessTokenFor(ownerSub: string): Promise<{ token: string; calendarId: string; grantedScope: string }> {
  const cred = await credentials.get(ownerSub);
  if (!cred) throw new GoogleCalendarNotLinkedError("Google Calendar is not linked");

  const stillValid =
    cred.accessToken && cred.accessTokenExpiresAt && cred.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();
  if (stillValid) return { token: cred.accessToken as string, calendarId: cred.calendarId, grantedScope: cred.grantedScope };

  const { clientId, clientSecret } = clientCredentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: cred.refreshToken, grant_type: "refresh_token" }),
  });
  const json = await res.json();
  if (!res.ok) {
    // invalid_grant is Google's answer for a revoked/expired refresh token.
    if (json.error === "invalid_grant") throw new GoogleCalendarAuthError("The Google Calendar link needs to be renewed");
    throw new GoogleCalendarApiError(res.status, json.error_description ?? json.error ?? "token refresh failed");
  }
  await credentials.storeAccessToken(ownerSub, json.access_token, json.expires_in ?? 3600);
  return { token: json.access_token as string, calendarId: cred.calendarId, grantedScope: cred.grantedScope };
}

interface GoogleEventResource {
  id: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  guestsCanModify?: boolean;
  organizer?: { self?: boolean };
  creator?: { self?: boolean };
}

function toEvent(e: GoogleEventResource): CalendarEvent {
  const allDay = !e.start?.dateTime;
  return {
    id: e.id,
    title: e.summary?.trim() || "(タイトルなし)",
    start: e.start?.dateTime ? new Date(e.start.dateTime) : null,
    end: e.end?.dateTime ? new Date(e.end.dateTime) : null,
    allDay,
    location: e.location ?? null,
    htmlLink: e.htmlLink ?? null,
    editable: e.organizer?.self === true || e.creator?.self === true || e.guestsCanModify === true,
  };
}

/** The owner's events for one day key, in their own time zone. Cancelled
 * events are dropped, and recurring events arrive already expanded
 * (singleEvents) so each instance lands on the day it actually occurs. */
export async function listDayEvents(ownerSub: string, dateKey: string, timeZone: string): Promise<CalendarEvent[]> {
  const { token, calendarId } = await accessTokenFor(ownerSub);
  const { start, end } = dayBoundsUtc(dateKey, timeZone);
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
    timeZone,
  });
  const res = await fetch(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) throw new GoogleCalendarAuthError("Google rejected the access token");
  const json = await res.json();
  if (!res.ok) throw new GoogleCalendarApiError(res.status, json.error?.message ?? "calendar request failed");
  return ((json.items ?? []) as GoogleEventResource[]).filter((e) => e.status !== "cancelled").map(toEvent);
}
