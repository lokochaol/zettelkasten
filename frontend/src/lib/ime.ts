"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * Enter that submits, without stealing the Enter that confirms a
 * conversion.
 *
 * Typing Japanese means pressing Enter to accept what the IME is
 * offering. That keypress reaches the field like any other, so a bare
 * `key === "Enter"` handler fires while the person is still mid-word —
 * the form submits a half-typed memo and the rest of the sentence goes
 * nowhere. Every field where Enter does something needs the same three
 * guards, so they live here rather than being remembered each time:
 *
 * - `isComposing` on the event, which most browsers set;
 * - keyCode 229, the legacy signal for "this key went to the IME";
 * - a flag of our own, because Safari ends composition *before* the
 *   committing Enter arrives, so by then the first two both say no. The
 *   flag is cleared a tick later, which is after that Enter.
 */
export function useEnterKey(onEnter: () => void) {
  const composingRef = useRef(false);

  return {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      // A tick, not immediately: the Enter that ended the composition is
      // still on its way in Safari.
      setTimeout(() => {
        composingRef.current = false;
      }, 0);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
      onEnter();
    },
  };
}
