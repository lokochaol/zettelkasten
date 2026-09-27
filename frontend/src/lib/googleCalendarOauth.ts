/** Shared between the consent redirect and its callback: Google checks the
 * redirect_uri on both legs and rejects the exchange if they differ by so
 * much as a trailing slash, so neither side spells it out itself. */

export const OAUTH_STATE_COOKIE = "gcal_oauth_state";

export function googleCalendarRedirectUri(origin: string): string {
  return `${origin}/api/google-calendar/callback`;
}
