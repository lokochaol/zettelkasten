import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { CustomCursor } from "@/components/CustomCursor";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import { getLocale } from "@/lib/i18n/locale";
import { PreferencesProvider } from "@/lib/preferences/PreferencesProvider";
import { getBulletLegendVisible, getTimeZone } from "@/lib/preferences/preferences";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { UnsavedChangesProvider } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import { getTheme } from "@/lib/theme/theme";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** The app has no name, so the title is the character every page of it
 * begins with. It is captured once, independent of whichever screen is
 * open, which is why it can't be the current path — that changes as you
 * move, and a home-screen icon keeps whatever it was saved with. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = "/";
  const description =
    locale === "ja"
      ? "個人のメモ・計画・記録・追跡を1箇所にまとめる道具。"
      : "One place for a person's notes, plans, records and tracking.";
  // Google Search Console's HTML-meta-tag verification. The DNS/domain
  // property method can't be used here: the site lives on a *.vercel.app
  // hostname, so there's no zone to add a TXT record to — it has to be a
  // URL-prefix property, verified by this tag.
  //
  // The token is checked in rather than kept as a secret because it isn't
  // one: its whole job is to be served publicly in this page's <head>, on
  // every response, to anyone who asks. Committing it means the property
  // stays verified through a redeploy without depending on a value set by
  // hand in the Vercel dashboard. GOOGLE_SITE_VERIFICATION still overrides
  // it, for a different deployment of this codebase.
  const googleSiteVerification =
    process.env.GOOGLE_SITE_VERIFICATION?.trim() || "VcCqw2ebdpTBB-VKYGNXBIG8R5X4o3rhQQ0ImzCg_pk";

  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    appleWebApp: { title },
    ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return { themeColor: theme === "light" ? "#f3f4f7" : "#050505" };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = await getTheme();
  const bulletLegendVisible = await getBulletLegendVisible();
  const timeZone = await getTimeZone();
  return (
    <html lang={locale} data-theme={theme} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">
        <ThemeProvider initialTheme={theme}>
          <LocaleProvider initialLocale={locale}>
            <PreferencesProvider initialBulletLegendVisible={bulletLegendVisible}>
              <UnsavedChangesProvider>
                <TimeZoneSync serverTimeZone={timeZone} />
                <CustomCursor />
                <ServiceWorkerRegister />
                {children}
              </UnsavedChangesProvider>
            </PreferencesProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
