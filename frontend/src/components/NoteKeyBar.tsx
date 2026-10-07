"use client";

import { useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { Glyph, Signifier } from "@/lib/lineEdits";

const GLYPHS: Glyph[] = ["-", "x", ">", "<", "o", "~"];
const SIGNIFIERS: Signifier[] = ["*", "!"];

/**
 * How far the bottom of the visible area sits above the bottom of the
 * layout viewport — the height of the on-screen keyboard on iOS, where the
 * keyboard covers the page instead of resizing it. Zero where the keyboard
 * resizes the page (Android Chrome), which is also exactly right.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    const frame = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Keeps the note focused while a button is pressed: the default action of
 * the press is to move focus to the button, which on a phone closes the
 * keyboard the bar is sitting on. */
const keepFocus = (e: MouseEvent | PointerEvent) => e.preventDefault();

function Key({ label, caption, onPress, children }: { label: string; caption: string; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={keepFocus}
      onPointerDown={keepFocus}
      onClick={onPress}
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-ink active:bg-accent-soft active:text-accent"
    >
      <span className="font-mono text-[15px] leading-none font-bold">{children}</span>
      <span className="text-[8.5px] leading-none whitespace-nowrap text-ink-faint">{caption}</span>
    </button>
  );
}

/**
 * The keys a phone keyboard doesn't have, for writing the daily task notes:
 * indent and outdent (there is no Tab), and the Bullet Journal glyphs and
 * signifiers (two or three layers deep on a phone's symbol keyboard).
 *
 * Each key acts on the line the caret is on, or on every line a selection
 * touches — see src/lib/lineEdits.ts. Shown by MarkdownNoteEditor only on
 * touch devices and only while a note has focus, pinned to the top of the
 * on-screen keyboard. Rendered into <body> so no ancestor's transform or
 * overflow can move or clip it.
 */
export function NoteKeyBar({
  onIndent,
  onOutdent,
  onGlyph,
  onSignifier,
}: {
  onIndent: () => void;
  onOutdent: () => void;
  onGlyph: (glyph: Glyph) => void;
  onSignifier: (signifier: Signifier) => void;
}) {
  const { t } = useI18n();
  const inset = useKeyboardInset();
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="toolbar"
      aria-label={t.noteKeyBar.label}
      data-note-keybar
      style={{ bottom: inset, paddingBottom: inset === 0 ? "env(safe-area-inset-bottom)" : 0 }}
      className="fixed inset-x-0 z-40 border-t border-line bg-surface/95 px-1.5 py-1 backdrop-blur"
    >
      <div className="flex items-stretch gap-0.5">
        <Key label={t.noteKeyBar.outdent} caption={t.noteKeyBar.short.outdent} onPress={onOutdent}>
          ⇤
        </Key>
        <Key label={t.noteKeyBar.indent} caption={t.noteKeyBar.short.indent} onPress={onIndent}>
          ⇥
        </Key>
        <span aria-hidden="true" className="my-1.5 w-px shrink-0 bg-line" />
        {GLYPHS.map((glyph) => (
          <Key key={glyph} label={t.bulletLegend.meanings[glyph]} caption={t.noteKeyBar.short[glyph]} onPress={() => onGlyph(glyph)}>
            {glyph}
          </Key>
        ))}
        <span aria-hidden="true" className="my-1.5 w-px shrink-0 bg-line" />
        {SIGNIFIERS.map((signifier) => (
          <Key
            key={signifier}
            label={t.bulletLegend.meanings[signifier]}
            caption={t.noteKeyBar.short[signifier]}
            onPress={() => onSignifier(signifier)}
          >
            {signifier}
          </Key>
        ))}
      </div>
    </div>,
    document.body,
  );
}
