import { ImageResponse } from "next/og";
import { APP_ICON_CACHE_HEADERS } from "@/lib/appIcon";
import { isQuickAppKey, quickAppIconSvg } from "@/lib/quickApps";

const SIZES: Record<string, number> = { "icon-192.png": 192, "icon-512.png": 512, "apple-icon.png": 180 };

/** The PNG icons of a quick app — the home-screen icon on iPhone
 * (apple-icon.png) and the manifest's two sizes elsewhere. */
export async function GET(_req: Request, ctx: RouteContext<"/quick-assets/[app]/[icon]">) {
  const { app, icon } = await ctx.params;
  const size = SIZES[icon];
  if (!isQuickAppKey(app) || !size) return new Response(null, { status: 404 });
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders this itself, next/image doesn't apply
    <img src={`data:image/svg+xml,${encodeURIComponent(quickAppIconSvg(app))}`} width={size} height={size} alt="" />,
    { width: size, height: size, headers: APP_ICON_CACHE_HEADERS },
  );
}
