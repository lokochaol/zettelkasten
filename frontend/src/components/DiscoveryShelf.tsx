"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmDiscoveryLiteratureAction, writeNoteFromDiscoveryAction } from "@/app/dash-off/actions";
import type { DiscoveryCandidateSummary } from "@/lib/discovery";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The "関連" shelf attached under a QuickNote card (see the Discovery Rails
 * design doc — concept A-2). Candidates are AI-surfaced "might be related"
 * suggestions the app never judges the relevance of itself: a card starts
 * dashed/"AI候補" and only becomes solid/"確認済み" once the owner actually
 * adds it to their literature or writes a note from it — there is no
 * separate relevant/not-relevant action.
 */
export function DiscoveryShelf({
  candidates,
  onCandidatesChange,
}: {
  candidates: DiscoveryCandidateSummary[];
  onCandidatesChange: (next: DiscoveryCandidateSummary[]) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const [citation, setCitation] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);

  if (candidates.length === 0) return null;

  function toggleOpen(c: DiscoveryCandidateSummary) {
    if (openId === c.id) {
      setOpenId(null);
      return;
    }
    setOpenId(c.id);
    setCitation(c.title);
    setUrl(c.url ?? "");
  }

  async function handleAdd(c: DiscoveryCandidateSummary) {
    setPending(true);
    try {
      const { literatureMemoId } = await confirmDiscoveryLiteratureAction(c.id, { citation, url: url.trim() || null });
      onCandidatesChange(
        candidates.map((x) => (x.id === c.id ? { ...x, status: "CONFIRMED" as const, literatureMemoId } : x)),
      );
    } finally {
      setPending(false);
    }
  }

  async function handleWrite(c: DiscoveryCandidateSummary) {
    setPending(true);
    try {
      const note = await writeNoteFromDiscoveryAction(c.id, { citation, url: url.trim() || null });
      onCandidatesChange(candidates.map((x) => (x.id === c.id ? { ...x, status: "CONFIRMED" as const } : x)));
      router.push(`/dash-off/${note.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 border-t border-dashed border-line pt-2">
      <span className="font-mono text-[8.5px] tracking-widest text-ink-faint uppercase">
        {t.discovery.shelfLabel(candidates.length)}
      </span>

      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
        {candidates.map((c) => {
          const confirmed = c.status === "CONFIRMED";
          return (
            <button
              key={c.id}
              onClick={() => toggleOpen(c)}
              className={`w-[168px] shrink-0 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                confirmed
                  ? "border-line-strong bg-surface hover:border-ink-soft"
                  : "border-dashed border-line-strong bg-surface-alt hover:border-ink-soft"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[8px] tracking-widest text-ink-soft uppercase">
                  {c.kind === "NEWS" ? t.discovery.kindNews : t.discovery.kindLiterature}
                </span>
                <span className="font-mono text-[8px] text-ink-faint">{c.confidence}%</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-ink">{c.title}</p>
              <span
                className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[7px] tracking-wide uppercase ${
                  confirmed ? "border-line-strong text-ink" : "border-dashed border-line-strong text-ink-faint"
                }`}
              >
                <span className={`h-1 w-1 rounded-full ${confirmed ? "bg-accent" : "animate-pulse-dot bg-ink-faint"}`} />
                {confirmed ? t.discovery.confirmedLabel : t.discovery.candidateLabel}
              </span>
            </button>
          );
        })}
      </div>

      {candidates.map(
        (c) =>
          openId === c.id && (
            <div key={c.id} className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface-alt p-3">
              <p className="text-xs text-ink-soft">{c.summary}</p>
              <input
                value={citation}
                onChange={(e) => setCitation(e.target.value)}
                placeholder={t.discovery.citationFieldPlaceholder}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-ink focus:border-accent focus:outline-none"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.discovery.urlFieldPlaceholder}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-ink-soft focus:border-accent focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleAdd(c)}
                  disabled={pending || c.status === "CONFIRMED"}
                  className="rounded-full border border-line-strong px-3 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
                >
                  {c.status === "CONFIRMED" ? t.discovery.addedLabel : t.discovery.addAction}
                </button>
                <button
                  onClick={() => handleWrite(c)}
                  disabled={pending}
                  className="rounded-full border border-accent/60 px-3 py-1 font-mono text-[10px] text-accent transition-colors hover:border-accent disabled:opacity-50"
                >
                  {t.discovery.writeAction}
                </button>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-line-strong px-3 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:text-ink"
                  >
                    {c.kind === "NEWS" ? t.discovery.openArticleAction : t.discovery.openUrlAction}
                  </a>
                )}
              </div>
            </div>
          ),
      )}
    </div>
  );
}
