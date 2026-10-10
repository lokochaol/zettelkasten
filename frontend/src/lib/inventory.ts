import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { InventoryItem, StorageLocation } from "@/generated/prisma/client";

export type { InventoryItem, StorageLocation };

/**
 * What's in the fridge, freezer and cupboard.
 *
 * Kept up to date mostly as a side effect of shopping: ticking a line on the
 * week's shopping list puts it here, unticking takes it back out. The rest
 * is typed in by hand, or changed through the meal chat ("卵を使い切った").
 * The meal planner and the chat read it so the week is planned around what's
 * already at home.
 */

const LOCATIONS: StorageLocation[] = ["FRIDGE", "FREEZER", "PANTRY"];

export function isLocation(value: unknown): value is StorageLocation {
  return typeof value === "string" && (LOCATIONS as string[]).includes(value);
}

/**
 * A first guess at where a bought item is kept, from the shopping line's
 * category, name and quantity. Free text from the planner, so it's keyword
 * matching, and only a guess — one tap moves it.
 */
export function guessLocation(category: string, name: string, quantity: string): StorageLocation {
  const text = `${category} ${name} ${quantity}`;
  if (/冷凍/.test(text)) return "FREEZER";
  if (/乾物|調味料|米|パスタ|缶|常温|パン|シリアル|オートミール|粉|油|酢|醤油|味噌|砂糖|塩|だし|海苔|ふりかけ/.test(text)) return "PANTRY";
  return "FRIDGE";
}

export async function listInventory(ownerSub: string): Promise<InventoryItem[]> {
  const items = await prisma.inventoryItem.findMany({ where: { ownerSub }, orderBy: [{ createdAt: "asc" }] });
  // Fridge first (what goes off soonest), then freezer, then cupboard.
  return items.sort((a, b) => LOCATIONS.indexOf(a.location) - LOCATIONS.indexOf(b.location));
}

export interface InventoryInput {
  name: string;
  quantity?: string;
  location?: StorageLocation;
}

function clean(input: InventoryInput) {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new ValidationError("inventoryInvalid", "name is required");
  return {
    name,
    quantity: (input.quantity ?? "").trim().slice(0, 100),
    location: input.location && isLocation(input.location) ? input.location : "FRIDGE",
  } as const;
}

export async function addInventoryItem(ownerSub: string, input: InventoryInput): Promise<InventoryItem> {
  return prisma.inventoryItem.create({ data: { ownerSub, ...clean(input) } });
}

export async function updateInventoryItem(
  ownerSub: string,
  id: string,
  input: Partial<InventoryInput>,
): Promise<InventoryItem> {
  const existing = await prisma.inventoryItem.findFirst({ where: { id, ownerSub } });
  if (!existing) throw new ValidationError("inventoryNotFound", "Inventory item not found");
  const next = clean({
    name: input.name ?? existing.name,
    quantity: input.quantity ?? existing.quantity,
    location: input.location ?? existing.location,
  });
  return prisma.inventoryItem.update({ where: { id }, data: next });
}

export async function removeInventoryItem(ownerSub: string, id: string): Promise<void> {
  await prisma.inventoryItem.deleteMany({ where: { id, ownerSub } });
}

/**
 * Ticks or unticks a shopping-list line, and keeps the stock in step: ticked
 * means bought, so it goes into the inventory (once — ticking twice doesn't
 * buy it twice); unticked means it wasn't, so the stock it became comes back
 * out. One transaction, so the list and the fridge can't disagree.
 */
export async function setShoppingItemBought(ownerSub: string, itemId: string, checked: boolean): Promise<void> {
  const item = await prisma.shoppingItem.findFirst({ where: { id: itemId, OR: [{ plan: { ownerSub } }, { list: { ownerSub } }] } });
  if (!item) throw new ValidationError("mealPlanNotFound", "Shopping item not found");
  await prisma.$transaction(async (tx) => {
    await tx.shoppingItem.update({ where: { id: itemId }, data: { checked } });
    if (checked) {
      await tx.inventoryItem.upsert({
        where: { shoppingItemId: itemId },
        create: {
          ownerSub,
          name: item.name,
          quantity: item.quantity,
          location: guessLocation(item.category, item.name, item.quantity),
          shoppingItemId: itemId,
        },
        update: {},
      });
    } else {
      await tx.inventoryItem.deleteMany({ where: { shoppingItemId: itemId, ownerSub } });
    }
  });
}

/** The inventory as lines of text, for the planner's and the chat's briefs. */
export function inventoryBrief(items: InventoryItem[]): string {
  if (items.length === 0) return "  （記録なし）";
  const label: Record<StorageLocation, string> = { FRIDGE: "冷蔵", FREEZER: "冷凍", PANTRY: "常温" };
  return items.map((i) => `  [${label[i.location]}] ${i.name}${i.quantity ? ` ${i.quantity}` : ""}`).join("\n");
}
