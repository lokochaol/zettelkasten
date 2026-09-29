"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The index of the app, in the slot where the name used to be.
 *
 * This app is one person's, opened every day; it doesn't need to
 * introduce itself. What is actually useful in the top-left corner is
 * where you are and where else you can go — so the slot says the current
 * page's name, and opening it lists every page with a line about what it
 * holds. An index rather than a menu: the descriptions are the point,
 * because after a month away "献立" and "家計" are not self-explanatory.
 *
 * Routes only — which is now all of them. 探索 used to be a pane inside the
 * zettelkasten screen with no address of its own; it is a page like the
 * rest, so it is listed like the rest.
 */

export type PageKey =
  | "home"
  | "scratch"
  | "zettelkasten"
  | "literature"
  | "projects"
  | "calendar"
  | "meals"
  | "money"
  | "discovery"
  | "search"
  | "guide"
  | "settings";

interface Entry {
  key: PageKey;
  href: string;
}

/** Grouped by what you came to do, not by when each was built. */
export const GROUPS: { titleKey: "write" | "plan" | "find"; entries: Entry[] }[] = [
  {
    titleKey: "write",
    entries: [
      { key: "scratch", href: "/dash-off" },
      { key: "zettelkasten", href: "/zettelkasten" },
      { key: "literature", href: "/literature" },
    ],
  },
  {
    titleKey: "plan",
    entries: [
      { key: "calendar", href: "/calendar" },
      { key: "projects", href: "/projects" },
      { key: "meals", href: "/meals" },
      { key: "money", href: "/money" },
      { key: "discovery", href: "/discovery" },
    ],
  },
  {
    titleKey: "find",
    entries: [
      { key: "search", href: "/search" },
      { key: "guide", href: "/guide" },
      { key: "settings", href: "/settings" },
    ],
  },
];

/** The address of each page, for the header's label. */
export const PATHS: Record<PageKey, string> = {
  home: "/",
  ...Object.fromEntries(GROUPS.flatMap((g) => g.entries.map((e) => [e.key, e.href]))),
} as Record<PageKey, string>;

export function PageIndex({ current }: { current: PageKey }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function toggle() {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          onClick={toggle}
          aria-expanded={open}
          aria-label={t.pageIndex.heading}
          className="group flex items-baseline gap-1.5 font-mono text-lg font-extrabold tracking-tight text-ink transition-colors hover:text-accent"
        >
          {PATHS[current]}
          <span
            aria-hidden="true"
            className={`font-mono text-[10px] text-ink-faint transition-transform group-hover:text-accent ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>
      </div>

      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-50 flex max-h-[80vh] w-[320px] flex-col gap-3 overflow-auto rounded-lg border border-line-strong bg-surface p-4 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.85)]"
          >
            {GROUPS.map((group) => (
              <div key={group.titleKey} className="flex flex-col gap-1.5">
                <p className="font-mono text-[9px] tracking-[0.2em] text-ink-faint uppercase">
                  {t.pageIndex.groups[group.titleKey]}
                </p>
                {group.entries.map((entry) => {
                  const page = t.pageIndex.pages[entry.key];
                  const here = entry.key === current;
                  return (
                    <Link
                      key={entry.key}
                      href={entry.href}
                      onClick={() => setOpen(false)}
                      className={`flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors ${
                        here ? "bg-accent-soft" : "hover:bg-surface-alt"
                      }`}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className={`text-[12.5px] font-semibold ${here ? "text-accent" : "text-ink"}`}>{page.name}</span>
                        <span className="font-mono text-[9px] text-ink-faint">{entry.href}</span>
                      </span>
                      <span className="text-[10.5px] leading-snug text-ink-soft">{page.note}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
