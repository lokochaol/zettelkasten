"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** What a text editor exposes so the app can rescue (or drop) its pending
 * edits when something tries to navigate away from them. */
export interface UnsavedEditor {
  /** True while the buffer differs from what was last persisted. */
  isDirty: () => boolean;
  /** Persist the buffer. Rejecting keeps the user where they are. */
  save: () => Promise<void>;
  /** Throw the buffer away and go back to the persisted content. */
  discard: () => void;
}

interface UnsavedChangesApi {
  /** Registers an editor for the lifetime of the returned disposer. */
  register: (editor: UnsavedEditor) => () => void;
  /**
   * Runs `proceed` — immediately when nothing is dirty, otherwise after the
   * owner answers 保存 / 破棄 / キャンセル. Cancelling simply never calls it,
   * so callers can treat this as "leave, if the owner agrees".
   */
  guard: (proceed: () => void) => void;
  /** Whether any registered editor has unsaved changes right now — for
   * things that would rather wait than ask (see NewDayReload). */
  hasUnsaved: () => boolean;
}

const noop: UnsavedChangesApi = {
  register: () => () => {},
  guard: (proceed) => proceed(),
  hasUnsaved: () => false,
};

const UnsavedChangesContext = createContext<UnsavedChangesApi>(noop);

/**
 * Since text editors no longer autosave (see MarkdownNoteEditor), every way
 * out of an editor — closing an overlay, switching day, following a link,
 * closing the tab — has to stop and ask instead of silently dropping the
 * buffer. Editors register themselves here; transition points wrap
 * themselves in `guard`, and the browser-level exit is covered by
 * `beforeunload` plus a capture-phase click hook on internal <a> links
 * (App Router client navigations never reach `beforeunload`).
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const editorsRef = useRef(new Set<UnsavedEditor>());
  const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const register = useCallback((editor: UnsavedEditor) => {
    editorsRef.current.add(editor);
    return () => {
      editorsRef.current.delete(editor);
    };
  }, []);

  const dirtyEditors = useCallback(
    () => [...editorsRef.current].filter((e) => e.isDirty()),
    [],
  );

  const guard = useCallback(
    (proceed: () => void) => {
      if (dirtyEditors().length === 0) {
        proceed();
        return;
      }
      // Wrapped in a thunk: useState would otherwise call the function.
      setPendingProceed(() => proceed);
    },
    [dirtyEditors],
  );

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyEditors().length === 0) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyEditors]);

  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (anchor.origin !== window.location.origin) return;
      const href = anchor.href;
      if (href === window.location.href) return;
      if (dirtyEditors().length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingProceed(() => () => router.push(anchor.pathname + anchor.search + anchor.hash));
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [dirtyEditors, router]);

  function leave(proceed: () => void) {
    setPendingProceed(null);
    setBusy(false);
    proceed();
  }

  function saveAndLeave() {
    const proceed = pendingProceed;
    if (!proceed) return;
    setBusy(true);
    Promise.all(dirtyEditors().map((e) => e.save()))
      .then(() => leave(proceed))
      .catch(() => setBusy(false)); // stay put; the editor keeps its buffer
  }

  function discardAndLeave() {
    const proceed = pendingProceed;
    if (!proceed) return;
    for (const editor of dirtyEditors()) editor.discard();
    leave(proceed);
  }

  const hasUnsaved = useCallback(() => dirtyEditors().length > 0, [dirtyEditors]);
  const api = useMemo(() => ({ register, guard, hasUnsaved }), [register, guard, hasUnsaved]);

  return (
    <UnsavedChangesContext.Provider value={api}>
      {children}
      {pendingProceed && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-[380px] overflow-hidden rounded-2xl border border-accent/50 bg-surface shadow-[0_0_60px_-15px_var(--color-accent)]">
            <div className="flex flex-col gap-4 p-5">
              <p className="font-mono text-xs font-bold tracking-[0.15em] text-accent uppercase">
                {t.unsavedChanges.title}
              </p>
              <p className="rounded-r-md border-l-2 border-accent bg-accent-soft px-3 py-2 text-xs leading-relaxed text-ink-soft">
                {t.unsavedChanges.body}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => setPendingProceed(null)}
                  disabled={busy}
                  className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink transition-colors hover:bg-surface-alt disabled:opacity-50"
                >
                  {t.unsavedChanges.stay}
                </button>
                <button
                  onClick={discardAndLeave}
                  disabled={busy}
                  className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink-soft transition-colors hover:bg-surface-alt disabled:opacity-50"
                >
                  {t.unsavedChanges.discardAndLeave}
                </button>
                <button
                  onClick={saveAndLeave}
                  disabled={busy}
                  className="btn-sheen rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
                >
                  {t.unsavedChanges.saveAndLeave}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesApi {
  return useContext(UnsavedChangesContext);
}

/** Registers `editor` for as long as the calling component is mounted. The
 * handlers are read through a ref, so callers can pass fresh closures every
 * render without churning the registry. */
export function useRegisterUnsavedEditor(editor: UnsavedEditor) {
  const { register } = useUnsavedChanges();
  const latest = useRef(editor);
  useEffect(() => {
    latest.current = editor;
  });
  useEffect(
    () =>
      register({
        isDirty: () => latest.current.isDirty(),
        save: () => latest.current.save(),
        discard: () => latest.current.discard(),
      }),
    [register],
  );
}
