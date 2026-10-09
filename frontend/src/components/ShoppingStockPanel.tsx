"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  addInventoryItemAction,
  removeInventoryItemAction,
  toggleShoppingItemAction,
  updateInventoryItemAction,
} from "@/app/meals/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { useEnterKey } from "@/lib/ime";
import type { InventoryItem, ShoppingItem, StorageLocation } from "@/generated/prisma/client";

const LOCATIONS: StorageLocation[] = ["FRIDGE", "FREEZER", "PANTRY"];

/**
 * The shopping list and what's already at home, side by side.
 *
 * At the shop the question is "do I still have some?" as often as "what's
 * next on the list?", so the two are one panel: next to each other where
 * there's room, two tabs on a phone. Ticking a line puts it into the fridge
 * list in the same tap (and unticking takes it back out — see
 * inventory.setShoppingItemBought), so by the time you're home the
 * inventory already says what you bought.
 */
export function ShoppingStockPanel({
  shoppingItems,
  inventory,
  onInventoryChange,
  header,
}: {
  /** Empty when the week has no plan — the inventory is still useful then. */
  shoppingItems: ShoppingItem[];
  inventory: InventoryItem[];
  onInventoryChange: (items: InventoryItem[]) => void;
  /** The list's own heading row (estimate, actual spend), owned by the screen. */
  header?: ReactNode;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"shopping" | "stock">(shoppingItems.length > 0 ? "shopping" : "stock");
  // Ticks are tracked here rather than read back from the plan, so a tick
  // shows immediately and survives the inventory list re-rendering.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const isChecked = (item: ShoppingItem) => checked[item.id] ?? item.checked;

  function toggle(item: ShoppingItem, next: boolean) {
    setChecked((prev) => ({ ...prev, [item.id]: next }));
    void toggleShoppingItemAction(item.id, next).then(onInventoryChange);
  }

  const hasShopping = shoppingItems.length > 0;
  const categories = [...new Set(shoppingItems.map((i) => i.category))];

  const shoppingList = (
    <div className="flex flex-col gap-2">
      {header}
      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.meals.stockBoughtNote}</p>
      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-0.5">
          <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{category}</p>
          {shoppingItems
            .filter((i) => i.category === category)
            .map((item) => (
              // Big rows: this is tapped one-handed in a supermarket aisle.
              <label key={item.id} className="flex min-h-9 items-center gap-2.5 rounded-md px-1 active:bg-surface-alt">
                <input
                  type="checkbox"
                  checked={isChecked(item)}
                  onChange={(e) => toggle(item, e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span className={`min-w-0 flex-1 truncate text-[12px] ${isChecked(item) ? "text-ink-faint line-through" : "text-ink"}`}>
                  {item.name}
                </span>
                <span className="shrink-0 font-mono text-[9.5px] text-ink-faint">{item.quantity}</span>
                <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-soft">¥{item.estimatedYen.toLocaleString()}</span>
              </label>
            ))}
        </div>
      ))}
    </div>
  );

  const stockList = <StockList inventory={inventory} onChange={onInventoryChange} />;

  return (
    <section className="@container flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      {/* Two tabs where it's narrow; on a wide screen both lists show at once
          and the tabs aren't needed. */}
      {hasShopping && (
        <div className="flex gap-1 rounded-full border border-line-strong p-1 @[720px]:hidden">
          {(["shopping", "stock"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 rounded-full px-3 py-1.5 font-mono text-[11px] transition-colors ${
                tab === key ? "bg-accent text-on-accent" : "text-ink-soft"
              }`}
            >
              {key === "shopping" ? t.meals.shoppingTab : t.meals.stockTab(inventory.length)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 @[720px]:grid-cols-2">
        {hasShopping && <div className={tab === "shopping" ? "" : "hidden @[720px]:block"}>{shoppingList}</div>}
        <div className={!hasShopping || tab === "stock" ? "" : "hidden @[720px]:block"}>{stockList}</div>
      </div>
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
