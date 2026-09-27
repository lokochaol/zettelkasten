"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getCoopOrderAction,
  proposeCoopOrderAction,
  toggleCoopItemAction,
  type CoopWeekView,
} from "@/app/meals/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The Coop Deli order for a week, as a proposal to type in.
 *
 * The honest shape of this feature: there is no external ordering API for
 * eフレンズ, so the app stops at a list and a copy button. What it does
 * take off the owner is the part that's actually hard — remembering, a
 * fortnight ahead of the week it feeds, what to order and by when.
 */
export function CoopOrderPanel({ weekStartDateKey, todayKey }: { weekStartDateKey: string; todayKey: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<CoopWeekView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // The error and the "copied" flash belong to the week that produced
    // them, so they're cleared as the new week's data lands.
    getCoopOrderAction(weekStartDateKey, todayKey).then((next) => {
      setData(next);
      setError(null);
      setCopied(false);
    });
  }, [weekStartDateKey, todayKey]);

  if (!data) return null;

  const order = data.order;
  // Ordering can't reach a week that's already been shopped for, or whose
  // deadline has gone. Saying which week it *can* reach is more use than
  // simply hiding the panel.
  const tooSoon = weekStartDateKey < data.targetWeekStartDateKey;

  function propose() {
    setError(null);
    startTransition(async () => {
      const res = await proposeCoopOrderAction(weekStartDateKey, todayKey);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setData((prev) => (prev ? { ...prev, order: res.order, text: res.text } : prev));
    });
  }

  function toggle(itemId: string, chosen: boolean) {
    startTransition(async () => setData(await toggleCoopItemAction(itemId, chosen, weekStartDateKey, todayKey)));
  }

  async function copy() {
    if (!data?.text) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the text is on screen either way.
      setCopied(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.coopHeading}</p>
        {order && (
          <span className="font-mono text-[10px] text-ink-faint">
            {t.meals.coopDeadline(order.order.orderByDateKey, order.order.deliveryDateKey)}
          </span>
        )}
        {order && (
          <span className={`font-mono text-[10px] ${order.daysUntilDeadline < 0 ? "text-accent" : "text-ink-soft"}`}>
            {order.daysUntilDeadline < 0 ? t.meals.coopClosed : t.meals.coopDaysLeft(order.daysUntilDeadline)}
          </span>
        )}
        <button
          onClick={propose}
          disabled={pending}
          className="ml-auto rounded-full border border-line-strong px-3.5 py-1.5 font-mono text-[11px] font-semibold text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {pending ? t.meals.coopProposing : order ? t.meals.coopRepropose : t.meals.coopPropose}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-soft">{t.meals.coopIntro}</p>
      {tooSoon && <p className="font-mono text-[10.5px] text-accent">{t.meals.coopTooSoon(data.targetWeekStartDateKey)}</p>}
      {error && <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs whitespace-pre-line text-accent">{error}</p>}

      {!order ? (
        <p className="font-mono text-[10.5px] text-ink-faint">{t.meals.coopNone}</p>
      ) : (
        <>
          {!order.order.refined && <p className="font-mono text-[10px] text-ink-faint">{t.meals.coopUnrefined}</p>}
          <ul className="flex flex-col gap-1">
            {order.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.chosen}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span className="font-mono text-[9px] tracking-wider text-accent uppercase">{item.category}</span>
                <span className={`text-[11.5px] ${item.chosen ? "text-ink" : "text-ink-faint line-through"}`}>{item.name}</span>
                <span className="font-mono text-[9.5px] text-ink-faint">{item.quantity}</span>
                {item.localInstead && (
                  <span className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[9px] text-ink-soft">
                    {t.meals.coopLocalInstead}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </span>
                )}
                {!item.localInstead && (
                  <span className="ml-auto font-mono text-[10px] text-ink-soft">¥{item.estimatedYen.toLocaleString()}</span>
                )}
              </li>
            ))}
          </ul>

          {order.order.note && <p className="text-[11px] leading-relaxed text-ink-soft">{order.order.note}</p>}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
            <span className="font-mono text-[11px] font-semibold text-ink">{t.meals.coopTotal(order.estimatedYen)}</span>
            <button
              onClick={copy}
              className="ml-auto rounded-md border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {copied ? t.meals.coopCopied : t.meals.coopCopy}
            </button>
          </div>
        </>
      )}

      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.meals.coopNoApiNote}</p>
    </section>
  );
}
