import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

/**
 * Nearly all of this app is one person's private notes behind a login, and
 * the two pages that aren't — the sign-in screen and the guide to what a
 * Zettelkasten is — are the only ones worth a crawler's time. So the rule
 * is "nothing, except those two": everything else either redirects to
 * /signin anyway (see proxy.ts) or is an icon route.
 *
 * `allow` beats `disallow` on a longer path match, which is how both
 * Googlebot and Bingbot resolve the overlap.
 *
 * `/$` is the top page and nothing under it. It has to be crawlable: it's
 * the homepage the OAuth consent screen names, and Search Console reports
 * a blocked homepage as "URL が robots.txt によってブロックされています".
 * Signed out, it redirects to /signin, which is allowed too.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/signin", "/guide", "/privacy", "/terms", "/sitemap.xml"],
        disallow: "/",
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
