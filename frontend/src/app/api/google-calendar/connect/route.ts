import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwnerSub } from "@/lib/session";
import { EVENTS_SCOPE } from "@/lib/googleCalendarCredentials";
import { OAUTH_STATE_COOKIE, googleCalendarRedirectUri } from "@/lib/googleCalendarOauth";

/**
 * Starts the incremental-auth consent for Google Calendar.
 *
 * Separate from signing in on purpose: calendar is a sensitive scope, and
 * asking every owner for it at the door — including the ones who will never
 * link a calendar — is both a worse consent screen and a bigger promise
 * than the app needs to make. This route is behind the same session gate as
 * every other page (see proxy.ts), so `requireOwnerSub` is what ties the
 * consent that comes back to a specific owner.
 *
 * `prompt=consent` is not optional here: Google returns a refresh token
 * only on a consent it treats as new, and without one the link would stop
 * working the moment the first access token expired.
 */
export async function GET(request: NextRequest) {
  await requireOwnerSub();
  const clientId = process.env.AUTH_GOOGLE_ID;
  if (!clientId) return NextResponse.json({ error: "AUTH_GOOGLE_ID is not set" }, { status: 500 });

  const state = randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleCalendarRedirectUri(request.nextUrl.origin),
    response_type: "code",
    scope: EVENTS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  // CSRF: the callback only accepts a state it can match against this
  // cookie, so a consent redirect someone else triggered can't be replayed
  // into this owner's account.
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600,
  });
  return res;
}
