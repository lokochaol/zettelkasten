"use client";

import { useState, useTransition } from "react";
import {
  clearPurchaseListAction,
  createPurchaseListAction,
  restoreExcludedPurchaseAction,
  toggleShoppingItemAction,
  type PurchaseListView,
} from "@/app/meals/actions";
import { formatDateKey } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { InventoryItem, ShoppingItem } from "@/generated/prisma/client";

const DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7];

/**
 * The to-buy list — the last step of the week's flow, not part of the plan.
 *
 * Settle the meals (generate, adjust by chat), then press the button: it
 * works out what the meals from the chosen day need for that many days,
 * less what's in the inventory. Until then there's only the button, so the
 * screen doesn't show a list for meals that are still moving. Once made, the
 * list stays until shopping is done; if the meals in its days change, it
 * says so and offers to remake itself.
 *
 * Ticking a line puts it in the inventory (see inventory.setShoppingItemBought).
 */
export function PurchaseListPanel({
  list,
  todayKey,
  onListChange,
  onInventoryChange,
}: {
  list: PurchaseListView | null;
  todayKey: string;
  onListChange: (list: PurchaseListView | null) => void;
  onInventoryChange: (items: InventoryItem[]) => void;
}) {
  const { t, locale } = useI18n();
  const [fromDateKey, setFromDateKey] = useState(todayKey);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreating] = useTransition();
  // Ticks shown at once, before the round trip, and kept across re-renders.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const isChecked = (item: ShoppingItem) => checked[item.id] ?? item.checked;
  const day = (key: string) => formatDateKey(key, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" });

  function create() {
    setError(null);
    startCreating(async () => {
      const res = await createPurchaseListAction(fromDateKey, days);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setChecked({});
      onListChange(res.list);
      onInventoryChange(res.inventory);
    });
  }

  function toggle(item: ShoppingItem, next: boolean) {
    setChecked((prev) => ({ ...prev, [item.id]: next }));
    void toggleShoppingItemAction(item.id, next).then(onInventoryChange);
  }

  function finish() {
    onListChange(null);
    setChecked({});
    void clearPurchaseListAction();
  }

  // The day and length to make it for, shared by "make" and "remake".
  const controls = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{t.meals.purchaseFrom}</span>
        <input
          type="date"
          value={fromDateKey}
          onChange={(e) => e.target.value && setFromDateKey(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
        />
      </label>
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        aria-label={t.meals.purchaseDays(days)}
        className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[11px] text-ink focus:outline-none"
      >
        {DAY_CHOICES.map((n) => (
          <option key={n} value={n}>
            {t.meals.purchaseDays(n)}
          </option>
        ))}
      </select>
    </div>
  );

  if (!list) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.shoppingHeading}</p>
        <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.meals.purchaseIntro}</p>
        {controls}
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="btn-sheen w-full rounded-lg bg-accent px-4 py-3 font-mono text-[12px] font-semibold text-on-accent disabled:opacity-60"
        >
          {creating ? t.meals.purchaseCreating : t.meals.purchaseCreate}
        </button>
        {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}
      </section>
    );
  }

  const done = list.items.filter(isChecked).length;
  const categories = [...new Set(list.items.map((i) => i.category))];
  const past = list.toDateKey < todayKey;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.shoppingHeading}</p>
        <span className="font-mono text-[10.5px] text-ink">{t.meals.purchaseRange(day(list.fromDateKey), day(list.toDateKey))}</span>
        <span className="ml-auto font-mono text-[11px] font-semibold text-ink">{t.meals.purchaseTotal(list.estimatedYen)}</span>
      </div>

      {/* How far along the trip is — the thing glanced at between aisles. */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-alt">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${list.items.length ? (done / list.items.length) * 100 : 0}%` }} />
        </div>
        <span className="shrink-0 font-mono text-[10px] text-ink-soft">{t.meals.purchaseProgress(done, list.items.length)}</span>
      </div>

      {(list.stale || past) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink">{past ? t.meals.purchasePast : t.meals.purchaseStale}</p>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent disabled:opacity-60"
          >
            {creating ? t.meals.purchaseCreating : t.meals.purchaseRecreate}
          </button>
        </div>
      )}
      {list.note && <p className="text-[11px] leading-relaxed text-ink-soft">{list.note}</p>}
      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.meals.stockBoughtNote}</p>

      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-0.5">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{category}</p>
          {list.items
            .filter((i) => i.category === category)
            .map((item) => (
              // Big rows: this is tapped one-handed in a supermarket aisle.
              <label key={item.id} className="flex min-h-10 items-center gap-3 rounded-md px-1 active:bg-surface-alt">
                <input
                  type="checkbox"
                  checked={isChecked(item)}
                  onChange={(e) => toggle(item, e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                />
                <span className={`min-w-0 flex-1 text-[12.5px] ${isChecked(item) ? "text-ink-faint line-through" : "text-ink"}`}>{item.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">{item.quantity}</span>
                <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-soft">¥{item.estimatedYen.toLocaleString()}</span>
              </label>
            ))}
        </div>
      ))}

      {/* What the inventory already covers, set aside rather than dropped:
          enough at home is the usual case, but "4 eggs, need 10" is the
          owner's call, so each line can go back on the list. */}
      {list.excluded.length > 0 && (
        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] text-ink-soft">{t.meals.purchaseExcludedHeading(list.excluded.length)}</summary>
          <div className="mt-2 flex flex-col gap-1">
            {list.excluded.map((line) => (
              <div key={line.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12px] text-ink-soft">{line.name}</span>
                <span className="font-mono text-[10px] text-ink-faint">{line.quantity}</span>
                <span className="font-mono text-[10px] text-ink-faint">{t.meals.purchaseExcludedStock(line.stock)}</span>
                <button
                  type="button"
                  onClick={() => void restoreExcludedPurchaseAction(line.name).then((next) => next && onListChange(next))}
                  className="ml-auto rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent"
                >
                  {t.meals.purchaseExcludedRestore}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        {controls}
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="rounded-md border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {creating ? t.meals.purchaseCreating : t.meals.purchaseRecreate}
        </button>
        <button
          type="button"
          onClick={finish}
          className="ml-auto rounded-md bg-ink px-3 py-1.5 font-mono text-[10.5px] font-semibold text-bg disabled:opacity-60"
        >
          {t.meals.purchaseFinish}
        </button>
      </div>
      {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}
    </section>
  );
}
