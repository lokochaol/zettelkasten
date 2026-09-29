"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { confirmDiscoveryLiteratureAction, writeNoteFromDiscoveryAction } from "@/app/dash-off/actions";
import type { DiscoveryCandidateSummary } from "@/lib/discovery";
import { useI18n } from "@/lib/i18n/LocaleProvider";

function CandidateNode({
  candidate,
  open,
  onToggle,
  citation,
  onCitationChange,
  url,
  onUrlChange,
  pending,
  onAdd,
  onWrite,
}: {
  candidate: DiscoveryCandidateSummary;
  open: boolean;
  onToggle: () => void;
  citation: string;
  onCitationChange: (v: string) => void;
  url: string;
  onUrlChange: (v: string) => void;
  pending: boolean;
  onAdd: () => void;
  onWrite: () => void;
}) {
  const { t } = useI18n();
  const confirmed = candidate.status === "CONFIRMED";
  return (
    <div className="w-[200px]">
      <button
        onClick={onToggle}
        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
          confirmed
            ? "border-line-strong bg-surface hover:border-ink-soft"
            : "border-dashed border-line-strong bg-surface-alt hover:border-ink-soft"
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[8px] tracking-widest text-ink-soft uppercase">
            {candidate.kind === "NEWS" ? t.discovery.kindNews : t.discovery.kindLiterature}
          </span>
          <span className="font-mono text-[8px] text-ink-faint">{candidate.confidence}%</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-ink">{candidate.title}</p>
        <span
          className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[7px] tracking-wide uppercase ${
            confirmed ? "border-line-strong text-ink" : "border-dashed border-line-strong text-ink-faint"
          }`}
        >
          <span className={`h-1 w-1 rounded-full ${confirmed ? "bg-accent" : "animate-pulse-dot bg-ink-faint"}`} />
          {confirmed ? t.discovery.confirmedLabel : t.discovery.candidateLabel}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface-alt p-3">
          <p className="text-xs text-ink-soft">{candidate.summary}</p>
          <input
            value={citation}
            onChange={(e) => onCitationChange(e.target.value)}
            placeholder={t.discovery.citationFieldPlaceholder}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-ink focus:border-accent focus:outline-none"
          />
          <input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={t.discovery.urlFieldPlaceholder}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-ink-soft focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onAdd}
              disabled={pending || confirmed}
              className="rounded-full border border-line-strong px-3 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
            >
              {confirmed ? t.discovery.addedLabel : t.discovery.addAction}
            </button>
            <button
              onClick={onWrite}
              disabled={pending}
              className="rounded-full border border-accent/60 px-3 py-1 font-mono text-[10px] text-accent transition-colors hover:border-accent disabled:opacity-50"
            >
              {t.discovery.writeAction}
            </button>
            {candidate.url && (
              <a
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-line-strong px-3 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:text-ink"
              >
                {candidate.kind === "NEWS" ? t.discovery.openArticleAction : t.discovery.openUrlAction}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Wide-landscape-only alternative to DiscoveryShelf: instead of a single
 * horizontal-scroll shelf mixing both kinds under the note, this splits
 * candidates by kind into two columns flanking the note card — news on the
 * left, literature on the right — connected by a horizontal line, so the
 * whole row reads as "signal → note → signal". Only rendered at the
 * `landscape:lg:` breakpoint (see ScratchTimeline); narrow/portrait screens
 * keep DiscoveryShelf's card-then-shelf-below layout untouched, so this
 * component is self-contained (its own confirm/write handling) rather than
 * sharing state with DiscoveryShelf — the two are mutually exclusive via
 * CSS, never both interactive at once.
 */
export function DiscoveryRail({
  candidates,
  onCandidatesChange,
  noteCard,
}: {
  candidates: DiscoveryCandidateSummary[];
  onCandidatesChange: (next: DiscoveryCandidateSummary[]) => void;
  noteCard: ReactNode;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [citation, setCitation] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);

  const news = candidates.filter((c) => c.kind === "NEWS");
  const literature = candidates.filter((c) => c.kind === "LITERATURE");

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

  if (news.length === 0 && literature.length === 0) {
    return <div className="flex w-full justify-center">{noteCard}</div>;
  }

  return (
    <div className="relative grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-line-strong/70 to-transparent"
      />

      <div className="relative z-10 flex flex-col items-end gap-2">
        {news.map((c) => (
          <CandidateNode
            key={c.id}
            candidate={c}
            open={openId === c.id}
            onToggle={() => toggleOpen(c)}
            citation={citation}
            onCitationChange={setCitation}
            url={url}
            onUrlChange={setUrl}
            pending={pending}
            onAdd={() => handleAdd(c)}
            onWrite={() => handleWrite(c)}
          />
        ))}
      </div>

      <div className="relative z-10">{noteCard}</div>

      <div className="relative z-10 flex flex-col items-start gap-2">
        {literature.map((c) => (
          <CandidateNode
            key={c.id}
            candidate={c}
            open={openId === c.id}
            onToggle={() => toggleOpen(c)}
            citation={citation}
            onCitationChange={setCitation}
            url={url}
            onUrlChange={setUrl}
            pending={pending}
            onAdd={() => handleAdd(c)}
            onWrite={() => handleWrite(c)}
          />
        ))}
      </div>
    </div>
  );
}
