"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Wraps a header's nav items (brand-adjacent links, locale toggle, sign-out,
 * etc.) and always collapses them behind a single menu button, at every
 * screen size — the header row itself gets other always-visible content
 * (brand, primary nav actions) placed as siblings outside this component.
 * The trigger button keeps a continuous, gentle scale-pulse so it
 * still reads as tappable even without hover — the same "this is a live
 * control" cue other tap-to-open menus in the app (e.g. QuickNoteActionMenu)
 * give on hover, just always-on since touch has no hover state.
 *
 * The open dropdown is rendered through a portal into `document.body` rather
 * than as a normal descendant — headers using this component are often
 * `sticky` with a `mask-image` fade (see ScratchTimeline/QuickNoteInlineTimeline),
 * and a mask fades everything painted inside that element, portal contents
 * included if left as a child. Portaling keeps the open menu fully opaque
 * regardless of what fading header it's triggered from.
 *
 * ログアウト is always the last item, added here rather than by each page,
 * so no screen's menu can be without it. `signedIn={false}` leaves it out —
 * only the guide, which is the one page shown to signed-out visitors.
 */
export function HeaderMenu({ children, signedIn = true }: { children: ReactNode; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle() {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          onClick={toggle}
          aria-label="Menu"
          aria-expanded={open}
          className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
            open ? "border-accent bg-accent-soft" : "border-accent/60 bg-surface"
          }`}
        >
          <span aria-hidden="true" className="animate-breathe-scale absolute inset-0 rounded-full border border-accent/50" />
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="relative">
            <path
              d="M1.5 3.5H12.5M1.5 7H12.5M1.5 10.5H12.5"
              stroke="#ff3d1a"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            onClick={() => setOpen(false)}
            style={{ top: coords.top, right: coords.right }}
            className="fixed z-50 flex min-w-[190px] flex-col items-end gap-2.5 rounded-lg border border-line-strong bg-surface p-3.5 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.85)]"
          >
            {children}
            {signedIn && (
              <div className="flex w-full justify-end border-t border-line pt-2.5">
                <SignOutButton />
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
