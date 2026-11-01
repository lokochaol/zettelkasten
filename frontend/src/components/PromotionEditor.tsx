"use client";

import { useState, type ReactNode } from "react";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { LiteratureMemoDraftField, type DraftLiteratureSelection } from "@/components/LiteratureMemoDraftField";
import { Spinner } from "@/components/LoadingSpinner";
import type { GlobalOrderEntry } from "@/lib/permanentNotes";
import type { IndexEntrySummary } from "@/lib/indexEntries";
import { validateDraft, type PermanentNoteDraft } from "@/lib/promotionValidation";
import { midpointRank } from "@/lib/rank";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { Dictionary } from "@/lib/i18n/types";

export interface EditableLink {
  clientId: string;
  relationLabel: string;
  target: { type: "PERMANENT_NOTE"; noteId: string; label: string } | { type: "INDEX_ENTRY"; indexEntryId: string; label: string };
}

export interface EditableDraft {
  clientId: string;
  title: string;
  content: string;
  links: EditableLink[];
  gap: { beforeId: string | null; afterId: string | null } | null;
  orderKey: string | null;
  literatureSelections: DraftLiteratureSelection[];
}

function toDraftForValidation(d: EditableDraft): PermanentNoteDraft {
  return {
    title: d.title,
    content: d.content,
    links: d.links.map((l) => ({ relationLabel: l.relationLabel, target: l.target })),
    orderKey: d.orderKey,
    literatureSelections: d.literatureSelections,
  };
}

function gapLabel(gap: EditableDraft["gap"], globalOrder: GlobalOrderEntry[], t: Dictionary): string {
  if (!gap) return t.promotionEditor.gapUnset;
  const beforeTitle = gap.beforeId
    ? (globalOrder.find((n) => n.id === gap.beforeId)?.title ?? "?")
    : t.zettelkasten.gapStart;
  const afterTitle = gap.afterId
    ? (globalOrder.find((n) => n.id === gap.afterId)?.title ?? "?")
    : t.zettelkasten.gapEnd;
  return t.promotionEditor.gapBetween(beforeTitle, afterTitle);
}

export function PromotionEditor({
  drafts,
  onChangeDrafts,
  activeDraftId,
  onSetActiveDraftId,
  indexEntries,
  globalOrder,
  onComplete,
  completing,
  completeError,
}: {
  drafts: EditableDraft[];
  onChangeDrafts: (drafts: EditableDraft[]) => void;
  activeDraftId: string | null;
  onSetActiveDraftId: (id: string | null) => void;
  indexEntries: IndexEntrySummary[];
  globalOrder: GlobalOrderEntry[];
  onComplete: () => void;
  completing: boolean;
  completeError: string | null;
}) {
  const { t, locale } = useI18n();
  function updateDraft(clientId: string, patch: Partial<EditableDraft>) {
    onChangeDrafts(drafts.map((d) => (d.clientId === clientId ? { ...d, ...patch } : d)));
  }

  // With zero existing PermanentNotes there is exactly one possible save
  // position (the start of an empty sequence) and nothing to link to — both
  // requirements are waived, and the position is filled in automatically
  // rather than making the owner click through an empty pile picker.
  const hasExistingNotes = globalOrder.length > 0;

  function addDraft() {
    onChangeDrafts([
      ...drafts,
      {
        clientId: crypto.randomUUID(),
        title: "",
        content: "",
        links: [],
        gap: hasExistingNotes ? null : { beforeId: null, afterId: null },
        orderKey: hasExistingNotes ? null : midpointRank(null, null),
        literatureSelections: [],
      },
    ]);
  }

  function removeDraft(clientId: string) {
    onChangeDrafts(drafts.filter((d) => d.clientId !== clientId));
    if (activeDraftId === clientId) onSetActiveDraftId(null);
  }

  const problemsByDraft = new Map(
    drafts.map((d) => [d.clientId, validateDraft(toDraftForValidation(d), { hasExistingNotes, locale })]),
  );
  const incompleteCount = drafts.filter((d) => (problemsByDraft.get(d.clientId)?.length ?? 0) > 0).length;
  const allValid = drafts.length > 0 && incompleteCount === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
        <span className="text-accent">②</span> {t.promotionEditor.heading(drafts.length)}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {drafts.length === 0 && (
          <p className="py-8 text-center text-xs text-ink-soft">{t.promotionEditor.empty}</p>
        )}

        <div className="flex flex-col gap-3">
          {drafts.map((draft, i) => {
            const problems = problemsByDraft.get(draft.clientId) ?? [];
            return (
              <DraftCard
                key={draft.clientId}
                index={i + 1}
                draft={draft}
                problems={problems}
                isPickingPosition={activeDraftId === draft.clientId}
                indexEntries={indexEntries}
                globalOrder={globalOrder}
                hasExistingNotes={hasExistingNotes}
                onChange={(patch) => updateDraft(draft.clientId, patch)}
                onRemove={() => removeDraft(draft.clientId)}
                onTogglePositionPicker={() =>
                  onSetActiveDraftId(activeDraftId === draft.clientId ? null : draft.clientId)
                }
                t={t}
              />
            );
          })}
        </div>

        <button
          onClick={addDraft}
          className="mt-3 w-full rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
        >
          {t.promotionEditor.addDraft}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-alt px-4 py-3">
        <span className="font-mono text-[10px] text-ink-faint">
          {drafts.length === 0
            ? t.promotionEditor.summaryEmpty
            : incompleteCount > 0
              ? t.promotionEditor.summaryIncomplete(drafts.length, incompleteCount)
              : t.promotionEditor.summaryComplete}
        </span>
        {completeError && <span className="font-mono text-[10px] text-alert">{completeError}</span>}
        <button
          disabled={!allValid || completing}
          onClick={onComplete}
          className="btn-sheen flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-bold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-faint disabled:hover:scale-100"
        >
          {completing && <Spinner size="xs" />}
          {completing ? t.promotionEditor.completing : t.promotionEditor.completeButton}
        </button>
      </div>
    </div>
  );
}

function DraftCard({
  index,
  draft,
  problems,
  isPickingPosition,
  indexEntries,
  globalOrder,
  hasExistingNotes,
  onChange,
  onRemove,
  onTogglePositionPicker,
  t,
}: {
  index: number;
  draft: EditableDraft;
  problems: string[];
  isPickingPosition: boolean;
  indexEntries: IndexEntrySummary[];
  globalOrder: GlobalOrderEntry[];
  hasExistingNotes: boolean;
  onChange: (patch: Partial<EditableDraft>) => void;
  onRemove: () => void;
  onTogglePositionPicker: () => void;
  t: Dictionary;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-alt p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-bold text-ink">
          <span className="font-mono text-accent">{String(index).padStart(2, "0")}</span>
        </h4>
        <button onClick={onRemove} className="font-mono text-[10px] text-ink-soft hover:text-accent">
          {t.common.delete}
        </button>
      </div>

      <Field label={t.promotionEditor.titleField} filled={!!draft.title.trim()}>
        <input
          value={draft.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t.promotionEditor.titlePlaceholder}
          className="w-full bg-transparent text-sm font-bold text-ink placeholder:font-normal placeholder:text-ink-soft focus:outline-none"
        />
      </Field>

      <div className="mt-2.5">
        <label className="mb-1.5 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
          {t.promotionEditor.contentField}
        </label>
        {/* Live-sync, not a save: this only mirrors keystrokes into the
            surrounding draft state, which the promotion form itself submits.
            An inner Save button would read as a second, competing save. */}
        <MarkdownNoteEditor content={draft.content} onChange={(content) => onChange({ content })} />
      </div>

      <div className="mt-2.5">
        <LinkPicker
          links={draft.links}
          indexEntries={indexEntries}
          globalOrder={globalOrder}
          required={hasExistingNotes}
          onChange={(links) => onChange({ links })}
          t={t}
        />
      </div>

      <div className="mt-2.5">
        <label className="mb-1.5 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
          {t.promotionEditor.literatureField}
        </label>
        <LiteratureMemoDraftField
          selections={draft.literatureSelections}
          onChange={(literatureSelections) => onChange({ literatureSelections })}
        />
      </div>

      <Field
        label={t.promotionEditor.positionField}
        filled={!!draft.orderKey}
        onClick={hasExistingNotes ? onTogglePositionPicker : undefined}
      >
        <span className="flex items-center justify-between">
          {hasExistingNotes ? gapLabel(draft.gap, globalOrder, t) : t.promotionEditor.firstNoteHint}
          {hasExistingNotes && (
            <span className="font-mono text-[10px] text-ink-faint">
              {isPickingPosition ? t.promotionEditor.positionPickingLabel : t.promotionEditor.positionChangeLabel}
            </span>
          )}
        </span>
      </Field>

      {problems.length > 0 && (
        <p className="mt-2 font-mono text-[9.5px] text-accent">{problems.join(" / ")}</p>
      )}
    </div>
  );
}

function Field({
  label,
  filled,
  onClick,
  children,
}: {
  label: string;
  filled: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-2.5">
      <label className="mb-1.5 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{label}</label>
      <div
        onClick={onClick}
        className={`min-h-8 rounded-md border px-2.5 py-2 text-[11.5px] ${
          filled ? "border-line text-ink" : "border-accent/50 text-accent"
        } ${onClick ? "cursor-pointer" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function LinkPicker({
  links,
  indexEntries,
  globalOrder,
  required,
  onChange,
  t,
}: {
  links: EditableLink[];
  indexEntries: IndexEntrySummary[];
  globalOrder: GlobalOrderEntry[];
  required: boolean;
  onChange: (links: EditableLink[]) => void;
  t: Dictionary;
}) {
  const [kind, setKind] = useState<"INDEX_ENTRY" | "PERMANENT_NOTE">("INDEX_ENTRY");
  const [targetId, setTargetId] = useState("");
  const [relationLabel, setRelationLabel] = useState("");

  function addLink() {
    if (!targetId || !relationLabel.trim()) return;
    if (kind === "INDEX_ENTRY") {
      const entry = indexEntries.find((e) => e.id === targetId);
      if (!entry) return;
      onChange([
        ...links,
        {
          clientId: crypto.randomUUID(),
          relationLabel: relationLabel.trim(),
          target: { type: "INDEX_ENTRY", indexEntryId: entry.id, label: entry.keyword },
        },
      ]);
    } else {
      const note = globalOrder.find((n) => n.id === targetId);
      if (!note) return;
      onChange([
        ...links,
        {
          clientId: crypto.randomUUID(),
          relationLabel: relationLabel.trim(),
          target: { type: "PERMANENT_NOTE", noteId: note.id, label: note.title },
        },
      ]);
    }
    setTargetId("");
    setRelationLabel("");
  }

  return (
    <div>
      <label className="mb-1.5 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
        {t.promotionEditor.linkField(required)}
      </label>

      {links.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {links.map((l) => (
            <span
              key={l.clientId}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 font-mono text-[10px] text-accent"
            >
              <b className="font-bold">{l.relationLabel}</b>
              <span className="text-ink-soft">
                ／ {l.target.type === "INDEX_ENTRY" ? t.promotionEditor.linkTargetIndexPrefix : t.promotionEditor.linkTargetNotePrefix}: {l.target.label}
              </span>
              <button
                onClick={() => onChange(links.filter((x) => x.clientId !== l.clientId))}
                className="opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {required && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setTargetId("");
            }}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
          >
            <option value="INDEX_ENTRY">{t.promotionEditor.linkKindIndex}</option>
            <option value="PERMANENT_NOTE">{t.promotionEditor.linkKindNote}</option>
          </select>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
          >
            <option value="">{t.promotionEditor.linkTargetPlaceholder}</option>
            {(kind === "INDEX_ENTRY" ? indexEntries : globalOrder).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {"keyword" in opt ? opt.keyword : opt.title}
              </option>
            ))}
          </select>
          <input
            value={relationLabel}
            onChange={(e) => setRelationLabel(e.target.value)}
            placeholder={t.promotionEditor.linkRelationPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[10.5px] text-ink placeholder:text-ink-faint"
          />
          <button
            onClick={addLink}
            disabled={!targetId || !relationLabel.trim()}
            className="rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {t.promotionEditor.linkAddButton}
          </button>
        </div>
      )}
    </div>
  );
}
