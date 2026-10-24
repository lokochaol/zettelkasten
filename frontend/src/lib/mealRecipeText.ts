import { ValidationError } from "@/lib/errors";

/** The pure half of src/lib/mealRecipe.ts: the recipe's shape, its text, and its links. */

export interface RecipeDetail {
  /** What this cooking makes, e.g. "3食分（今夜1・残り2食は冷蔵）". */
  servings: string;
  ingredients: { name: string; amount: string }[];
  steps: string[];
  tips: string[];
  /** How to keep and reheat what isn't eaten now; empty when nothing's left over. */
  storage: string;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Reads a stored or freshly written detail, dropping whatever doesn't fit the shape. */
export function toRecipeDetail(value: unknown): RecipeDetail | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const ingredients = (Array.isArray(o.ingredients) ? o.ingredients : [])
    .map((i) => {
      const r = (i ?? {}) as Record<string, unknown>;
      return { name: str(r.name, 80), amount: str(r.amount, 60) };
    })
    .filter((i) => i.name)
    .slice(0, 40);
  const steps = (Array.isArray(o.steps) ? o.steps : []).map((s) => str(s, 400)).filter(Boolean).slice(0, 20);
  if (ingredients.length === 0 && steps.length === 0) return null;
  return {
    servings: str(o.servings, 120),
    ingredients,
    steps,
    tips: (Array.isArray(o.tips) ? o.tips : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 8),
    storage: str(o.storage, 400),
  };
}

/** Search pages for the dish, on the sites people actually cook from. */
export function recipeSearchLinks(title: string, locale: "ja" | "en" = "ja"): { label: string; url: string }[] {
  const q = encodeURIComponent(title);
  if (locale === "en") return [{ label: "Google", url: `https://www.google.com/search?q=${q}+recipe` }];
  return [
    { label: "クックパッド", url: `https://cookpad.com/jp/search/${q}` },
    { label: "クラシル", url: `https://www.kurashiru.com/search?query=${q}` },
    { label: "DELISH KITCHEN", url: `https://delishkitchen.tv/search?q=${q}` },
    { label: "Google", url: `https://www.google.com/search?q=${q}+%E3%83%AC%E3%82%B7%E3%83%94` },
  ];
}

/** Only a web page: anything else in a link the owner taps in the kitchen is a mistake or worse. */
export function cleanRecipeUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new ValidationError("mealRecipeUrlInvalid", "Not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError("mealRecipeUrlInvalid", "Only web pages");
  if (v.length > 2000) throw new ValidationError("mealRecipeUrlInvalid", "URL too long");
  return url.toString();
}

/** The recipe as plain text, for a calendar event or a copy to the clipboard. */
export function recipeText(detail: RecipeDetail): string {
  return [
    detail.servings ? `【分量】${detail.servings}` : "",
    "【材料】",
    ...detail.ingredients.map((i) => `・${i.name} ${i.amount}`),
    "【作り方】",
    ...detail.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(detail.tips.length ? ["【コツ】", ...detail.tips.map((s) => `・${s}`)] : []),
    detail.storage ? `【保存】${detail.storage}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
