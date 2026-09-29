import type { MetadataRoute } from "next";

/** Makes the app installable (Add to Home Screen / desktop install) and,
 * together with public/sw.js + ServiceWorkerRegister, is what lets it be
 * opened cold with zero connectivity — experimental.useOffline (see
 * next.config.ts) only covers a tab that was already open when it went
 * offline, this covers launching it from a home-screen icon or bookmark
 * while offline the whole time. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zettelkasten",
    short_name: "Zettelkasten",
    description: "書き留めた考えをリンクでつなぎ、育てていく個人的な知識システム。",
    // The index, since that is now the way in — /scratch is one click
    // from it, and a bookmark there still works for anyone who always
    // wants to land on the timeline.
    start_url: "/",
    display: "standalone",
    // The light palette, matching DEFAULT_THEME and the app icon — this
    // is the splash screen behind a cold launch, so a dark one would flash
    // black before a light app.
    background_color: "#f3f4f7",
    theme_color: "#f3f4f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
