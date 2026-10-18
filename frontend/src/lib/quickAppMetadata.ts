import type { Metadata, Viewport } from "next";
import { QUICK_APPS, quickAppAssetPath, type QuickAppKey } from "@/lib/quickApps";

/** What makes a quick app's page install as its own app: its manifest,
 * its home-screen title and its icon, in place of the main app's. */
export function quickAppMetadata(key: QuickAppKey): Metadata {
  const quick = QUICK_APPS[key];
  return {
    title: quick.name,
    description: quick.description,
    applicationName: quick.name,
    manifest: quickAppAssetPath(key, "manifest.webmanifest"),
    appleWebApp: { title: quick.name, capable: true, statusBarStyle: "default" },
    icons: {
      icon: [{ url: quickAppAssetPath(key, "icon-192.png"), sizes: "192x192", type: "image/png" }],
      apple: [{ url: quickAppAssetPath(key, "apple-icon.png"), sizes: "180x180", type: "image/png" }],
    },
  };
}

export const quickAppViewport: Viewport = { themeColor: "#ffffff" };
