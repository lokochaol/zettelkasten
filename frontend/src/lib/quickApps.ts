/**
 * The two pieces of the app that are also apps of their own: entering
 * today's money and writing a 走り書き. Each is one screen that opens
 * straight into typing, and each can be added to the home screen as its
 * own icon — so a purchase or a passing thought is two taps away, without
 * going through the index.
 *
 * What makes them separate apps is that each page names its own manifest
 * (with its own id, scope and start URL), home-screen title and icon; the
 * main app's manifest stays as it was. The assets live under
 * /quick-assets, which the sign-in gate lets through: a browser fetches a
 * manifest and its icons without the session cookie.
 */

export type QuickAppKey = "money" | "scratch";

export interface QuickApp {
  key: QuickAppKey;
  /** The page itself. */
  path: string;
  /** Home-screen label — short, it's shown under the icon. */
  name: string;
  description: string;
  /** The white glyph inside the orange disc. */
  glyph: string;
}

const ORANGE = "#ff3d1a";

/** White tile, orange disc, white glyph — one family, told apart by the
 * glyph. Drawn as paths (no text), so it renders the same everywhere. */
function iconSvg(glyph: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="115" fill="#ffffff" />
  <circle cx="256" cy="256" r="178" fill="${ORANGE}" />
  ${glyph}
</svg>`;
}

/** ¥: two arms meeting at the centre, a stem, two bars. */
const YEN = `<g stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M186 158 L256 252 L326 158" />
    <path d="M256 252 V372" />
    <path d="M196 274 H316" />
    <path d="M196 324 H316" />
  </g>`;

/** A pencil writing a line: the body on a diagonal, its tip, and the
 * stroke it has just left. */
const PENCIL = `<g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">
    <path d="M330 150 L362 182 L222 322 L180 334 L192 292 Z" stroke-width="26" />
    <path d="M306 174 L338 206" stroke-width="22" />
    <path d="M170 372 C 210 352, 240 388, 280 370 S 340 352, 352 366" stroke-width="22" />
  </g>`;

export const QUICK_APPS: Record<QuickAppKey, QuickApp> = {
  money: {
    key: "money",
    path: "/quick/money",
    name: "お金",
    description: "今日のお金を、その場で記録する。",
    glyph: YEN,
  },
  scratch: {
    key: "scratch",
    path: "/quick/scratch",
    name: "走り書き",
    description: "思いついたことを、すぐに書き留める。",
    glyph: PENCIL,
  },
};

export function isQuickAppKey(value: string): value is QuickAppKey {
  return value === "money" || value === "scratch";
}

export function quickAppIconSvg(key: QuickAppKey): string {
  return iconSvg(QUICK_APPS[key].glyph);
}

export function quickAppAssetPath(key: QuickAppKey, file: "manifest.webmanifest" | "icon-192.png" | "icon-512.png" | "apple-icon.png"): string {
  return `/quick-assets/${key}/${file}`;
}
