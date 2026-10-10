"use client";

import { useEffect, useState } from "react";
import type { ChatProgress, ChatStage, ProgressItem } from "@/lib/chatProgress";

/**
 * The assistant's turn while it's still being written.
 *
 * Shows what the request is actually doing, from the stream
 * (src/lib/chatProgress.ts): which stage it's at, how long it has taken,
 * the reply as it forms, and each proposed meal or session as it lands.
 * Something on it always moves — the dots, the clock — so a long think
 * reads as working rather than stuck.
 */
export function ChatThinking({
  progress,
  startedAt,
  stageLabel,
  itemLabel,
  itemsHeading,
  elapsedLabel,
}: {
  progress: ChatProgress | null;
  startedAt: number;
  stageLabel: Record<ChatStage, string>;
  itemLabel: (item: ProgressItem) => string;
  itemsHeading: (n: number) => string;
  elapsedLabel: (seconds: number) => string;
}) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stage: ChatStage = progress?.stage ?? "context";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const items = progress?.items ?? [];
  const recent = items.slice(-5);

  return (
    <div className="flex max-w-[92%] flex-col gap-2 self-start" aria-live="polite">
      <div className="flex flex-col gap-1.5 rounded-2xl rounded-bl-md bg-surface-alt px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
          <span className="font-mono text-[10.5px] text-ink-soft">{stageLabel[stage]}</span>
          <span className="ml-auto font-mono text-[10px] text-ink-faint tabular-nums">{elapsedLabel(seconds)}</span>
        </div>
        {progress?.reply && (
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
            {progress.reply}
            {stage === "writing" && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />}
          </p>
        )}
      </div>
      {items.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-xl border border-accent/40 px-3 py-2">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{itemsHeading(items.length)}</p>
          {items.length > recent.length && <p className="font-mono text-[9.5px] text-ink-faint">…</p>}
          {recent.map((item, i) => (
            <p
              key={`${items.length - recent.length + i}`}
              className={`text-[11px] ${i === recent.length - 1 ? "text-ink" : "text-ink-soft"}`}
            >
              {itemLabel(item)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
