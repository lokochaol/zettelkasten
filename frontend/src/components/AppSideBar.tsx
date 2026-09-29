"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";

/** The screens the bar switches between, in the order they sit in it. */
export type ShellView = "notes" | "projects" | "calendar" | "meals" | "money" | "discovery";

export const SHELL_VIEW_HREF: Record<ShellView, string> = {
  notes: "/zettelkasten",
  projects: "/projects",
  calendar: "/calendar",
  meals: "/meals",
  money: "/money",
  discovery: "/discovery",
};

/** Simple line-icon glyphs — no emoji, so they read consistently with the
 * rest of the HUD's monochrome/mono-label visual language across themes
 * (currentColor picks up the button's own text color). */
function NotesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="1.5" width="9" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 4.5H10.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.2 7H10.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.2 9.5H8.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6.5H14.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11.5 1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** A bowl — the week's food, which is what this pane plans. */
function MealsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 7.5H14C14 11 11.3 13.5 8 13.5C4.7 13.5 2 11 2 7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6 5C6 4 5.4 3.6 5.4 2.8C5.4 2.3 5.7 2 6 1.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M9.4 5C9.4 4 8.8 3.6 8.8 2.8C8.8 2.3 9.1 2 9.4 1.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** A coin. Money in this app is a running total, not a wallet. */
function MoneyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.8 5.4L8 8.2L10.2 5.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8.2V11.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 8.9H10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M6 10.5H10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** A magnifier over a page — "look outward from what's written here",
 * which is what discovery does. */
function DiscoveryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.3 10.3L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.2 6.4H8.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M5.2 8.4H7.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function ActionBarButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-transparent text-ink-soft hover:bg-surface-alt hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A fixed, always-visible icon strip along the very left edge of the pane
 * area — not a HeaderMenu entry (which is a collapsed, tap-to-open overflow
 * list), and the one place where the six everyday screens are all reachable
 * without opening anything.
 *
 * It used to swap panes in place on the zettelkasten screen, which meant
 * those screens only existed while you were standing on that one — カレンダー
 * and 家計 had no address of their own. They are pages, so the bar navigates
 * between them and the active icon is whichever page you are on: a bookmark,
 * a reload and the back button all land where the bar says you are, which
 * in-place swapping could never offer.
 */
export function AppSideBar({ active }: { active: ShellView }) {
  const router = useRouter();
  const { t } = useI18n();
  const { guard } = useUnsavedChanges();
  // Leaving a screen unmounts whatever editor is open on it, so an unsaved
  // buffer gets a 保存 / 破棄 prompt before the navigation happens.
  const go = (view: ShellView) => guard(() => router.push(SHELL_VIEW_HREF[view]));
  const entries: { view: ShellView; label: string; icon: ReactNode }[] = [
    { view: "notes", label: t.brand.zettelkasten, icon: <NotesIcon /> },
    { view: "projects", label: t.nav.projectsLabel, icon: <ProjectsIcon /> },
    { view: "calendar", label: t.nav.calendarLabel, icon: <CalendarIcon /> },
    { view: "meals", label: t.nav.mealsLabel, icon: <MealsIcon /> },
    { view: "money", label: t.nav.moneyLabel, icon: <MoneyIcon /> },
    { view: "discovery", label: t.nav.discoveryLabel, icon: <DiscoveryIcon /> },
  ];
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-line py-3">
      {entries.map((entry) => (
        <ActionBarButton key={entry.view} active={active === entry.view} label={entry.label} onClick={() => go(entry.view)}>
          {entry.icon}
        </ActionBarButton>
      ))}
    </div>
  );
}
