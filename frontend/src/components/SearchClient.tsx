"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { searchAllAction, type UnifiedSearchResult } from "@/app/search/actions";
import { SearchIcon } from "@/components/SearchIcon";
import { HudFrame } from "@/components/HudFrame";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const KIND_HREF: Record<UnifiedSearchResult["kind"], (id: string) => string> = {
  QUICK_NOTE: (id) => `/dash-off/${id}`,
  PERMANENT_NOTE: (id) => `/zettelkasten?open=${id}`,
};

export function SearchClient({ initialQuery }: { initialQuery: string }) {
  const { t } = useI18n();
  const KIND_LABEL: Record<UnifiedSearchResult["kind"], string> = {
    QUICK_NOTE: t.search.kindQuickNote,
    PERMANENT_NOTE: t.search.kindPermanentNote,
  };
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<UnifiedSearchResult[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const r = await searchAllAction(q);
        setResults(r);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const trimmed = query.trim();

  return (
    <div className="flex flex-col gap-5">
      <HudFrame active={focused}>
        <SearchIcon active={focused} />
        <span aria-hidden="true" className="shrink-0 font-mono text-sm text-accent">
          &gt;
        </span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t.search.placeholder}
          style={{ caretColor: "var(--color-accent)" }}
          className="w-full bg-transparent font-mono text-ink placeholder:font-sans placeholder:text-ink-soft focus:outline-none"
        />
        {pending && <Spinner size="xs" />}
      </HudFrame>

      {trimmed && results && results.length > 0 && (
        <div className="flex flex-col">
          {results.map((r) => (
            <Link
              key={`${r.kind}-${r.id}`}
              href={KIND_HREF[r.kind](r.id)}
              className="group flex items-baseline gap-4 border-b border-line py-3 transition-colors hover:bg-surface"
            >
              <span className="w-24 shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-center font-mono text-[9.5px] text-ink-soft">
                {KIND_LABEL[r.kind]}
              </span>
              <span className="truncate text-sm text-ink group-hover:text-accent">{r.label}</span>
            </Link>
          ))}
        </div>
      )}

      {trimmed && results && results.length === 0 && !pending && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="text-sm text-ink-soft">{t.search.noResults(trimmed)}</span>
        </div>
      )}
    </div>
  );
}
