import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a pending navigation, prefetch, or Server Action (e.g. creating a
  // 走り書き while offline — see OfflineAddQuickNote) sit and retry instead
  // of throwing when the network drops, resolving automatically once
  // connectivity returns. See src/app/dash-off for how this is used.
  experimental: {
    useOffline: true,
    // A statement PDF is uploaded to a Server Action (see previewPdfAction),
    // and the default 1 MB turns away an ordinary two-page statement. 4 MB
    // sits just under what Vercel accepts for a request body (4.5 MB), with
    // room for the multipart framing; past that the platform refuses the
    // upload before the app can say why, so the client checks first.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  /** /scratch was this route's address for the app's whole life so far:
   * it is in bookmarks, in the installed app's saved start URL, in the
   * README, and in whatever Google has indexed. A renamed route that
   * 404s for all of those is a rename that breaks the app for the one
   * person using it, so the old path keeps working — permanently, since
   * it is never coming back as a page of its own. */
  redirects() {
    return Promise.resolve([
      { source: "/scratch", destination: "/dash-off", permanent: true },
      { source: "/scratch/:id", destination: "/dash-off/:id", permanent: true },
    ]);
  },
};

export default nextConfig;
