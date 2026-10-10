import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

/** Lists exactly the pages a signed-out visitor can actually reach, since
 * a sitemap entry for a page that redirects to /signin is a page Google
 * reports as an error rather than indexes. /guide carries the substance
 * (what a Zettelkasten is and how this app maps onto it), so it's the
 * higher priority of the two. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/guide`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/signin`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
