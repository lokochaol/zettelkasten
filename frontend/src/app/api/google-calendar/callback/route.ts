import { NextResponse, type NextRequest } from "next/server";
import { requireOwnerSub } from "@/lib/session";
import { exchangeCodeForTokens } from "@/lib/googleCalendar";
import * as credentials from "@/lib/googleCalendarCredentials";
import { OAUTH_STATE_COOKIE, googleCalendarRedirectUri } from "@/lib/googleCalendarOauth";

/** Where the owner lands after consent, with the outcome in the query so
 * Settings can say what happened rather than silently looking unchanged. */
function back(request: NextRequest, result: string) {
  const url = new URL("/settings", request.nextUrl.origin);
  url.searchParams.set("googleCalendar", result);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const ownerSub = await requireOwnerSub();
  const params = request.nextUrl.searchParams;

  // The owner pressed "cancel" on the consent screen — not an error.
  if (params.get("error")) return back(request, "cancelled");

  const state = params.get("state");
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expected || state !== expected) return back(request, "state_mismatch");

  const code = params.get("code");
  if (!code) return back(request, "no_code");

  try {
    const tokens = await exchangeCodeForTokens(code, googleCalendarRedirectUri(request.nextUrl.origin));
    await credentials.upsertFromConsent(ownerSub, tokens);
    // Consent can come back narrower than asked for; Settings reads this
    // off the stored scope and says so.
    const res = back(request, credentials.scopeAllowsWrite(tokens.grantedScope) ? "linked" : "linked_readonly");
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch {
    return back(request, "failed");
  }
}
