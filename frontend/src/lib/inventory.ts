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

/**
 * Kanji and kana spellings of the same food, for the comparison below:
 * each written form on the left is read as the one on the right. Reading
 * arbitrary kanji would take a morphological dictionary tens of megabytes
 * big; the foods that actually turn up on a shopping list are a short list,
 * and the model also names the stock line it matched (purchaseList), which
 * covers what this doesn't. Keys are written as they look after katakana
 * has become hiragana.
 */
const FOOD_SPELLINGS: [string, string][] = [
  // meat
  ["鶏", "とり"], ["鳥", "とり"], ["胸", "むね"], ["腿", "もも"], ["手羽", "てば"],
  ["挽き肉", "ひき肉"], ["挽肉", "ひき肉"], ["みんち", "ひき肉"],
  ["小間切れ", "こま切れ"], ["細切れ", "こま切れ"], ["小間", "こま"],
  // vegetables
  ["玉葱", "たまねぎ"], ["玉ねぎ", "たまねぎ"], ["長葱", "ながねぎ"], ["長ねぎ", "ながねぎ"], ["葱", "ねぎ"],
  ["人参", "にんじん"], ["大根", "だいこん"], ["牛蒡", "ごぼう"], ["蓮根", "れんこん"], ["生姜", "しょうが"], ["大蒜", "にんにく"],
  ["茄子", "なす"], ["胡瓜", "きゅうり"], ["南瓜", "かぼちゃ"], ["白菜", "はくさい"], ["小松菜", "こまつな"],
  ["法蓮草", "ほうれんそう"], ["ほうれん草", "ほうれんそう"], ["椎茸", "しいたけ"], ["舞茸", "まいたけ"], ["占地", "しめじ"],
  ["薩摩芋", "さつまいも"], ["さつま芋", "さつまいも"], ["甘藷", "さつまいも"], ["じゃが芋", "じゃがいも"], ["馬鈴薯", "じゃがいも"],
  ["里芋", "さといも"], ["長芋", "ながいも"], ["山芋", "やまいも"], ["枝豆", "えだまめ"], ["隠元", "いんげん"],
  // fish and seafood
  ["鮭", "さけ"], ["しゃけ", "さけ"], ["鯖", "さば"], ["鰯", "いわし"], ["鯵", "あじ"], ["鱈", "たら"], ["鰤", "ぶり"],
  ["秋刀魚", "さんま"], ["鮪", "まぐろ"], ["海老", "えび"], ["烏賊", "いか"], ["蛸", "たこ"], ["浅蜊", "あさり"],
  // eggs, fruit, staples
  ["玉子", "たまご"], ["卵", "たまご"], ["お米", "米"],
  ["檸檬", "れもん"], ["林檎", "りんご"], ["蜜柑", "みかん"], ["苺", "いちご"], ["葡萄", "ぶどう"],
  // seasonings
  ["醤油", "しょうゆ"], ["味醂", "みりん"], ["胡麻", "ごま"], ["味噌", "みそ"], ["砂糖", "さとう"], ["胡椒", "こしょう"], ["片栗", "かたくり"],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

/** A food name reduced to what makes two spellings the same item: width
 * and case folded, katakana read as hiragana, spaces and bracketed notes
 * ("鶏むね肉（皮なし）") dropped, and the common kanji/kana variants above
 * ("鶏胸肉" / "鶏むね肉") written one way. */
export function normalizeFoodName(name: string): string {
  let out = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  for (const [from, to] of FOOD_SPELLINGS) if (out.includes(from)) out = out.split(from).join(to);
  return out;
}

/**
 * The inventory line a shopping line is already covered by, if any: the
 * same item by normalized name, or one name inside the other ("しょうゆ" /
 * "減塩しょうゆ"). Containment needs two characters on the shorter side,
 * so a one-character name like "米" only matches itself, never "米酢".
 */
export function matchStock<T extends { name: string }>(name: string, stock: T[]): T | null {
  const a = normalizeFoodName(name);
  if (!a) return null;
  for (const item of stock) {
    const b = normalizeFoodName(item.name);
    if (!b) continue;
    if (a === b) return item;
    if (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a))) return item;
  }
  return null;
}
