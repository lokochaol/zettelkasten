"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppSideBar, type ShellView } from "@/components/AppSideBar";
import { PageIndex, type PageKey } from "@/components/PageIndex";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { navigateWithViewTransition } from "@/lib/viewTransition";

/** Which index entry the header names, per screen — the bar's view keys and
 * the index's page keys are two vocabularies for the same six screens, and
 * this is the one place they have to meet. */
const PAGE_KEY: Record<ShellView, PageKey> = {
  notes: "zettelkasten",
  projects: "projects",
  calendar: "calendar",
  meals: "meals",
  money: "money",
  discovery: "discovery",
};

/**
 * The frame the six everyday screens are shown in: one header, the icon bar
 * down the left, and the screen itself in what's left.
 *
 * These six belong together because they get looked at in one sitting —
 * what today holds, what's left on the projects, what there is to eat, what
 * it costs. Switching between them is a glance, not a journey, so the bar
 * that switches them never leaves the screen. The pages NOT in the bar
 * (走り書き, 文献メモ, 検索, ガイド, 設定) are ones you go to on purpose and come
 * back from; they stay as they were, a plain page with the path in the
 * corner.
 *
 * The frame itself doesn't scroll — `children` does, inside the pane. That's
 * what keeps the header and the bar still while a month of money or a week
 * of meals goes past.
 */
export function AppShell({
  view,
  userEmail,
  /** Skips the pane's padding, for a screen that draws its own borders right
   * up to the frame (the zettelkasten's three columns, the discovery list). */
  bleed = false,
  children,
}: {
  view: ShellView;
  userEmail: string;
  bleed?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      <div className="flex items-center gap-3 border-b border-line px-6 py-3.5">
        <PageIndex current={PAGE_KEY[view]} />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigateWithViewTransition(router, "/dash-off")}
            className="rounded-full border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft transition-colors hover:text-ink"
          >
            <span className="text-accent">←</span> {t.zettelkasten.backToScratch}
          </button>
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={userEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {t.nav.settingsLabel}
              </Link>
            </div>
            <Link href="/literature" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {t.nav.literatureLabel}
            </Link>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {t.nav.guideLabel}
            </Link>
            <LocaleToggle />
            <ThemeToggle />
            <SignOutButton />
          </HeaderMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <AppSideBar active={view} />
        <div className={`min-h-0 min-w-0 flex-1 overflow-auto ${bleed ? "" : "px-6 py-6"}`}>{children}</div>
      </div>
    </div>
  );
}
