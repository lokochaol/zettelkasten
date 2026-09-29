import type { ReactNode } from "react";

export interface TimelineRow {
  key: string;
  meta?: ReactNode;
  card: ReactNode;
  dotClassName?: string;
}

/**
 * The vertical dot+line timeline visual, extracted from the original
 * src/app/page.tsx home layout. Shared by /dash-off's active-quick-note
 * timeline and PileDrill's flat (<=FLAT_THRESHOLD) view so a fully drilled
 * pile reads exactly like the 走り書き timeline.
 */
export function NoteTimeline({ rows, emptyLabel }: { rows: TimelineRow[]; emptyLabel?: string }) {
  return (
    <div className="relative flex flex-col items-center">
      {rows.length > 0 && (
        <div aria-hidden="true" className="absolute top-9 bottom-9 left-1/2 w-px -translate-x-1/2 bg-line-strong" />
      )}

      {rows.length === 0 && emptyLabel && <p className="py-16 text-center text-sm text-ink-soft">{emptyLabel}</p>}

      {rows.map((row) => (
        <div key={row.key} className="relative flex w-full flex-col items-center gap-2 py-6">
          <span className={`h-2 w-2 rounded-full bg-ink ${row.dotClassName ?? ""}`} />
          {row.meta}
          {row.card}
        </div>
      ))}
    </div>
  );
}
