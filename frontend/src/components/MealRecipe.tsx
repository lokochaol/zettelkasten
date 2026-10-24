"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { getRecipeAction, setRecipeUrlAction, writeRecipeAction, type RecipeView } from "@/app/meals/actions";
import { Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { announceChange } from "@/lib/dataSync";
import { recipeText } from "@/lib/mealRecipeText";
import { useBackdropDismiss } from "@/lib/useBackdropDismiss";

/**
 * A meal's recipe, laid out for cooking from: the portions this cooking
 * makes, the ingredients to tick off, the steps to tick through, and how to
 * keep the rest. Opened from the week on /meals and from the day on the
 * calendar — wherever the owner is when it's time to cook.
 *
 * The full recipe is written by the model only when asked (src/lib/
 * mealRecipe.ts); until then the plan's short note is shown, with the
 * owner's own recipe page and search links beside it.
 */
export function MealRecipe({ mealId, showTitle = true }: { mealId: string; /** Off where the screen already titles the meal. */ showTitle?: boolean }) {
  const { t } = useI18n();
  const r = t.meals.recipe;
  // The meal on screen: a batch meal can step over to the dish it came from.
  const [currentId, setCurrentId] = useState(mealId);
  const [view, setView] = useState<RecipeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [saving, startSaving] = useTransition();
  const [request, setRequest] = useState("");
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Ticked while cooking; kept only as long as the recipe is open.
  const [have, setHave] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());

  useEffect(() => {
    let live = true;
    getRecipeAction(currentId).then((res) => {
      if (!live) return;
      if ("error" in res) setError(res.error);
      else {
        setView(res);
        setError(null);
      }
    });
    return () => {
      live = false;
    };
  }, [currentId]);

  function show(next: string) {
    setView(null);
    setHave(new Set());
    setDone(new Set());
    setUrlDraft(null);
    setCurrentId(next);
  }

  function take(res: RecipeView | { error: string }) {
    if ("error" in res) {
      setError(res.error);
      return false;
    }
    setError(null);
    setView(res);
    // The week and the day both mark meals that have a recipe.
    announceChange("meals");
    return true;
  }

  function write() {
    startWriting(async () => {
      if (take(await writeRecipeAction(currentId, request))) {
        setRequest("");
        setHave(new Set());
        setDone(new Set());
      }
    });
  }

  function saveUrl(url: string) {
    startSaving(async () => {
      if (take(await setRecipeUrlAction(currentId, url))) setUrlDraft(null);
    });
  }

  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };

  if (!view) {
    return error ? <p className="text-[11px] text-danger">{error}</p> : <Spinner />;
  }

  const when = (m: { dateKey: string; slot: RecipeView["slot"] }) => `${Number(m.dateKey.slice(5, 7))}/${Number(m.dateKey.slice(8))} ${t.daySchedule.slot[m.slot]}`;
  const detail = view.detail;
  const label = "font-mono text-[10px] tracking-wide text-ink-faint";

  return (
    <div className="flex flex-col gap-3" data-recipe={view.id}>
      <div className={`flex-wrap items-center gap-2 ${showTitle || currentId !== mealId ? "flex" : "hidden"}`}>
        {currentId !== mealId && (
          <button onClick={() => show(mealId)} className="font-mono text-[10px] text-ink-soft hover:text-accent">
            ←
          </button>
        )}
        <span className="font-mono text-[10px] text-[var(--color-meal)]">{when(view)}</span>
        <span className="text-sm font-bold text-ink">{view.title}</span>
        <span className="rounded bg-surface-alt px-1 py-px font-mono text-[9px] text-ink-soft">
          {view.kind === "COOK" ? t.meals.kindCook : view.kind === "BATCH" ? t.meals.kindBatch : t.meals.kindReady}
        </span>
        <span className="font-mono text-[10px] text-ink-faint">
          {r.prep(view.prepMinutes)} · {view.kcal} kcal
        </span>
      </div>

      {view.source && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-surface-alt px-2.5 py-1.5 text-[11px] text-ink-soft">
          {r.fromSource(when(view.source), view.source.title)}
          <button onClick={() => show(view.source!.id)} className="font-mono text-[10px] text-accent hover:underline">
            {r.openSource} →
          </button>
        </p>
      )}
      {view.batches.length > 0 && (
        <p className="rounded-md bg-surface-alt px-2.5 py-1.5 text-[11px] text-ink-soft">
          {r.feedsBatches(view.batches.length)}: {view.batches.map((b) => when(b)).join("、")}
        </p>
      )}

      {/* The owner's own page comes first: when they've chosen one, that's the recipe. */}
      <div className="flex flex-col gap-1.5">
        <span className={label}>{r.page}</span>
        {view.recipeUrl && urlDraft === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={view.recipeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-accent px-3 py-1 font-mono text-[11px] text-on-accent hover:opacity-90"
            >
              {r.openPage} ↗
            </a>
            <span className="max-w-[16rem] truncate font-mono text-[9.5px] text-ink-faint">{view.recipeUrl}</span>
            <button onClick={() => setUrlDraft(view.recipeUrl)} className="font-mono text-[10px] text-ink-soft hover:text-accent">
              {r.editPage}
            </button>
            <button onClick={() => saveUrl("")} disabled={saving} className="font-mono text-[10px] text-ink-faint hover:text-danger">
              {r.removePage}
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <input
              value={urlDraft ?? ""}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder={r.pagePlaceholder}
              inputMode="url"
              className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => saveUrl(urlDraft ?? "")}
              disabled={saving || !(urlDraft ?? "").trim()}
              className="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {r.savePage}
            </button>
          </div>
        )}
      </div>

      {detail ? (
        <div className="flex flex-col gap-3">
          {detail.servings && (
            <p className="text-[11.5px] text-ink">
              <span className={`${label} mr-2`}>{r.servings}</span>
              {detail.servings}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <span className={label}>{r.ingredients}</span>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {detail.ingredients.map((i, n) => (
                <li key={n}>
                  <label className="flex cursor-pointer items-baseline gap-2 text-[12px]">
                    <input type="checkbox" checked={have.has(n)} onChange={() => setHave(toggle(have, n))} className="accent-[var(--color-meal)]" />
                    <span className={have.has(n) ? "text-ink-faint line-through" : "text-ink"}>{i.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-soft">{i.amount}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <span className={label}>{r.steps}</span>
            <ol className="flex flex-col gap-1.5">
              {detail.steps.map((s, n) => (
                <li key={n}>
                  <button
                    onClick={() => setDone(toggle(done, n))}
                    className={`flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] leading-relaxed ${
                      done.has(n) ? "bg-surface-alt text-ink-faint" : "text-ink hover:bg-surface-alt"
                    }`}
                  >
                    <span className={`shrink-0 font-mono text-[11px] ${done.has(n) ? "text-ink-faint" : "text-[var(--color-meal)]"}`}>{done.has(n) ? "✓" : `${n + 1}.`}</span>
                    <span>{s}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          {detail.tips.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={label}>{r.tips}</span>
              <ul className="list-disc pl-5 text-[11.5px] leading-relaxed text-ink-soft">
                {detail.tips.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {detail.storage && (
            <p className="text-[11.5px] leading-relaxed text-ink-soft">
              <span className={`${label} mr-2`}>{r.storage}</span>
              {detail.storage}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            <input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={r.rewritePlaceholder}
              className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
            />
            <button
              onClick={write}
              disabled={writing}
              className="rounded-full border border-line-strong px-2.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {writing ? r.writing : r.rewrite}
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`${view.title}\n${recipeText(detail)}`).then(() => setCopied(true));
              }}
              className="font-mono text-[10px] text-ink-faint hover:text-accent"
            >
              {copied ? r.copied : r.copy}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {view.summary && (
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-ink-soft">
              <span className={`${label} mr-2`}>{r.summary}</span>
              {view.summary}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-ink-faint">{r.notWritten}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={r.rewritePlaceholder}
              className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
            />
            <button
              onClick={write}
              disabled={writing}
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-meal)] px-3 py-1 font-mono text-[11px] text-white hover:opacity-90 disabled:opacity-60"
            >
              {writing && <Spinner />}
              {writing ? r.writing : r.write}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex flex-col gap-1">
        <span className={label}>{r.search}</span>
        <div className="flex flex-wrap gap-1.5">
          {view.searchLinks.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-ink-faint">{r.searchNote}</p>
      </div>
    </div>
  );
}

/** The recipe over whatever screen opened it — the calendar's day, mostly. */
export function MealRecipeDialog({ mealId, onClose }: { mealId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const backdrop = useBackdropDismiss(onClose);

  useEffect(() => {
    if (!mealId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mealId, onClose]);

  if (!mealId || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" {...backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.meals.recipe.heading}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-[640px] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] sm:rounded-xl"
      >
        <div className="mb-3 flex items-center">
          <span className="font-mono text-[10px] tracking-wide text-[var(--color-meal)]">{t.meals.recipe.heading}</span>
          <button onClick={onClose} className="ml-auto font-mono text-[11px] text-ink-soft hover:text-accent">
            {t.common.close}
          </button>
        </div>
        <MealRecipe key={mealId} mealId={mealId} />
      </div>
    </div>,
    document.body,
  );
}
