/**
 * The page to go back to after signing in, if it's safe to go back to.
 *
 * When a login has run out, the next page load lands on /signin. Coming back
 * to the same page afterwards matters more than it sounds: that page is where
 * an editor puts back the text left unsaved (src/lib/draftBackup.ts), and
 * landing on the index instead means hunting for it.
 *
 * Only a path on this site is accepted — a value from the query string that
 * could say "//evil.example" or "https://…" would turn sign-in into a
 * redirect to anywhere. And never back to /signin itself, or to an API route.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/signin") || raw.startsWith("/api/")) return "/";
  return raw;
}
