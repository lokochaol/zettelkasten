"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Generic modal confirmation, e.g. "Add to index?" (§9's one genuinely new
 * interaction primitive).
 *
 * Rendered into <body> and fixed to the viewport, so it covers the screen
 * whatever opened it. It used to be `absolute inset-0`, which only covers
 * the nearest positioned ancestor: fine inside a modal, but opened from
 * a plain button — プロジェクトを閉じる sits in a `relative` box the size of
 * the button — the 300px card was centred in that box and squeezed into a
 * column at the edge of the page.
 *
 * React still treats it as a child of whatever rendered it, so clicks inside
 * it bubble up the component tree as before. That's safe for the overlays it
 * opens from: their backdrops only dismiss on a press and release on the
 * backdrop itself (useBackdropDismiss).
 */
export function ConfirmDialog({
  open,
  title,
  warning,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  confirmPending = false,
}: {
  open: boolean;
  title: string;
  warning?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  /** Shows a spinner on the confirm button (e.g. while a delete is in flight). */
  confirmPending?: boolean;
}) {
  const { t } = useI18n();

  // Esc means "no", as it does for every other dialog on the platform.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const resolvedConfirmLabel = confirmLabel ?? t.confirmDialog.confirmLabel;
  const resolvedCancelLabel = cancelLabel ?? t.confirmDialog.cancelLabel;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[300px] max-w-full rounded-xl border border-accent/40 bg-surface p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]"
      >
        <p className="text-sm font-bold text-ink">{title}</p>
        {warning && (
          <p className="mt-2 mb-4 rounded-r-md border-l-2 border-accent bg-accent-soft px-2.5 py-2 text-xs leading-relaxed text-ink-soft">
            {warning}
          </p>
        )}
        {children && <div className="mb-4">{children}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-alt"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="btn-sheen flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
          >
            {confirmPending && <Spinner size="xs" />}
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
