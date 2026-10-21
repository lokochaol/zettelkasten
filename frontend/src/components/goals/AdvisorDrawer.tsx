"use client";

import { useEffect, useRef, useState } from "react";
import { applyAdvisorProposalAction, clearAdvisorAction, dismissAdvisorProposalAction, getAdvisorMessagesAction } from "@/app/goals/planActions";
import type { AdvisorMessageView } from "@/lib/goalAdvisor";
import type { PlanOverview } from "@/lib/goalPlan";
import { ChatThinking } from "@/components/ChatThinking";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PlanDocumentApply, documentHeadings, documentTitle, downloadMarkdown } from "@/components/goals/PlanDocumentApply";
import { Spinner } from "@/components/LoadingSpinner";
import { PILL, PRIMARY } from "@/components/goals/ui";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The advisor, beside the plan: talk a week, a snag or a new date through,
 * and get back a reply and — when something should change — a proposal of
 * concrete edits (a goal's hours, a phase's dates, the week's blocks, a new
 * deadline, an experiment). Nothing changes until 反映する; what's applied
 * is written to the change log with the reason (goalAdvisor.applyProposal).
 *
 * It's also where a plan is made: the advisor interviews, and when there's
 * enough it writes the whole plan as a document. That document is applied
 * through the import (PlanDocumentApply) — read, previewed, then written as
 * the whole plan or added to it.
 */
export function AdvisorDrawer({
  todayKey,
  goalCount,
  planEmpty,
  startWith,
  onClose,
  onApplied,
}: {
  todayKey: string;
  goalCount: number;
  /** No goals yet: the suggestions are for making a plan. */
  planEmpty: boolean;
  /** A first message to send as it opens, when the conversation is empty. */
  startWith?: string;
  onClose: () => void;
  onApplied: (ov: PlanOverview) => void;
}) {
  const { t } = useI18n();
  const [confirmNew, setConfirmNew] = useState(false);
  const sentStart = useRef(false);
  const [messages, setMessages] = useState<AdvisorMessageView[] | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ progress: ChatProgress | null; startedAt: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAdvisorMessagesAction().then((list) => {
      setMessages(list);
      // Opened to start planning: say so, unless there's a conversation already.
      if (!startWith || sentStart.current) return;
      sentStart.current = true;
      if (list.length === 0) void send(startWith, Date.now());
      else setText(startWith);
    });
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(body: string, startedAt: number) {
    const message = body.trim();
    if (!message || pending) return;
    setError(null);
    setPending({ progress: null, startedAt });
    setMessages((m) => [...(m ?? []), { id: "pending", role: "USER", content: message, proposal: null, applied: false, dismissed: false }]);
    setText("");
    try {
      const res = await postChatStream<AdvisorMessageView>(
        "/api/goals/advisor",
        { text: message, todayKey },
        (progress) => setPending((p) => (p ? { ...p, progress } : p)),
        t.plan.advisorFailed,
      );
      if ("error" in res) {
        setError(res.error);
        setText(message);
        setMessages((m) => (m ?? []).filter((x) => x.id !== "pending"));
      } else setMessages(res.messages);
    } finally {
      setPending(null);
    }
  }

  async function apply(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await applyAdvisorProposalAction(id, todayKey);
      if ("error" in res) setError(res.error);
      else {
        setMessages(res.messages);
        onApplied(res.overview);
      }
    } catch {
      setError(t.plan.advisorApplyFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      const res = await dismissAdvisorProposalAction(id);
      if (!("error" in res)) setMessages(res.messages);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={t.plan.advisorHeading}>
      <button type="button" aria-label={t.plan.close} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <aside className="relative flex h-full w-full max-w-[560px] flex-col border-l border-line bg-bg shadow-2xl">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-mono text-[11px] font-bold text-on-accent">A</span>
          <p className="font-mono text-[11px] font-semibold tracking-[0.2em] text-ink">{t.plan.advisorHeading}</p>
          {messages && messages.length > 0 && (
            <button type="button" onClick={() => setConfirmNew(true)} disabled={pending !== null} className={`${PILL} ml-auto`}>
              + {t.plan.advisorNew}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t.plan.close} className={`${messages && messages.length > 0 ? "" : "ml-auto"} font-mono text-[14px] text-ink-faint hover:text-accent`}>
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">{t.plan.advisorIntro}</p>
          {!messages ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m) =>
                m.role === "USER" ? (
                  <div key={m.id} className="ml-8 self-end rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-on-accent">
                    {m.content}
                  </div>
                ) : (
                  <div key={m.id} className="mr-4 flex flex-col gap-2">
                    <div className="rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink">{m.content}</div>
                    {m.proposal?.document ? (
                      <DocumentProposal
                        message={m}
                        todayKey={todayKey}
                        goalCount={goalCount}
                        busy={busyId === m.id}
                        onApplied={(r) => {
                          if (r.messages) setMessages(r.messages);
                          onApplied(r.overview);
                        }}
                        onDismiss={() => void dismiss(m.id)}
                      />
                    ) : (
                      m.proposal &&
                      m.proposal.ops.length > 0 && <Proposal message={m} busy={busyId === m.id} onApply={() => void apply(m.id)} onDismiss={() => void dismiss(m.id)} />
                    )}
                  </div>
                ),
              )}
              {pending && (
                <ChatThinking
                  progress={pending.progress}
                  startedAt={pending.startedAt}
                  stageLabel={t.plan.advisorStage}
                  itemsHeading={t.plan.advisorItems}
                  elapsedLabel={t.meals.chatElapsed}
                  itemLabel={(item) => item.title}
                />
              )}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-line px-4 py-3">
          {error && <p className="text-[11px] text-accent">{error}</p>}
          {messages && messages.length === 0 && !pending && (
            <div className="flex flex-wrap gap-1.5">
              {(planEmpty ? t.plan.advisorPlanSuggestions : [...t.plan.advisorSuggestions, t.plan.advisorPlanSuggestions[1]]).map((s) => (
                <button key={s} type="button" onClick={() => void send(s, Date.now())} className={PILL}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text, Date.now());
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send(text, Date.now());
                }
              }}
              rows={3}
              placeholder={planEmpty ? t.plan.startPrompt : t.plan.advisorPlaceholder}
              disabled={pending !== null}
              className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            />
            <button type="submit" disabled={!text.trim() || pending !== null} className={`${PRIMARY} py-2`}>
              {pending ? t.plan.advisorSending : t.plan.advisorSend}
            </button>
          </form>
        </footer>
      </aside>
      <ConfirmDialog
        open={confirmNew}
        title={t.plan.advisorNew}
        warning={t.plan.advisorNewConfirm}
        confirmLabel={t.plan.advisorNew}
        onConfirm={async () => {
          setConfirmNew(false);
          const res = await clearAdvisorAction();
          if ("error" in res) setError(res.error);
          else setMessages([]);
        }}
        onCancel={() => setConfirmNew(false)}
      />
    </div>
  );
}

function Proposal({ message, busy, onApply, onDismiss }: { message: AdvisorMessageView; busy: boolean; onApply: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const p = message.proposal!;
  const settled = message.applied || message.dismissed;
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${settled ? "border-line opacity-75" : "border-accent/60 bg-accent/5"}`}>
      <p className="font-mono text-[10px] font-semibold tracking-wider text-accent">{t.plan.advisorChanges(p.ops.length)}</p>
      {p.reason && (
        <p className="text-[11px] leading-relaxed text-ink-soft">
          <span className="font-mono text-[9.5px] text-ink-faint">{t.plan.advisorReason}: </span>
          {p.reason}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {p.ops.map((op, i) => (
          <li key={i} className="rounded-md bg-surface px-2 py-1.5">
            <span className="mr-1.5 rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[9px] text-ink-soft">{t.plan.opType[op.type] ?? op.type}</span>
            {op.before && <span className="text-[11.5px] text-ink-faint line-through">{op.before}</span>}
            {op.before && <span className="mx-1 text-ink-faint">→</span>}
            <span className="text-[11.5px] text-ink">{op.after}</span>
          </li>
        ))}
      </ul>
      {message.applied ? (
        <p className="font-mono text-[10px] text-ink-soft">✓ {t.plan.advisorApplied}</p>
      ) : message.dismissed ? (
        <p className="font-mono text-[10px] text-ink-faint">{t.plan.advisorDismissed}</p>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={onApply} disabled={busy} className={PRIMARY}>
            {busy ? t.plan.advisorApplying : t.plan.advisorApply}
          </button>
          <button type="button" onClick={onDismiss} disabled={busy} className={PILL}>
            {t.plan.advisorDismiss}
          </button>
        </div>
      )}
    </div>
  );
}

/** A plan written out whole: read it, save it, or apply it through the import. */
function DocumentProposal({
  message,
  todayKey,
  goalCount,
  busy,
  onApplied,
  onDismiss,
}: {
  message: AdvisorMessageView;
  todayKey: string;
  goalCount: number;
  busy: boolean;
  onApplied: (r: { overview: PlanOverview; messages: AdvisorMessageView[] | null }) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const doc = message.proposal!.document!;
  const title = documentTitle(doc) || t.plan.documentHeading;
  const headings = documentHeadings(doc);
  const [full, setFull] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const settled = message.applied || message.dismissed;

  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${settled ? "border-line opacity-80" : "border-accent/60 bg-accent/5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold tracking-wider text-accent">{t.plan.advisorDocument}</span>
        <span className="font-mono text-[9.5px] text-ink-faint">{t.plan.advisorDocumentChars(doc.length)}</span>
        <button type="button" onClick={() => downloadMarkdown(doc, title)} className={`${PILL} ml-auto`}>
          {t.plan.download}
        </button>
      </div>
      <p className="text-[13px] font-bold text-ink">{title}</p>
      {headings.length > 0 && (
        <ol className="flex flex-col gap-0.5 border-l-2 border-accent/40 pl-2">
          {headings.map((h, i) => (
            <li key={i} className="text-[11px] text-ink-soft">
              {h}
            </li>
          ))}
        </ol>
      )}
      <button type="button" onClick={() => setFull((v) => !v)} className="w-fit font-mono text-[10px] text-ink-faint hover:text-accent">
        {full ? `▲ ${t.plan.hideFull}` : `▼ ${t.plan.showFull}`}
      </button>
      {full && (
        <pre className="max-h-96 overflow-auto rounded-md border border-line bg-surface p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink">{doc}</pre>
      )}
      {message.applied ? (
        <p className="font-mono text-[10px] text-ink-soft">✓ {done ?? t.plan.advisorApplied}</p>
      ) : message.dismissed ? (
        <p className="font-mono text-[10px] text-ink-faint">{t.plan.advisorDismissed}</p>
      ) : applying ? (
        <PlanDocumentApply
          markdown={doc}
          messageId={message.id}
          todayKey={todayKey}
          goalCount={goalCount}
          defaultMode="replace"
          autoRead
          onApplied={(r) => {
            setDone(r.message);
            setApplying(false);
            onApplied(r);
          }}
          onCancel={() => setApplying(false)}
        />
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setApplying(true)} disabled={busy} className={PRIMARY}>
            {t.plan.advisorDocumentRead}
          </button>
          <button type="button" onClick={onDismiss} disabled={busy} className={PILL}>
            {t.plan.advisorDismiss}
          </button>
        </div>
      )}
    </div>
  );
}
