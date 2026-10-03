"use client";

import { useEffect, useRef } from "react";
import { useHasMouse } from "@/lib/pointer";

const INTERACTIVE_SELECTOR = "a, button, input, textarea, [role='button']";

/**
 * The drawn cursor, for a mouse or trackpad only.
 *
 * Not rendered at all on touch. It used to be shown on any screen 768px or
 * wider while only ever being moved by mouse events, so on a tablet the dot
 * and ring sat in the top-left corner for good. Whether to draw it now
 * follows the input (see src/lib/pointer.ts), the same condition under which
 * globals.css hides the system cursor.
 */
export function CustomCursor() {
  const hasMouse = useHasMouse();
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMouse) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;
    let hovering = false;
    let raf = 0;

    function onMove(e: MouseEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      // Hidden until the pointer has a position: before the first move it
      // would be drawn at (0, 0), the top-left corner.
      dot!.style.opacity = "1";
      ring!.style.opacity = "1";
      dot!.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;

      const target = e.target as Element | null;
      hovering = !!target?.closest(INTERACTIVE_SELECTOR);
      ring!.style.width = hovering ? "44px" : "28px";
      ring!.style.height = hovering ? "44px" : "28px";
      ring!.style.borderColor = hovering
        ? "var(--color-accent)"
        : "color-mix(in srgb, var(--color-accent) 55%, transparent)";
    }

    function onDown() {
      dot!.style.animation = "none";
      requestAnimationFrame(() => {
        dot!.style.animation = "cursor-click 0.35s ease-out";
      });
    }

    function tick() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      ring!.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      cancelAnimationFrame(raf);
    };
  }, [hasMouse]);

  if (!hasMouse) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]" aria-hidden="true">
      <div
        ref={dotRef}
        className="fixed top-0 left-0 h-1.5 w-1.5 rounded-full bg-accent"
        style={{ transform: "translate(-50%, -50%)", opacity: 0 }}
      />
      <div
        ref={ringRef}
        className="fixed top-0 left-0 h-7 w-7 rounded-full border transition-[width,height,border-color] duration-150 ease-out"
        style={{ transform: "translate(-50%, -50%)", opacity: 0 }}
      />
    </div>
  );
}
