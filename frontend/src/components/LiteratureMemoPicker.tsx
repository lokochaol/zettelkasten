"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { HudFrame } from "@/components/HudFrame";
import { Spinner } from "@/components/LoadingSpinner";
import { zoteroCreateItemAction, zoteroSearchAction } from "@/app/dash-off/actions";
import { CREATABLE_ITEM_TYPES, type CreatableItemType, type ZoteroSearchResult } from "@/lib/zotero";
import type { LiteratureSelection } from "@/lib/literatureMemos";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The "choose which 文献メモ to link" interaction — Zotero search only
 * (+ inline "Zoteroに新規登録する" fallback when a search comes up empty).
 * Picking a Zotero result always resolves through the shared dedup rule in
 * literatureMemos.resolveSelection: a hit reuses that Zotero item's existing
 * memo (summary included) if one was already linked before, otherwise a
 * fresh memo is created holding just the citation info. There is no manual
 * or "pick an existing memo by citation text" path here anymore — every
 * memo a note links to is tied to a real Zotero item. Shared by QuickNote
 * editing (LiteratureMemoField), PermanentNote editing
 * (PermanentNoteLiteratureSection), and the promotion draft editor
 * (LiteratureMemoDraftField) — this component only ever emits
 * a LiteratureSelection via onPick; it holds no opinion about how that
 * selection gets persisted.
 */
export function LiteratureMemoPicker({ onPick }: { onPick: (selection: LiteratureSelection) => void }) {
  const { t } = useI18n();
  const ITEM_TYPE_LABEL = t.literaturePicker.itemTypeLabel;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZoteroSearchResult[] | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "unconfigured" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createCreator, setCreateCreator] = useState("");
  const [createDate, setCreateDate] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createItemType, setCreateItemType] = useState<CreatableItemType>("book");
  const [createPending, startCreateTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const handle = setTimeout(async () => {
      setState("searching");
      try {
        const res = await zoteroSearchAction(q);
        if (res.status === "ok") {
          setResults(res.results);
          setState("idle");
        } else if (res.status === "unconfigured") {
          setResults(null);
          setState("unconfigured");
        } else {
          setResults(null);
          setState("error");
          setErrorMessage(res.message);
        }
      } catch {
        setResults(null);
        setState("error");
        setErrorMessage(t.literaturePicker.searchFallbackError);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pickResult(r: ZoteroSearchResult) {
    onPick({ type: "zotero", zoteroKey: r.key, citation: r.citation, url: r.url });
    setResults(null);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-alt p-3">
      <HudFrame active={state === "searching"} innerClassName="flex items-center gap-2 rounded-xl px-3 py-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCreating(false);
            setCreateError(null);
          }}
          placeholder={t.literaturePicker.searchPlaceholder}
          className="w-full bg-transparent text-xs text-ink placeholder:text-ink-soft focus:outline-none"
        />
        {state === "searching" && <Spinner size="xs" />}
      </HudFrame>

      {state === "unconfigured" && query.trim() && (
        <p className="font-mono text-[10.5px] text-ink-faint">
          {t.literaturePicker.unconfiguredMessage}
          <Link href="/settings" className="text-accent underline">
            {t.literaturePicker.settingsLink}
          </Link>
          {t.literaturePicker.unconfiguredMessageSuffix}
        </p>
      )}
      {state === "error" && <p className="font-mono text-[10.5px] text-accent">{errorMessage}</p>}

      {query.trim() && results && results.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-1.5">
          {results.map((r) => (
            <button
              key={r.key}
              onClick={() => pickResult(r)}
              className="rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-alt"
            >
              <span className="font-semibold">{r.title}</span>
              <span className="ml-1.5 text-ink-soft">
                {r.creators} {r.year ? `(${r.year})` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {query.trim() && state === "idle" && results !== null && results.length === 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong p-2.5">
          <p className="font-mono text-[10.5px] text-ink-faint">{t.literaturePicker.notFound}</p>
          {!creating ? (
            <button
              onClick={() => {
                setCreating(true);
                setCreateTitle(query.trim());
              }}
              className="w-fit font-mono text-[10.5px] text-accent underline"
            >
              {t.literaturePicker.registerNew}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1.5">
                {CREATABLE_ITEM_TYPES.map((it) => (
                  <button
                    key={it}
                    onClick={() => setCreateItemType(it)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      createItemType === it
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-ink-soft hover:border-line-strong"
                    }`}
                  >
                    {ITEM_TYPE_LABEL[it]}
                  </button>
                ))}
              </div>
              <LabeledInput label={t.literaturePicker.titleLabel} value={createTitle} onChange={setCreateTitle} />
              <LabeledInput label={t.literaturePicker.creatorLabel} value={createCreator} onChange={setCreateCreator} />
              <LabeledInput label={t.literaturePicker.dateLabel} value={createDate} onChange={setCreateDate} placeholder="2024" />
              <LabeledInput label={t.literaturePicker.urlLabel} value={createUrl} onChange={setCreateUrl} placeholder="https://…" />
              {createError && <p className="font-mono text-[10.5px] text-accent">{createError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setCreating(false)}
                  className="font-mono text-[10.5px] text-ink-soft transition-colors hover:text-ink"
                >
                  {t.common.cancel}
                </button>
                <button
                  disabled={createPending || !createTitle.trim()}
                  onClick={() => {
                    setCreateError(null);
                    startCreateTransition(async () => {
                      try {
                        const res = await zoteroCreateItemAction({
                          itemType: createItemType,
                          title: createTitle,
                          creator: createCreator || undefined,
                          date: createDate || undefined,
                          url: createUrl || undefined,
                        });
                        if (res.status === "ok") {
                          pickResult(res.result);
                          setCreating(false);
                        } else if (res.status === "unconfigured") {
                          setCreateError(t.literaturePicker.unconfiguredCreateError);
                        } else {
                          setCreateError(res.message);
                        }
                      } catch {
                        setCreateError(t.literaturePicker.registerFallbackError);
                      }
                    });
                  }}
                  className="btn-sheen flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent disabled:opacity-50"
                >
                  {createPending && <Spinner size="xs" />}
                  {createPending ? t.common.registering : t.literaturePicker.registerButton}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
      />
    </div>
  );
}
