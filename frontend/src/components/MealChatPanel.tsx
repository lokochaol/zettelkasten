"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ChatThinking } from "@/components/ChatThinking";
import { postChatStream } from "@/lib/chatStreamClient";
import type { ChatProgress } from "@/lib/chatProgress";
import {
  applyMealChatProposalAction,
  dismissMealChatProposalAction,
  getMealChatAction,
  type MealChatMessageView,
  type MealWeekView,
} from "@/app/meals/actions";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { readDraft, removeDraft, writeDraft } from "@/lib/draftBackup";
import type { Proposal } from "@/lib/mealChat";
import type { InventoryItem, MealSlot } from "@/generated/prisma/client";

/** Lets the grid start a message: tapping a day or a meal puts its date
 * into the box, ready to finish. */
export interface MealChatHandle {
  insert: (text: string) => void;
}

/**
 * Where the week's meals are made and changed — "plan this week, I cook on
 * Monday and Thursday", "fish on the 14th instead", "they were out of
 * chicken, so I bought pork" — each answered with a proposal that changes
 * nothing until it's applied. See src/lib/mealChat.ts.
 *
 * Applying hands the whole updated week, inventory and conversation back to
 * the screen, so the plan above, the fridge list and the calendar all move
 * together. What's being typed is kept on the device (src/lib/draftBackup.ts)
 * — this is written standing in a shop, and a page that reloads mid-sentence
 * shouldn't take the sentence with it.
 */
export function MealChatPanel({
  ref,
  weekStartDateKey,
  hasMeals,
  todayKey,
  onApplied,
}: {
  ref?: Ref<MealChatHandle>;
  weekStartDateKey: string;
  /** False for a week with nothing planned yet: the suggestions offer to
   * plan it rather than to change it. */
  hasMeals: boolean;
  todayKey: string;
  onApplied: (week: MealWeekView, inventory: InventoryItem[]) => void;
}) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<MealChatMessageView[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The message on its way, shown at once with the live progress under it.
  const [pending, setPending] = useState<{ text: string; startedAt: number; progress: ChatProgress | null } | null>(null);
  const sending = pending !== null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    insert(fragment: string) {
      setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${fragment}` : fragment));
      // After the text lands: focus with the caret at the end, and bring the
      // box into view — the grid that called this may be a screen above.
      requestAnimationFrame(() => {
        const box = inputRef.current;
        if (!box) return;
        box.scrollIntoView({ block: "center", behavior: "smooth" });
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    },
  }));
  const draftKey = `meal-chat:${weekStartDateKey}`;

  useEffect(() => {
    let cancelled = false;
    getMealChatAction(weekStartDateKey).then((m) => {
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
    void postChatStream<MealChatMessageView>(
      "/api/meals/chat",
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
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    let res: Awaited<ReturnType<typeof applyMealChatProposalAction>>;
    try {
      res = await applyMealChatProposalAction(id, weekStartDateKey, todayKey, timeZone);
    } catch {
      // The call itself failed (an expired login, a deploy, a server
      // error) — say so rather than leaving the button spinning.
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
    onApplied(res.week, res.inventory);
    setNotice(res.calendarError ? `${t.meals.chatAppliedNote} ${res.calendarError}` : t.meals.chatAppliedNote);
  }

  async function dismiss(id: string) {
    setBusyId(id);
    let res: Awaited<ReturnType<typeof dismissMealChatProposalAction>>;
    try {
      res = await dismissMealChatProposalAction(id, weekStartDateKey);
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
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.chatHeading}</p>
        <p className="text-[11px] leading-relaxed text-ink-soft">{t.meals.chatIntro}</p>
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
              stageLabel={t.meals.chatStage}
              itemsHeading={t.meals.chatItemsHeading}
              elapsedLabel={t.meals.chatElapsed}
              itemLabel={(item) => `${formatDateKey(item.dateKey, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" })} ${item.slot && item.slot in SLOT_SHORT ? t.meals[SLOT_SHORT[item.slot as MealSlot]] : ""} ${item.title}`}
            />
          </>
        )}
        <div ref={endRef} />
      </div>

      {notice && <p className="font-mono text-[10.5px] text-accent">{notice}</p>}
      {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}

      {/* Starting points, for typing on a phone: tap one, then fill in the 〇〇. */}
      <div className="flex flex-wrap gap-1.5">
        {(hasMeals ? t.meals.chatSuggestions : t.meals.chatStartSuggestions).map((s) => (
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
            // Enter is a newline — on a Japanese keyboard it also confirms
            // conversion, so sending on it would send half a sentence.
            // Cmd/Ctrl+Enter sends on a computer; the button everywhere.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={t.meals.chatPlaceholder}
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

const SLOT_SHORT: Record<MealSlot, "slotBreakfast" | "slotLunch" | "slotDinner"> = {
  BREAKFAST: "slotBreakfast",
  LUNCH: "slotLunch",
  DINNER: "slotDinner",
};

/** What a proposal would change, before and after, with the buttons to
 * apply or turn it down. */
function ProposalCard({
  proposal,
  locale,
  state,
  onApply,
  onDismiss,
}: {
  proposal: Proposal;
  locale: string;
  state: "open" | "busy" | "applied" | "dismissed";
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border p-3 ${state === "open" || state === "busy" ? "border-accent/50" : "border-line opacity-70"}`}>
      {proposal.meals.length > 0 && (
        // By day, with the day's totals: a whole week arrives in one card,
        // and "does each day add up" is the question to answer before
        // applying it. Each meal opens to its recipe.
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">
            {t.meals.chatMealsLabel} · {t.meals.chatMealCount(proposal.meals.length)}
          </p>
          {[...new Set(proposal.meals.map((m) => m.dateKey))].map((dateKey) => {
            const dayMeals = proposal.meals.filter((m) => m.dateKey === dateKey);
            const kcal = dayMeals.reduce((sum, m) => sum + m.kcal, 0);
            const protein = dayMeals.reduce((sum, m) => sum + m.proteinG, 0);
            return (
              <div key={dateKey} className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-2 font-mono text-[9.5px] text-ink-soft">
                  <span className="font-semibold">
                    {formatDateKey(dateKey, localeTag(locale as "ja" | "en"), { month: "numeric", day: "numeric", weekday: "short" })}
                  </span>
                  {dayMeals.length === 3 && (
                    <span className="text-ink-faint">
                      {kcal} kcal · P {Math.round(protein)}g
                    </span>
                  )}
                </span>
                {dayMeals.map((m) => (
                  <details key={m.slot} className="group text-[11.5px]">
                    <summary className="flex cursor-pointer list-none items-baseline gap-2">
                      <span className="w-6 shrink-0 font-mono text-[9.5px] text-accent">{t.meals[SLOT_SHORT[m.slot]]}</span>
                      <span className="min-w-0 flex-1 text-ink">
                        {m.replaces && <span className="text-ink-faint line-through">{m.replaces}</span>}
                        {m.replaces && " → "}
                        <span className="font-semibold">{m.title}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                        {m.kcal} kcal · {t.meals.prepMinutes(m.prepMinutes)}
                      </span>
                    </summary>
                    <p className="mt-0.5 ml-8 text-[10.5px] leading-relaxed text-ink-soft">{m.recipe}</p>
                  </details>
                ))}
              </div>
            );
          })}
        </div>
      )}

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
