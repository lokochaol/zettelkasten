"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ChatThinking } from "@/components/ChatThinking";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import {
  applyTrainerChatProposalAction,
  dismissTrainerChatProposalAction,
  getTrainerChatAction,
  type TrainerChatMessageView,
  type TrainingWeekView,
} from "@/app/training/actions";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { readDraft, removeDraft, writeDraft } from "@/lib/draftBackup";
import type { TrainingProposal } from "@/lib/trainingChat";

/** Lets a session card start a message about itself. */
export interface TrainerChatHandle {
  insert: (text: string) => void;
}

/**
 * Talking the week over with the trainer — "my knee hurts today", "only 30
 * minutes on Wednesday" — and getting back changes to the sessions that
 * apply only when asked to. See src/lib/trainingChat.ts.
 *
 * What's being typed is kept on the device (src/lib/draftBackup.ts), the
 * same as the meal chat: it's often typed at the gym, between sets.
 */
export function TrainerChatPanel({
  ref,
  weekStartDateKey,
  hasSessions,
  todayKey,
  onApplied,
}: {
  ref?: Ref<TrainerChatHandle>;
  weekStartDateKey: string;
  hasSessions: boolean;
  todayKey: string;
  onApplied: (week: TrainingWeekView) => void;
}) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<TrainerChatMessageView[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The message on its way, shown at once with the live progress under it.
  const [pending, setPending] = useState<{ text: string; startedAt: number; progress: ChatProgress | null } | null>(null);
  const sending = pending !== null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftKey = `trainer-chat:${weekStartDateKey}`;

  useImperativeHandle(ref, () => ({
    insert(fragment: string) {
      setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${fragment}` : fragment));
      requestAnimationFrame(() => {
        const box = inputRef.current;
        if (!box) return;
        box.scrollIntoView({ block: "center", behavior: "smooth" });
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    },
  }));

  useEffect(() => {
    let cancelled = false;
    getTrainerChatAction(weekStartDateKey).then((m) => {
      if (cancelled) return;
      setMessages(m);
      const draft = readDraft(draftKey);
      if (draft) setText(draft.value);
    });
    return () => {
      cancelled = true;
    };
  }, [weekStartDateKey, draftKey]);

  useEffect(() => {
    if (text.trim()) writeDraft(draftKey, text, "");
    else removeDraft(draftKey);
  }, [text, draftKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending]);

  function send() {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setNotice(null);
    setText("");
    setPending({ text: message, startedAt: Date.now(), progress: null });
    void postChatStream<TrainerChatMessageView>(
      "/api/training/chat",
      { weekStartDateKey, text: message, todayKey },
      (progress) => setPending((prev) => (prev ? { ...prev, progress } : prev)),
      t.meals.chatStreamFailed,
    ).then((res) => {
      setPending(null);
      if ("error" in res) {
        // The text goes back in the box to send again.
        setText((prev) => prev || message);
        setError(res.error);
        return;
      }
      setMessages(res.messages);
    });
  }

  async function apply(id: string) {
    setBusyId(id);
    setError(null);
    let res: Awaited<ReturnType<typeof applyTrainerChatProposalAction>>;
    try {
      res = await applyTrainerChatProposalAction(id, weekStartDateKey, todayKey);
    } catch {
      setError(t.meals.chatApplyFailed);
      return;
    } finally {
      setBusyId(null);
    }
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages(res.messages);
    onApplied(res.week);
    setNotice(t.training.chatAppliedNote);
  }

  async function dismiss(id: string) {
    setBusyId(id);
    let res: Awaited<ReturnType<typeof dismissTrainerChatProposalAction>>;
    try {
      res = await dismissTrainerChatProposalAction(id, weekStartDateKey);
    } catch {
      setError(t.meals.chatApplyFailed);
      return;
    } finally {
      setBusyId(null);
    }
    if ("error" in res) setError(res.error);
    else setMessages(res.messages);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.training.chatHeading}</p>
        <p className="text-[11px] leading-relaxed text-ink-soft">{t.training.chatIntro}</p>
      </div>

      <div className="flex max-h-[28rem] flex-col gap-2.5 overflow-y-auto">
        {messages?.length === 0 && !pending && <p className="text-[11px] text-ink-faint">{t.meals.chatEmpty}</p>}
        {messages?.map((m) =>
          m.role === "USER" ? (
            <p
              key={m.id}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-on-accent"
            >
              {m.content}
            </p>
          ) : (
            <div key={m.id} className="flex max-w-[92%] flex-col gap-2 self-start">
              <p className="rounded-2xl rounded-bl-md bg-surface-alt px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
                {m.content}
              </p>
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  locale={locale}
                  state={m.applied ? "applied" : m.dismissed ? "dismissed" : busyId === m.id ? "busy" : "open"}
                  onApply={() => void apply(m.id)}
                  onDismiss={() => void dismiss(m.id)}
                />
              )}
            </div>
          ),
        )}
        {pending && (
          <>
            <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-on-accent opacity-80">
              {pending.text}
            </p>
            <ChatThinking
              progress={pending.progress}
              startedAt={pending.startedAt}
              stageLabel={t.training.chatStage}
              itemsHeading={t.training.chatItemsHeading}
              elapsedLabel={t.meals.chatElapsed}
              itemLabel={(item) => `${formatDateKey(item.dateKey, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" })} ${item.title}`}
            />
          </>
        )}
        <div ref={endRef} />
      </div>

      {notice && <p className="font-mono text-[10.5px] text-accent">{notice}</p>}
      {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {(hasSessions ? t.training.chatSuggestions : t.training.chatStartSuggestions).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setText((prev) => (prev ? `${prev}\n${s}` : s))}
            className="rounded-full border border-line-strong px-2.5 py-1 text-[10.5px] text-ink-soft hover:border-accent hover:text-accent"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter is a newline (it also confirms IME conversion);
            // Cmd/Ctrl+Enter sends, as in the meal chat.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={t.training.chatPlaceholder}
          className="min-w-0 flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="btn-sheen shrink-0 rounded-lg bg-accent px-4 py-2.5 font-mono text-[11.5px] font-semibold text-on-accent disabled:opacity-40"
        >
          {sending ? t.meals.chatSending : t.meals.chatSend}
        </button>
      </div>
    </section>
  );
}

/** What a proposal would change — sessions by day, days taken off, a new
 * aim — with the buttons to apply it or turn it down. */
function ProposalCard({
  proposal,
  locale,
  state,
  onApply,
  onDismiss,
}: {
  proposal: TrainingProposal;
  locale: string;
  state: "open" | "busy" | "applied" | "dismissed";
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const day = (key: string) => formatDateKey(key, localeTag(locale as "ja" | "en"), { month: "numeric", day: "numeric", weekday: "short" });
  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border p-3 ${state === "open" || state === "busy" ? "border-accent/50" : "border-line opacity-70"}`}>
      {proposal.focus && (
        <p className="text-[11.5px] text-ink">
          <span className="mr-1.5 font-mono text-[9px] tracking-wider text-accent uppercase">{t.training.chatFocusLabel}</span>
          {proposal.focus}
        </p>
      )}
      {proposal.sessions.map((s) => (
        <details key={s.dateKey} className="text-[11.5px]">
          <summary className="flex cursor-pointer list-none flex-col gap-0.5">
            <span className="flex items-baseline gap-2 font-mono text-[9.5px] text-ink-soft">
              <span className="font-semibold">{day(s.dateKey)}</span>
              <span className="text-ink-faint">
                {t.training.kind[s.kind]} · {t.training.minutes(s.minutes)}
              </span>
            </span>
            <span className="text-ink">
              {s.replaces && <span className="text-ink-faint line-through">{s.replaces}</span>}
              {s.replaces && " → "}
              <span className="font-semibold">{s.title}</span>
            </span>
          </summary>
          {s.notes && <p className="mt-1 text-[10.5px] leading-relaxed text-ink-soft">{s.notes}</p>}
          <ul className="mt-1 flex flex-col gap-0.5">
            {s.exercises.map((e, i) => (
              <li key={i} className="text-[10.5px] text-ink-soft">
                {e.name} <span className="font-mono text-ink-faint">{[e.sets ? `${e.sets} × ${e.reps}` : e.reps, e.load].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {proposal.remove.map((r) => (
        <p key={r.dateKey} className="text-[11.5px] text-ink">
          <span className="mr-1.5 font-mono text-[9.5px] font-semibold text-ink-soft">{day(r.dateKey)}</span>
          <span className="text-ink-faint line-through">{r.title}</span> → {t.training.chatRestDay}
        </p>
      ))}

      {state === "applied" ? (
        <p className="font-mono text-[10.5px] text-accent">{t.meals.chatApplied}</p>
      ) : state === "dismissed" ? (
        <p className="font-mono text-[10.5px] text-ink-faint">{t.meals.chatDismissed}</p>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={state === "busy"}
            className="btn-sheen rounded-lg bg-accent px-3.5 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-50"
          >
            {state === "busy" ? t.meals.chatApplying : t.meals.chatApply}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={state === "busy"}
            className="rounded-lg border border-line-strong px-3.5 py-2 font-mono text-[11px] text-ink-soft disabled:opacity-50"
          >
            {t.meals.chatDismiss}
          </button>
        </div>
      )}
    </div>
  );
}
