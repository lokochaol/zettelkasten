import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const proxy = auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/signin", req.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }
});

/** `guide`, `robots.txt` and `sitemap.xml` are exempt for crawlers'
 * benefit: a robots.txt that 307s to a sign-in page is a robots.txt Google
 * treats as absent, and a sitemap naming pages it then gets redirected away
 * from is worse than none. /guide is exempt because it's the one page whose
 * content is about how the app works rather than about anyone's notes — see
 * src/app/robots.ts.
 *
 * `api/health` is exempt for a different reason: the iPhone Shortcut that
 * posts there has no browser session, so a redirect to /signin is all it
 * would ever get. Its bearer token is the whole of its authentication —
 * see src/app/api/health/ingest/route.ts. */
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/health|signin|guide|robots.txt|sitemap.xml|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|icon-192.png|icon-512.png|manifest.webmanifest|sw.js|offline).*)",
  ],
};
