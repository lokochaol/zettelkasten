"use client";

import { useState, type FormEvent } from "react";
import {
  createTopicAction,
  deleteTopicAction,
  dismissFindingAction,
  findingToLiteratureAction,
  runTopicAction,
  updateTopicAction,
  type DiscoveryTopicView,
} from "@/app/discovery/actions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { announceDiscoverySeen } from "@/lib/discoverySeenEvent";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";

const PILL =
  "rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * Topics written straight on /discovery — "what to keep an eye on" that
 * isn't a 走り書き and so isn't swept away after a week. Each keeps what
 * its runs found, newest first; new ones are marked until they've been
 * seen here once.
 */
export function DiscoveryTopicsSection({
  topics,
  onTopicsChange,
}: {
  topics: DiscoveryTopicView[];
  onTopicsChange: (topics: DiscoveryTopicView[]) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which findings were new when the page opened: they keep the mark for
  // this visit even though the page records them as seen right away (see
  // ZettelkastenDiscoveryPane).
  const [newIds] = useState(() => new Set(topics.flatMap((tp) => tp.findings.filter((f) => f.isNew).map((f) => f.id))));

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await createTopicAction(draft);
      if ("error" in res) setError(res.error);
      else {
        setDraft("");
        onTopicsChange(res.topics);
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.discoveryTab.topicsHeading(topics.length)}</p>
      <p className="text-[11px] leading-relaxed text-ink-soft">{t.discoveryTab.topicsIntro}</p>
      <form onSubmit={add} className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={t.discoveryTab.topicPlaceholder}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || adding}
          className="flex w-fit items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent disabled:opacity-40"
        >
          {adding && <Spinner size="xs" />}
          {t.discoveryTab.topicAdd}
        </button>
      </form>
      {error && <p className="text-[11px] text-accent">{error}</p>}

      {topics.map((topic) => (
        <TopicCard
          key={topic.id}
          topic={topic}
          newIds={newIds}
          onChange={(next) => onTopicsChange(topics.map((x) => (x.id === next.id ? next : x)))}
          onReplaceAll={onTopicsChange}
          onDelete={() => onTopicsChange(topics.filter((x) => x.id !== topic.id))}
        />
      ))}
    </section>
  );
}

function TopicCard({
  topic,
  newIds,
  onChange,
  onReplaceAll,
  onDelete,
}: {
  topic: DiscoveryTopicView;
  newIds: Set<string>;
  onChange: (topic: DiscoveryTopicView) => void;
  onReplaceAll: (topics: DiscoveryTopicView[]) => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(topic.content);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const lastRun = topic.lastRunAt ? new Date(topic.lastRunAt).toLocaleString(localeTag(locale), { dateStyle: "short", timeStyle: "short" }) : null;

  async function save() {
    const res = await updateTopicAction(topic.id, { content });
    if ("error" in res) setMessage(res.error);
    else {
      onChange({ ...topic, content: content.trim() });
      setEditing(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setMessage(null);
    const before = new Set(topic.findings.map((f) => f.id));
    try {
      const res = await runTopicAction(topic.id);
      if ("error" in res) setMessage(res.error);
      else {
        setMessage(t.discoveryTab.topicRunResult(res.found));
        const mine = res.topics.find((x) => x.id === topic.id);
        if (mine) {
          const added = mine.findings.filter((f) => !before.has(f.id)).map((f) => f.id);
          setFreshIds(new Set(added));
          announceDiscoverySeen();
        }
        onReplaceAll(res.topics);
      }
    } catch {
      setMessage(t.discovery.triggerFailed);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2 rounded-lg border px-3 py-3 ${topic.enabled ? "border-line-strong" : "border-line opacity-70"}`}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={!content.trim()} className={PILL}>
              {t.common.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setContent(topic.content);
                setEditing(false);
              }}
              className={PILL}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">{topic.content}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-ink-soft">
          <input
            type="checkbox"
            checked={topic.enabled}
            onChange={(e) => {
              onChange({ ...topic, enabled: e.target.checked });
              void updateTopicAction(topic.id, { enabled: e.target.checked });
            }}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          {t.discoveryTab.topicEnabled}
        </label>
        <span className="font-mono text-[9px] text-ink-faint">{lastRun ? t.discoveryTab.lastRun(lastRun) : t.discoveryTab.neverRun}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => void runNow()} disabled={running} className={`${PILL} flex items-center gap-1`}>
            {running && <Spinner size="xs" />}
            {running ? t.discovery.triggerRunning : t.discoveryTab.topicRun}
          </button>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className={PILL}>
              {t.common.edit}
            </button>
          )}
          <button type="button" onClick={() => setConfirmDelete(true)} className={PILL}>
            {t.common.delete}
          </button>
        </div>
      </div>
      {message && <p className="font-mono text-[10px] text-accent">{message}</p>}

      {topic.findings.length === 0 ? (
        <p className="font-mono text-[10px] text-ink-faint">{t.discoveryTab.topicNoFindings}</p>
      ) : (
        <ul className="flex flex-col gap-2 border-t border-line pt-2">
          {topic.findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              isNew={f.isNew || newIds.has(f.id) || freshIds.has(f.id)}
              onLiterature={(literatureMemoId) =>
                onChange({ ...topic, findings: topic.findings.map((x) => (x.id === f.id ? { ...x, literatureMemoId } : x)) })
              }
              onDismiss={() => {
                onChange({ ...topic, findings: topic.findings.filter((x) => x.id !== f.id) });
                void dismissFindingAction(f.id);
              }}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t.discoveryTab.topicDeleteConfirm}
        warning={t.discoveryTab.topicDeleteWarning}
        confirmLabel={t.common.delete}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
          void deleteTopicAction(topic.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function FindingRow({
  finding,
  isNew,
  onLiterature,
  onDismiss,
}: {
  finding: DiscoveryTopicView["findings"][number];
  isNew: boolean;
  onLiterature: (literatureMemoId: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  async function toLiterature() {
    setSaving(true);
    try {
      const res = await findingToLiteratureAction(finding.id);
      if (!("error" in res)) onLiterature(res.literatureMemoId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {isNew && <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-on-accent">{t.discoveryTab.findingNew}</span>}
        <span className="font-mono text-[9px] tracking-wider text-accent uppercase">
          {finding.kind === "NEWS" ? t.discoveryTab.findingNews : t.discoveryTab.findingLiterature}
        </span>
        {finding.url ? (
          <a href={finding.url} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-ink underline-offset-2 hover:text-accent hover:underline">
            {finding.title}
          </a>
        ) : (
          <span className="text-[12.5px] font-semibold text-ink">{finding.title}</span>
        )}
      </div>
      {finding.summary && <p className="text-[11.5px] leading-relaxed text-ink-soft">{finding.summary}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9.5px] text-ink-faint">
          {finding.sourceLabel}
          {finding.sourceLabel ? " · " : ""}
          {t.discoveryTab.findingConfidence(finding.confidence)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {finding.literatureMemoId ? (
            <a href={`/literature/${finding.literatureMemoId}`} className={PILL}>
              {t.discoveryTab.findingLiteratureOpen}
            </a>
          ) : (
            <button type="button" onClick={() => void toLiterature()} disabled={saving} className={PILL}>
              {t.discoveryTab.findingToLiterature}
            </button>
          )}
          <button type="button" onClick={onDismiss} aria-label={t.discoveryTab.findingDismiss} className={PILL}>
            ×
          </button>
        </div>
      </div>
    </li>
  );
}
