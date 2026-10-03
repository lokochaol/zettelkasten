"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveDrillPath, type Breadcrumb } from "@/lib/pile";
import { NoteTimeline } from "@/components/NoteTimeline";
import { EmbeddedContentPreview } from "@/components/EmbeddedContentPreview";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { Dictionary } from "@/lib/i18n/types";

export interface PileDrillItem {
  id: string;
  title: string;
}

export interface GapSelection {
  beforeId: string | null;
  afterId: string | null;
}

/**
 * The pile grid + zigzag-line browser, and (in pick-position mode) the
 * gap-slot save-position picker — the same component instance drives both,
 * per §6 of the plan. `items` must be the full owner-wide ordered list (or a
 * sub-slice that is itself contiguous in that order) so the recursive
 * chunking in src/lib/pile.ts always operates over one true global sequence.
 */
export function PileDrill({
  items,
  drillPath,
  onDrillPathChange,
  columns,
  mode,
  onOpenNote,
  onSelectGap,
  selectedGap = null,
  loadContent,
  emptyLabel,
}: {
  items: PileDrillItem[];
  drillPath: number[];
  onDrillPathChange: (path: number[]) => void;
  columns: number;
  mode: "browse" | "pick-position";
  onOpenNote?: (id: string) => void;
  onSelectGap?: (gap: GapSelection) => void;
  selectedGap?: GapSelection | null;
  loadContent: (id: string) => Promise<string>;
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  const resolvedEmptyLabel = emptyLabel ?? t.zettelkasten.emptyDrill;
  const groupSize = Math.max(columns * 3, columns); // enough rows per screenful, at least one row
  const drillLabels = useMemo(
    () => ({ all: t.zettelkasten.drillAllLabel, group: t.zettelkasten.drillGroupLabel }),
    [t],
  );
  const result = useMemo(
    () => resolveDrillPath(items, drillPath, groupSize, drillLabels),
    [items, drillPath, groupSize, drillLabels],
  );

  const [contentCache, setContentCache] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!result.isFlat || !result.flatItems) return;
    const missing = result.flatItems.filter((it) => !contentCache.has(it.id));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async (it) => [it.id, await loadContent(it.id)] as const)).then((pairs) => {
      if (cancelled) return;
      setContentCache((prev) => {
        const next = new Map(prev);
        for (const [id, content] of pairs) next.set(id, content);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.isFlat, result.flatItems, loadContent]);

  if (items.length === 0) {
    return <p className="py-16 text-center text-sm text-ink-soft">{resolvedEmptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs breadcrumbs={result.breadcrumbs} onNavigate={onDrillPathChange} />

      {result.isFlat && result.flatItems ? (
        <FlatView
          flatItems={result.flatItems}
          fullOrder={items}
          mode={mode}
          onOpenNote={onOpenNote}
          onSelectGap={onSelectGap}
          selectedGap={selectedGap}
          contentCache={contentCache}
          t={t}
        />
      ) : (
        result.groups && (
          <GridView
            groups={result.groups}
            columns={columns}
            onDrillIn={(idx) => onDrillPathChange([...drillPath, idx])}
            t={t}
          />
        )
      )}
    </div>
  );
}

function Breadcrumbs({
  breadcrumbs,
  onNavigate,
}: {
  breadcrumbs: Breadcrumb[];
  onNavigate: (path: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-ink-soft">
      {breadcrumbs.map((b, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink-soft/60">›</span>}
          {i === breadcrumbs.length - 1 ? (
            <b className="font-semibold text-accent">{b.label}</b>
          ) : (
            <button onClick={() => onNavigate(b.path)} className="hover:text-accent">
              {b.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

function GridView({
  groups,
  columns,
  onDrillIn,
  t,
}: {
  groups: PileDrillItem[][];
  columns: number;
  onDrillIn: (idx: number) => void;
  t: Dictionary;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);

  useLayoutEffect(() => {
    function draw() {
      const container = containerRef.current;
      if (!container) return;
      const box = container.getBoundingClientRect();
      const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-pile-card]"));
      setPoints(
        cards.map((card) => {
          const r = card.getBoundingClientRect();
          return { x: r.left - box.left + r.width / 2, y: r.top - box.top };
        }),
      );
    }
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [groups, columns]);

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div ref={containerRef} className="relative">
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <polyline points={polyline} fill="none" stroke="var(--color-line-strong)" strokeWidth={1} />
      </svg>
      <div className="relative z-10 grid gap-3.5" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {groups.map((group, i) => (
          <button
            key={group[0]?.id ?? i}
            data-pile-card
            onClick={() => onDrillIn(i)}
            className="relative flex min-h-[76px] flex-col justify-between rounded-lg border border-line bg-surface-alt p-3 text-left transition-colors hover:border-accent/60"
          >
            <span
              aria-hidden="true"
              className="absolute top-[-8px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-line-strong shadow-[0_0_0_3px_var(--color-surface)]"
            />
            <span className="line-clamp-3 text-xs text-ink">{group[0]?.title}</span>
            <span className="mt-2 self-end rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] text-accent">
              {t.zettelkasten.pileGroupLabel(group.length)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function GapSlot({
  before,
  after,
  chosen,
  onClick,
  t,
}: {
  before: PileDrillItem | null;
  after: PileDrillItem | null;
  chosen: boolean;
  onClick: () => void;
  t: Dictionary;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-6 w-full items-center justify-center"
      aria-label={t.zettelkasten.gapSlotAriaLabel(before?.title ?? t.zettelkasten.gapStart, after?.title ?? t.zettelkasten.gapEnd)}
    >
      <span
        className={`w-full border-t ${chosen ? "border-t-2 border-accent" : "border-dashed border-line-strong group-hover:border-accent"}`}
      />
      <span
        className={`absolute rounded-sm bg-surface px-1.5 font-mono text-[9px] ${
          chosen ? "text-accent opacity-100" : "text-ink-faint mouse:opacity-0 group-hover:opacity-100"
        }`}
      >
        {chosen ? t.zettelkasten.gapSlotChosen : t.zettelkasten.gapSlotSave}
      </span>
    </button>
  );
}

function FlatView({
  flatItems,
  fullOrder,
  mode,
  onOpenNote,
  onSelectGap,
  selectedGap,
  contentCache,
  t,
}: {
  flatItems: PileDrillItem[];
  fullOrder: PileDrillItem[];
  mode: "browse" | "pick-position";
  onOpenNote?: (id: string) => void;
  onSelectGap?: (gap: GapSelection) => void;
  selectedGap: GapSelection | null;
  contentCache: Map<string, string>;
  t: Dictionary;
}) {
  const globalStart = fullOrder.findIndex((it) => it.id === flatItems[0]?.id);
  const before: PileDrillItem | null = globalStart > 0 ? fullOrder[globalStart - 1] : null;
  const after: PileDrillItem | null =
    globalStart >= 0 && globalStart + flatItems.length < fullOrder.length
      ? fullOrder[globalStart + flatItems.length]
      : null;

  function isChosen(b: PileDrillItem | null, a: PileDrillItem | null): boolean {
    if (!selectedGap) return false;
    return (selectedGap.beforeId ?? null) === (b?.id ?? null) && (selectedGap.afterId ?? null) === (a?.id ?? null);
  }

  const rows = flatItems.map((item) => ({
    key: item.id,
    meta: (
      <span className="font-mono text-[9.5px] tracking-wider text-ink-faint">
        <span className="text-accent">{"//"}</span> {item.title}
      </span>
    ),
    card: (
      <div
        onClick={mode === "browse" ? () => onOpenNote?.(item.id) : undefined}
        className={`w-full max-w-[420px] rounded-lg border border-line bg-surface-alt p-4 ${
          mode === "browse" ? "cursor-pointer transition-colors hover:border-accent/60" : ""
        }`}
      >
        <NoteContent content={contentCache.get(item.id)} />
      </div>
    ),
  }));

  if (mode !== "pick-position") {
    return <NoteTimeline rows={rows} />;
  }

  // pick-position: interleave gap slots before/between/after every card.
  return (
    <div className="flex flex-col items-center">
      <GapSlot
        before={null}
        after={flatItems[0] ?? null}
        chosen={isChosen(before, flatItems[0] ?? null)}
        onClick={() => onSelectGap?.({ beforeId: before?.id ?? null, afterId: flatItems[0]?.id ?? null })}
        t={t}
      />
      {flatItems.map((item, i) => {
        const nextItem = flatItems[i + 1] ?? null;
        return (
          <div key={item.id} className="flex w-full flex-col items-center">
            <div className="w-full max-w-[420px] rounded-lg border border-line bg-surface-alt p-4">
              <p className="mb-2 font-mono text-[9.5px] tracking-wider text-accent">{item.title}</p>
              <NoteContent content={contentCache.get(item.id)} />
            </div>
            <GapSlot
              before={item}
              after={nextItem}
              chosen={isChosen(item, nextItem ?? after)}
              onClick={() => onSelectGap?.({ beforeId: item.id, afterId: nextItem?.id ?? after?.id ?? null })}
              t={t}
            />
          </div>
        );
      })}
    </div>
  );
}

function NoteContent({ content }: { content: string | undefined }) {
  if (content === undefined) {
    return <Spinner size="xs" />;
  }
  return <EmbeddedContentPreview content={content} />;
}
