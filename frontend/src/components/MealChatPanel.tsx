"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  applyMealChatProposalAction,
  dismissMealChatProposalAction,
  getMealChatAction,
  sendMealChatAction,
  type MealChatMessageView,
  type MealWeekView,
} from "@/app/meals/actions";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { readDraft, removeDraft, writeDraft } from "@/lib/draftBackup";
import type { Proposal } from "@/lib/mealChat";
import type { InventoryItem, MealSlot } from "@/generated/prisma/client";

/**
 * Talking the week through with the planner — "they were out of chicken,
 * so I bought pork" — and getting back a proposal for the rest of the week
 * that changes nothing until it's applied. See src/lib/mealChat.ts.
 *
 * Applying hands the whole updated week, inventory and conversation back to
 * the screen, so the plan above, the fridge list and the calendar all move
 * together. What's being typed is kept on the device (src/lib/draftBackup.ts)
 * — this is written standing in a shop, and a page that reloads mid-sentence
 * shouldn't take the sentence with it.
 */
export function MealChatPanel({
  weekStartDateKey,
  todayKey,
  onApplied,
}: {
  weekStartDateKey: string;
  todayKey: string;
  onApplied: (week: MealWeekView, inventory: InventoryItem[]) => void;
}) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<MealChatMessageView[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
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
  }, [messages]);

  function send() {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    setNotice(null);
    startSending(async () => {
      const res = await sendMealChatAction(weekStartDateKey, message, todayKey);
      if ("error" in res) {
        // The text stays in the box to send again.
        setError(res.error);
        return;
      }
      setMessages(res.messages);
      setText("");
    });
  }

  async function apply(id: string) {
    setBusyId(id);
    setError(null);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const res = await applyMealChatProposalAction(id, weekStartDateKey, todayKey, timeZone);
    setBusyId(null);
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
    const res = await dismissMealChatProposalAction(id, weekStartDateKey);
    setBusyId(null);
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
        {messages?.length === 0 && <p className="text-[11px] text-ink-faint">{t.meals.chatEmpty}</p>}
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
        {sending && <p className="self-start font-mono text-[10.5px] text-ink-faint">{t.meals.chatSending}</p>}
        <div ref={endRef} />
      </div>

      {notice && <p className="font-mono text-[10.5px] text-accent">{notice}</p>}
      {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}

      {/* Starting points, for typing on a phone: tap one, then fill in the 〇〇. */}
      <div className="flex flex-wrap gap-1.5">
        {t.meals.chatSuggestions.map((s) => (
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
  const opSign = { add: "+", remove: "−", set: "=" } as const;
  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border p-3 ${state === "open" || state === "busy" ? "border-accent/50" : "border-line opacity-70"}`}>
      {proposal.meals.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{t.meals.chatMealsLabel}</p>
          {proposal.meals.map((m) => (
            <div key={`${m.dateKey}${m.slot}`} className="flex flex-col text-[11.5px]">
              <span className="font-mono text-[9.5px] text-ink-faint">
                {formatDateKey(m.dateKey, localeTag(locale as "ja" | "en"))} {t.meals[SLOT_SHORT[m.slot]]}
              </span>
              <span className="text-ink">
                {m.replaces && <span className="text-ink-faint line-through">{m.replaces}</span>}
                {m.replaces && " → "}
                <span className="font-semibold">{m.title}</span>
              </span>
              <span className="font-mono text-[9.5px] text-ink-faint">
                {m.kcal} kcal · P {Math.round(m.proteinG)}g · {t.meals.prepMinutes(m.prepMinutes)}
              </span>
            </div>
          ))}
        </div>
      )}
      {proposal.inventory.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{t.meals.chatStockLabel}</p>
          {proposal.inventory.map((s, i) => (
            <span key={i} className="text-[11.5px] text-ink">
              <span className="mr-1.5 font-mono text-accent">{opSign[s.op]}</span>
              {s.name}
              {s.quantity && <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{s.quantity}</span>}
              {s.op !== "remove" && <span className="ml-1.5 font-mono text-[9.5px] text-ink-faint">{t.meals.location[s.location]}</span>}
            </span>
          ))}
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
