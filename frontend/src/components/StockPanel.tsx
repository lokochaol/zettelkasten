"use client";

import { useState, useTransition } from "react";
import { addInventoryItemAction, removeInventoryItemAction, updateInventoryItemAction } from "@/app/meals/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useEnterKey } from "@/lib/ime";
import type { InventoryItem, StorageLocation } from "@/generated/prisma/client";

const LOCATIONS: StorageLocation[] = ["FRIDGE", "FREEZER", "PANTRY"];

/**
 * The inventory, always on screen: it's what the next plan uses first, what
 * the to-buy list subtracts, and what gets checked in the aisle ("do I
 * still have some?"). Ticking a line on the to-buy list adds to it.
 */
export function StockPanel({ inventory, onChange }: { inventory: InventoryItem[]; onChange: (items: InventoryItem[]) => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <StockList inventory={inventory} onChange={onChange} />
    </section>
  );
}

/**
 * What's in the fridge, freezer and cupboard: amounts edited in place,
 * moved between places with one tap, removed when it's gone.
 */
function StockList({ inventory, onChange }: { inventory: InventoryItem[]; onChange: (items: InventoryItem[]) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState<StorageLocation>("FRIDGE");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(result: { items: InventoryItem[] } | { error: string }) {
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setError(null);
    onChange(result.items);
    return true;
  }

  function add() {
    if (!name.trim()) return;
    startTransition(async () => {
      if (apply(await addInventoryItemAction({ name, quantity, location }))) {
        setName("");
        setQuantity("");
      }
    });
  }
  const enterKey = useEnterKey(add);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.stockHeading}</p>
      {inventory.length === 0 && <p className="text-[11px] leading-relaxed text-ink-faint">{t.meals.stockEmpty}</p>}

      {LOCATIONS.map((loc) => {
        const items = inventory.filter((i) => i.location === loc);
        if (items.length === 0) return null;
        return (
          <div key={loc} className="flex flex-col gap-0.5">
            <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{t.meals.location[loc]}</p>
            {items.map((item) => (
              <div key={item.id} className="flex min-h-9 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{item.name}</span>
                <input
                  defaultValue={item.quantity}
                  // Keyed by the value so a change made elsewhere (the chat)
                  // replaces what's shown rather than being masked by it.
                  key={`${item.id}:${item.quantity}`}
                  onBlur={(e) => {
                    if (e.target.value === item.quantity) return;
                    startTransition(async () => {
                      apply(await updateInventoryItemAction(item.id, { quantity: e.target.value }));
                    });
                  }}
                  placeholder={t.meals.stockQuantityPlaceholder}
                  className="w-24 shrink-0 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[10.5px] text-ink-soft focus:border-accent focus:outline-none"
                />
                <select
                  value={item.location}
                  onChange={(e) =>
                    startTransition(async () => {
                      apply(await updateInventoryItemAction(item.id, { location: e.target.value as StorageLocation }));
                    })
                  }
                  aria-label={t.meals.stockHeading}
                  className="shrink-0 rounded border border-line bg-surface px-1 py-1 text-[10.5px] text-ink-soft focus:outline-none"
                >
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {t.meals.location[l]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => startTransition(async () => void apply(await removeInventoryItemAction(item.id)))}
                  className="shrink-0 px-1.5 py-1 font-mono text-[10px] text-ink-faint hover:text-accent"
                >
                  {t.common.delete}
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...enterKey}
          placeholder={t.meals.stockNamePlaceholder}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          {...enterKey}
          placeholder={t.meals.stockQuantityPlaceholder}
          className="w-24 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value as StorageLocation)}
          className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink focus:outline-none"
        >
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {t.meals.location[l]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={pending || !name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
        >
          {t.meals.stockAdd}
        </button>
      </div>
      {error && <p className="text-[10.5px] text-accent">{error}</p>}
    </div>
  );
}
