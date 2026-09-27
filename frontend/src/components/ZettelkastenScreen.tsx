"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PileDrill, type GapSelection } from "@/components/PileDrill";
import { PromotionEditor, type EditableDraft } from "@/components/PromotionEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmbeddedContentPreview } from "@/components/EmbeddedContentPreview";
import { PermanentNoteLiteratureSection } from "@/components/PermanentNoteLiteratureSection";
import { LiteratureMemoPane } from "@/components/LiteratureMemoPane";
import { QuickNoteInlineTimeline } from "@/components/QuickNoteInlineTimeline";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { navigateWithViewTransition } from "@/lib/viewTransition";
import type { DeletionImpact, GlobalOrderEntry, PermanentNoteDetail } from "@/lib/permanentNotes";
import type { IndexEntrySummary } from "@/lib/indexEntries";
import type { QuickNoteSummary } from "@/lib/quickNotes";
import {
  computeInsertRankAction,
  createIndexEntryAction,
  removeIndexEntryAction,
  listIndexEntriesAction,
  getPermanentNoteDetailAction,
  updatePermanentNoteAction,
  getPermanentNoteDeletionImpactAction,
  deletePermanentNoteAction,
  completePromotionAction,
  getGlobalOrderAction,
} from "@/app/zettelkasten/actions";
import { getQuickNoteDetailAction, listActiveQuickNotesAction } from "@/app/scratch/actions";
import type { CompletePromotionInput } from "@/lib/promotion";
import { midpointRank } from "@/lib/rank";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useBackdropDismiss } from "@/lib/useBackdropDismiss";
import { useUnsavedChanges, useRegisterUnsavedEditor } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { AppBrand } from "@/components/AppBrand";
import { LocaleToggle } from "@/components/LocaleToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeaderMenu } from "@/components/HeaderMenu";
import { ZettelkastenSideActionBar, type ZettelkastenMainView } from "@/components/ZettelkastenSideActionBar";
import { ZettelkastenProjectsPane } from "@/components/ZettelkastenProjectsPane";
import { ZettelkastenCalendarPane } from "@/components/ZettelkastenCalendarPane";
import { ZettelkastenDiscoveryPane } from "@/components/ZettelkastenDiscoveryPane";
import { ZettelkastenProjectDetailPane } from "@/components/ZettelkastenProjectDetailPane";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { SignOutButton } from "@/components/SignOutButton";
import { RotateDeviceGate } from "@/components/RotateDeviceGate";

export function ZettelkastenScreen({
  initialGlobalOrder,
  initialActiveQuickNotes,
  initialIndexEntries,
  deepLinkOpenId,
  userEmail,
}: {
  initialGlobalOrder: GlobalOrderEntry[];
  initialActiveQuickNotes: QuickNoteSummary[];
  initialIndexEntries: IndexEntrySummary[];
  deepLinkOpenId?: string;
  userEmail: string;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [globalOrder, setGlobalOrder] = useState(initialGlobalOrder);
  const [activeQuickNotes, setActiveQuickNotes] = useState(initialActiveQuickNotes);
  const [indexEntries, setIndexEntries] = useState(initialIndexEntries);

  const [selectedQuickNoteIds, setSelectedQuickNoteIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [drillPath, setDrillPath] = useState<number[]>([]);
  const [indexPanelOpen, setIndexPanelOpen] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(deepLinkOpenId ?? null);
  const [col1Mode, setCol1Mode] = useState<"notes" | "literature">("notes");
  const [mainView, setMainView] = useState<ZettelkastenMainView>("notes");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectDate, setActiveProjectDate] = useState<string | null>(null);

  function openProject(id: string, date: string | null = null) {
    setActiveProjectId(id);
    setActiveProjectDate(date);
  }
  const [focusQuickNoteRequest, setFocusQuickNoteRequest] = useState<{ id: string; token: number } | null>(null);

  function focusQuickNote(id: string) {
    setFocusQuickNoteRequest((prev) => ({ id, token: (prev?.token ?? 0) + 1 }));
  }

  const editorOpen = drafts.length > 0 || selectedQuickNoteIds.size > 0;

  const col1Ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    const el = col1Ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setColumns(Math.max(1, Math.floor(width / 160)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mode: "browse" | "pick-position" = activeDraftId ? "pick-position" : "browse";
  const activeDraft = drafts.find((d) => d.clientId === activeDraftId) ?? null;

  async function handleSelectGap(gap: GapSelection) {
    if (!activeDraft) return;
    const orderKey = await computeInsertRankAction(gap.beforeId, gap.afterId);
    setDrafts((prev) =>
      prev.map((d) => (d.clientId === activeDraft.clientId ? { ...d, gap, orderKey } : d)),
    );
  }

  const loadContent = useCallback(async (id: string): Promise<string> => {
    const detail = await getPermanentNoteDetailAction(id);
    return detail.content;
  }, []);

  function toggleQuickNoteSelection(id: string) {
    setSelectedQuickNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Appends an empty draft. `literatureSelections` carries over whatever the
   * source 走り書き cited when promoting; writing straight into the
   * Zettelkasten passes none. */
  function addDraft(literatureSelections: EditableDraft["literatureSelections"]) {
    // With zero existing PermanentNotes there's only one possible position —
    // fill it in automatically rather than sending the owner into an empty
    // pile picker (see PromotionEditor's matching addDraft logic).
    const hasExistingNotes = globalOrder.length > 0;
    setDrafts((prev) => [
      ...prev,
      {
        clientId: crypto.randomUUID(),
        title: "",
        content: "",
        links: [],
        gap: hasExistingNotes ? null : { beforeId: null, afterId: null },
        orderKey: hasExistingNotes ? null : midpointRank(null, null),
        literatureSelections,
      },
    ]);
  }

  async function buildDraftFromSelection() {
    const ids = [...selectedQuickNoteIds];
    if (ids.length === 0) return;
    const details = await Promise.all(ids.map((id) => getQuickNoteDetailAction(id)));
    // One merged 永久保存版メモ draft from all selected 走り書き — content is
    // intentionally NOT carried over (it gets rewritten from scratch), but
    // each source note's own linked 文献メモ carries through, deduped, so a
    // memo cited by two of the selected 走り書き doesn't show up twice.
    const seenMemoIds = new Set<string>();
    const literatureSelections = details
      .map((d) => d.literatureMemo)
      .filter((m): m is NonNullable<typeof m> => !!m)
      .filter((m) => (seenMemoIds.has(m.id) ? false : (seenMemoIds.add(m.id), true)))
      .map((m) => ({ type: "existing" as const, id: m.id, citation: m.citation }));
    addDraft(literatureSelections);
  }

  async function refreshGlobalOrder() {
    setGlobalOrder(await getGlobalOrderAction());
  }

  async function handleComplete() {
    setCompleting(true);
    setCompleteError(null);
    const input: CompletePromotionInput = {
      quickNoteIds: [...selectedQuickNoteIds],
      drafts: drafts.map((d) => ({
        title: d.title,
        content: d.content,
        links: d.links.map((l) => ({ relationLabel: l.relationLabel, target: l.target })),
        orderKey: d.orderKey,
        literatureSelections: d.literatureSelections,
      })),
    };
    const res = await completePromotionAction(input);
    setCompleting(false);
    if ("error" in res) {
      setCompleteError(res.error);
      return;
    }
    setSelectedQuickNoteIds(new Set());
    setDrafts([]);
    setActiveDraftId(null);
    setDrillPath([]);
    const [order, active] = await Promise.all([getGlobalOrderAction(), listActiveQuickNotesAction()]);
    setGlobalOrder(order);
    setActiveQuickNotes(active);
  }

  function handleNavigateToScratch() {
    navigateWithViewTransition(router, "/scratch");
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      <RotateDeviceGate />
      <div className="flex items-center gap-3 border-b border-line px-6 py-3.5">
        <span className="text-sm font-extrabold tracking-tight text-ink">
          <AppBrand locale={locale} screen="zettelkasten" />
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleNavigateToScratch}
            className="rounded-full border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft transition-colors hover:text-ink"
          >
            <span className="text-accent">←</span> {t.zettelkasten.backToScratch}
          </button>
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={userEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {t.nav.settingsLabel}
              </Link>
            </div>
            <button
              onClick={() => setCol1Mode("literature")}
              className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent"
            >
              {t.zettelkasten.literatureNav}
            </button>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {t.nav.guideLabel}
            </Link>
            <LocaleToggle />
            <ThemeToggle />
            <SignOutButton />
          </HeaderMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ZettelkastenSideActionBar
          active={mainView}
          onSelect={(view) => {
            setActiveProjectId(null);
            setMainView(view);
          }}
        />
        {activeProjectId && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-6">
            <ZettelkastenProjectDetailPane
              key={activeProjectId}
              projectId={activeProjectId}
              initialDate={activeProjectDate}
              onBack={() => setActiveProjectId(null)}
            />
          </div>
        )}
        {!activeProjectId && mainView === "projects" && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-6">
            <ZettelkastenProjectsPane onOpenProject={(id) => openProject(id)} />
          </div>
        )}
        {!activeProjectId && mainView === "calendar" && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-6 py-6">
            <ZettelkastenCalendarPane onOpenProject={(id) => openProject(id)} />
          </div>
        )}
        {!activeProjectId && mainView === "discovery" && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <ZettelkastenDiscoveryPane />
          </div>
        )}
        {!activeProjectId && mainView === "notes" && (
        <div
          className="grid min-h-0 min-w-0 flex-1 transition-[grid-template-columns] duration-400 ease-out"
          style={{ gridTemplateColumns: editorOpen ? "1.05fr 1fr 0.7fr" : "1.3fr 0px 0.85fr" }}
        >
          {/* ① */}
          <div ref={col1Ref} className="relative min-w-0 overflow-hidden border-r border-line">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
              <span className="text-accent">①</span>
              <div className="flex gap-1 normal-case">
                <button
                  onClick={() => setCol1Mode("notes")}
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                    col1Mode === "notes"
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-line-strong text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.zettelkasten.columnTitle}
                </button>
                <button
                  onClick={() => setCol1Mode("literature")}
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                    col1Mode === "literature"
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-line-strong text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.zettelkasten.literatureTabLabel}
                </button>
              </div>
              {col1Mode === "notes" && (
                <>
                  <span className="normal-case">{t.zettelkasten.countAll(globalOrder.length)}</span>
                  {/* Writing one straight into the Zettelkasten, with no
                      走り書き behind it — lives here because picking its
                      position happens in this very column. */}
                  <button
                    onClick={() => addDraft([])}
                    className="ml-auto rounded-full border border-line-strong px-2.5 py-1 text-[10px] text-ink-soft normal-case hover:border-accent hover:text-accent"
                  >
                    {t.zettelkasten.addPermanentNote}
                  </button>
                  <button
                    onClick={() => setIndexPanelOpen((v) => !v)}
                    className="rounded-full border border-line-strong px-2.5 py-1 text-[10px] text-ink-soft normal-case hover:text-ink"
                  >
                    {t.zettelkasten.indexToggle}
                  </button>
                </>
              )}
            </div>

            {col1Mode === "notes" && indexPanelOpen && (
              <IndexPanel
                entries={indexEntries}
                onSelect={(noteId) => {
                  setOpenNoteId(noteId);
                  setIndexPanelOpen(false);
                }}
                onRemove={async (id) => {
                  await removeIndexEntryAction(id);
                  setIndexEntries((prev) => prev.filter((e) => e.id !== id));
                }}
              />
            )}

            <div className="flex min-h-0 flex-col" style={{ height: "calc(100dvh - 130px)" }}>
              {col1Mode === "notes" ? (
                <div className="overflow-auto p-4">
                  <PileDrill
                    items={globalOrder}
                    drillPath={drillPath}
                    onDrillPathChange={setDrillPath}
                    columns={columns}
                    mode={mode}
                    onOpenNote={(id) => setOpenNoteId(id)}
                    onSelectGap={handleSelectGap}
                    selectedGap={activeDraft?.gap ?? null}
                    loadContent={loadContent}
                  />
                </div>
              ) : (
                <LiteratureMemoPane onOpenPermanentNote={(id) => setOpenNoteId(id)} onOpenQuickNote={focusQuickNote} />
              )}
            </div>
          </div>

          {/* ② */}
          <div className="min-w-0 overflow-hidden border-r border-line">
            {editorOpen && (
              <PromotionEditor
                drafts={drafts}
                onChangeDrafts={setDrafts}
                activeDraftId={activeDraftId}
                onSetActiveDraftId={setActiveDraftId}
                indexEntries={indexEntries}
                globalOrder={globalOrder}
                onComplete={handleComplete}
                completing={completing}
                completeError={completeError}
              />
            )}
          </div>

          {/* ③ — shares view-transition-name with /scratch's timeline container (§5).
              The column itself doesn't scroll; only the note list inside
              QuickNoteInlineTimeline does, anchored to the bottom by default. */}
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={{ viewTransitionName: "note-timeline" } as CSSProperties}
          >
            <QuickNoteInlineTimeline
              notes={activeQuickNotes}
              onNotesChange={setActiveQuickNotes}
              selectedIds={selectedQuickNoteIds}
              onToggleSelect={toggleQuickNoteSelection}
              focusRequest={focusQuickNoteRequest}
              onDeleted={(id) =>
                setSelectedQuickNoteIds((prev) => {
                  if (!prev.has(id)) return prev;
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                })
              }
              header={
                <>
                  <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
                    <span className="text-accent">③</span> {t.zettelkasten.scratchColumnHeading}
                    {selectedQuickNoteIds.size > 0 && (
                      <span className="ml-auto font-mono text-[10px] text-accent normal-case">
                        {t.zettelkasten.selectedCount(selectedQuickNoteIds.size)}
                      </span>
                    )}
                  </div>
                  {selectedQuickNoteIds.size > 0 && drafts.length === 0 && (
                    <button
                      onClick={buildDraftFromSelection}
                      className="btn-sheen w-full rounded-lg bg-accent px-3 py-2.5 text-xs font-bold text-on-accent"
                    >
                      {t.zettelkasten.createFromSelection(selectedQuickNoteIds.size)}
                    </button>
                  )}
                </>
              }
            />
          </div>
        </div>
        )}
      </div>

      {openNoteId && (
        <NoteDetailOverlay
          noteId={openNoteId}
          onClose={() => setOpenNoteId(null)}
          onIndexEntryAdded={(entry) => setIndexEntries((prev) => [...prev, entry].sort((a, b) => a.keyword.localeCompare(b.keyword)))}
          onNoteChanged={refreshGlobalOrder}
          onNoteDeleted={async () => {
            setOpenNoteId(null);
            // A deleted note can take index entries with it (they cascade),
            // so the index panel has to be re-read, not just the pile.
            const [order, entries] = await Promise.all([getGlobalOrderAction(), listIndexEntriesAction()]);
            setGlobalOrder(order);
            setIndexEntries(entries);
            setDrillPath([]);
          }}
        />
      )}
    </div>
  );
}

function IndexPanel({
  entries,
  onSelect,
  onRemove,
}: {
  entries: IndexEntrySummary[];
  onSelect: (noteId: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute top-11 right-3 z-20 w-[250px] rounded-lg border border-line-strong bg-surface-alt shadow-[0_20px_40px_-18px_rgba(0,0,0,0.8)]">
      <div className="border-b border-line px-3 py-2.5 font-mono text-[10px] tracking-wider text-ink-faint">
        {t.zettelkasten.indexHeading(entries.length)}
      </div>
      <div className="max-h-72 overflow-auto">
        {entries.length === 0 && <p className="p-3 text-xs text-ink-soft">{t.zettelkasten.indexEmpty}</p>}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-[11.5px]"
          >
            <button onClick={() => onSelect(entry.noteId)} className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent">
              {entry.keyword}
            </button>
            <button onClick={() => onRemove(entry.id)} className="shrink-0 text-[10px] text-ink-faint hover:text-accent">
              {t.common.delete}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteDetailOverlay({
  noteId,
  onClose,
  onIndexEntryAdded,
  onNoteChanged,
  onNoteDeleted,
}: {
  noteId: string;
  onClose: () => void;
  onIndexEntryAdded: (entry: IndexEntrySummary) => void;
  /** A retitled note has to be relabeled in the pile behind this overlay. */
  onNoteChanged: () => void;
  onNoteDeleted: () => void;
}) {
  const { t } = useI18n();
  const { guard } = useUnsavedChanges();
  const [detail, setDetail] = useState<PermanentNoteDetail | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Editing covers the title and the body together — they're one note, and
  // one Save. The body uses MarkdownNoteEditor in live-sync mode (onChange)
  // rather than its own save button for exactly that reason; see
  // PromotionEditor, which drives its draft the same way.
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<DeletionImpact | null>(null);

  const dirty = !!detail && editing && (draftTitle !== detail.title || draftContent !== detail.content);
  const requestClose = () => guard(onClose);
  const backdrop = useBackdropDismiss(requestClose);

  function startEditing(note: PermanentNoteDetail) {
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const res = await updatePermanentNoteAction(noteId, draftTitle, draftContent);
    setSaving(false);
    if ("error" in res) {
      setError(res.error);
      throw new Error(res.error); // keeps the unsaved-changes guard from leaving
    }
    setDetail(res.note);
    setEditing(false);
    onNoteChanged();
  }

  useRegisterUnsavedEditor({
    isDirty: () => dirty,
    save,
    discard: () => setEditing(false),
  });

  async function openDeleteConfirm() {
    setDeleteImpact(await getPermanentNoteDeletionImpactAction(noteId));
  }

  async function confirmDelete() {
    await deletePermanentNoteAction(noteId);
    setDeleteImpact(null);
    onNoteDeleted();
  }

  useEffect(() => {
    let cancelled = false;
    getPermanentNoteDetailAction(noteId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  async function addToIndex() {
    setError(null);
    const res = await createIndexEntryAction(keyword, noteId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onIndexEntryAdded({ id: res.entry.id, keyword: res.entry.keyword, noteId: res.entry.noteId, noteTitle: res.entry.noteTitle });
    setConfirmOpen(false);
    setKeyword("");
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-6" {...backdrop}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-auto rounded-xl border border-line bg-surface p-6 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]"
      >
        {!detail ? (
          <LoadingBlock label={t.zettelkasten.detailLoading} size="md" />
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              {editing ? (
                <div className="flex-1">
                  <label className="mb-1 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
                    {t.zettelkasten.noteTitleLabel}
                  </label>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    autoFocus
                    className="w-full bg-transparent text-xl font-extrabold text-ink focus:outline-none"
                  />
                </div>
              ) : (
                <h2 className="text-xl font-extrabold text-ink">{detail.title}</h2>
              )}
              <div className="flex shrink-0 gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={() => void save().catch(() => {})}
                      disabled={saving || !draftTitle.trim() || !draftContent.trim()}
                      className="btn-sheen rounded bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-on-accent disabled:opacity-40"
                    >
                      {saving ? t.common.saving : t.common.save}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="font-mono text-[10px] text-ink-soft hover:text-accent"
                    >
                      {t.common.cancel}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEditing(detail)}
                      className="font-mono text-[10px] text-ink-soft hover:text-accent"
                    >
                      {t.common.edit}
                    </button>
                    <button onClick={() => setConfirmOpen(true)} className="font-mono text-[10px] text-ink-soft hover:text-accent">
                      {t.zettelkasten.addToIndex}
                    </button>
                    <button onClick={() => void openDeleteConfirm()} className="font-mono text-[10px] text-ink-soft hover:text-accent">
                      {t.common.delete}
                    </button>
                    <button onClick={requestClose} className="font-mono text-[10px] text-ink-soft hover:text-accent">
                      {t.zettelkasten.detailClose}
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing ? (
              <MarkdownNoteEditor key={detail.id} content={detail.content} onChange={setDraftContent} />
            ) : (
              <EmbeddedContentPreview content={detail.content} />
            )}
            {error && <p className="mt-1.5 text-[10.5px] text-accent">{error}</p>}

            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2 font-mono text-[9.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
                <span className="text-accent">{"//"}</span> {t.zettelkasten.literatureHeading}
              </h3>
              <PermanentNoteLiteratureSection key={detail.id} noteId={detail.id} literatureMemos={detail.literatureMemos} />
            </div>

            {(detail.outboundLinks.length > 0 || detail.inboundLinks.length > 0) && (
              <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
                {detail.outboundLinks.map((l) => (
                  <div key={l.id} className="font-mono text-[10.5px] text-ink-soft">
                    <b className="text-accent">{l.relationLabel}</b> ／ {l.targetLabel}
                  </div>
                ))}
                {detail.inboundLinks.map((l) => (
                  <div key={l.id} className="font-mono text-[10.5px] text-ink-faint">
                    ← <b className="text-ink-soft">{l.relationLabel}</b> ／ {l.targetLabel}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title={t.zettelkasten.addToIndexTitle}
          warning={t.zettelkasten.addToIndexWarning}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={addToIndex}
          confirmDisabled={!keyword.trim()}
        >
          <div>
            <label className="mb-1 block font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.zettelkasten.keywordLabel}</label>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
            />
            {error && <p className="mt-1.5 text-[10.5px] text-accent">{error}</p>}
          </div>
        </ConfirmDialog>

        <ConfirmDialog
          open={deleteImpact !== null}
          title={t.zettelkasten.noteDeleteTitle}
          warning={[
            t.zettelkasten.noteDeleteWarning,
            deleteImpact && deleteImpact.inboundLinkCount > 0
              ? t.zettelkasten.noteDeleteInboundLinks(deleteImpact.inboundLinkCount)
              : null,
            deleteImpact && deleteImpact.indexKeywords.length > 0
              ? t.zettelkasten.noteDeleteIndexKeywords(deleteImpact.indexKeywords.join("、"))
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
          confirmLabel={t.common.delete}
          onCancel={() => setDeleteImpact(null)}
          onConfirm={confirmDelete}
        />
      </div>
    </div>
  );
}
