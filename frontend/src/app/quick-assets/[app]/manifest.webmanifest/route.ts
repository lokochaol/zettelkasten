import { NextResponse, type NextRequest } from "next/server";
import { isQuickAppKey, QUICK_APPS, quickAppAssetPath } from "@/lib/quickApps";

/**
 * The manifest of one of the quick apps (src/lib/quickApps.ts). Its own
 * id and scope are what make a browser treat it as an app separate from
 * the main one, so both can sit on the home screen.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/quick-assets/[app]/manifest.webmanifest">) {
  const { app } = await ctx.params;
  if (!isQuickAppKey(app)) return new NextResponse(null, { status: 404 });
  const quick = QUICK_APPS[app];
  return NextResponse.json(
    {
      id: quick.path,
      name: quick.name,
      short_name: quick.name,
      description: quick.description,
      start_url: quick.path,
      scope: quick.path,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        { src: quickAppAssetPath(app, "icon-192.png"), sizes: "192x192", type: "image/png" },
        { src: quickAppAssetPath(app, "icon-512.png"), sizes: "512x512", type: "image/png" },
        { src: quickAppAssetPath(app, "icon-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } },
  );
}
