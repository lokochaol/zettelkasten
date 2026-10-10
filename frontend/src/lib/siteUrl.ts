/** Absolute origin of this deployment, for the places that can't use a
 * relative URL: robots.txt's Sitemap line and sitemap.xml's <loc> entries
 * both require fully-qualified URLs.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is the project's stable production host
 * (e.g. hibino.vercel.app), which is what a sitemap should name — unlike
 * VERCEL_URL, which is the per-deployment hostname and would point search
 * engines at a specific immutable build.
 *
 * SITE_URL names it outright when the project has more than one production
 * domain (word-log-two.vercel.app and hibino.vercel.app) and the sitemap
 * should use a particular one. */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit.startsWith("http") ? explicit : `https://${explicit}`;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : "http://localhost:3000";
}
