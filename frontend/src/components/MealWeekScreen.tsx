"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getMealWeekAction,
  generateMealPlanAction,
  saveMealPreferenceAction,
  toggleShoppingItemAction,
  type MealWeekView,
} from "@/app/meals/actions";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { formatDateKey, shiftDateKey, todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { MealSlot } from "@/generated/prisma/client";

const SLOTS: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER"];

/**
 * A week of meals and the single shopping trip that supplies it.
 *
 * The plan is presented next to how far it misses the brief, never as
 * finished fact: the model is good at proposing meals and unreliable at
 * arithmetic, so the totals shown here are recomputed from the meals
 * themselves (see checkAgainstBrief) rather than taken from what it
 * claimed.
 */
export function MealWeekScreen() {
  const { t, locale } = useI18n();
  const todayKey = todayKeyValue();
  const [data, setData] = useState<MealWeekView | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [, startSaving] = useTransition();
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);

  useEffect(() => {
    getMealWeekAction(todayKey).then(setData);
  }, [todayKey]);

  if (!data) return <LoadingBlock label={t.common.loading} />;

  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(data.weekStartDateKey, i));
  const view = data.view;

  function generate() {
    setError(null);
    setWarnings([]);
    startGenerating(async () => {
      const res = await generateMealPlanAction(data!.weekStartDateKey, todayKey);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setData((prev) => (prev ? { ...prev, view: res.view } : prev));
      setWarnings(res.warnings);
    });
  }

  function savePreference(patch: Partial<MealWeekView["preference"]>) {
    const next = { ...data!.preference, ...patch };
    setData((prev) => (prev ? { ...prev, preference: next } : prev));
    startSaving(async () => {
      await saveMealPreferenceAction({
        weeklyBudgetYen: next.weeklyBudgetYen,
        weekdayCookMinutes: next.weekdayCookMinutes,
        shoppingWeekday: next.shoppingWeekday,
        dislikes: next.dislikes,
        allergies: next.allergies,
      });
    });
  }

  const mealAt = (dateKey: string, slot: MealSlot) => view?.meals.find((m) => m.dateKey === dateKey && m.slot === slot);
  const totalsFor = (dateKey: string) => view?.dayTotals.find((d) => d.dateKey === dateKey);
  const slotLabel = (slot: MealSlot) =>
    slot === "BREAKFAST" ? t.meals.slotBreakfast : slot === "LUNCH" ? t.meals.slotLunch : t.meals.slotDinner;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t.meals.heading}</h1>
        <span className="font-mono text-xs text-ink-soft">
          {t.meals.weekRange(formatDateKey(dates[0], localeTag(locale)), formatDateKey(dates[6], localeTag(locale)))}
        </span>
        <button
          onClick={generate}
          disabled={generating}
          className="btn-sheen ml-auto rounded-full bg-accent px-4 py-2 font-mono text-xs font-semibold text-on-accent disabled:opacity-50"
        >
          {generating ? t.meals.generating : view ? t.meals.regenerate : t.meals.generate}
        </button>
      </div>

      {view && (
        <p className="font-mono text-[10.5px] text-ink-soft">
          {t.meals.targetLine(view.plan.targetKcal, view.plan.targetProteinG, view.plan.targetFiberG, 7.5)}
        </p>
      )}
      {error && <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{error}</p>}

      {warnings.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft p-4">
          <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-accent uppercase">{t.meals.warningsHeading}</p>
          <p className="text-[11px] text-ink-soft">{t.meals.warningsIntro}</p>
          <ul className="flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="font-mono text-[10.5px] text-ink-soft">
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!view ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-xs text-ink-soft">{t.meals.noPlan}</p>
      ) : (
        <section className="overflow-x-auto">
          <div className="flex min-w-[900px] flex-col gap-2">
            <div className="flex gap-2">
              <div className="w-12 shrink-0" />
              {dates.map((d) => (
                <div key={d} className="flex-1">
                  <p className="font-mono text-[10px] font-semibold text-ink-soft">
                    {t.meals.weekdayNames[new Date(`${d}T00:00:00Z`).getUTCDay()]}{" "}
                    {formatDateKey(d, localeTag(locale), { month: "numeric", day: "numeric" })}
                  </p>
                </div>
              ))}
            </div>
            {SLOTS.map((slot) => (
              <div key={slot} className="flex gap-2">
                <div className="w-12 shrink-0 pt-2 font-mono text-[10px] font-semibold text-accent">{slotLabel(slot)}</div>
                {dates.map((d) => {
                  const meal = mealAt(d, slot);
                  return (
                    <button
                      key={d}
                      onClick={() => meal && setOpenRecipe(openRecipe === meal.id ? null : meal.id)}
                      className="flex-1 rounded-lg border border-line bg-surface p-2 text-left transition-colors hover:border-accent"
                    >
                      {meal ? (
                        <>
                          <p className="text-[11px] leading-snug text-ink">{meal.title}</p>
                          <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
                            {meal.kcal} kcal · {t.meals.prepMinutes(meal.prepMinutes)}
                          </p>
                        </>
                      ) : (
                        <p className="font-mono text-[9px] text-ink-faint">—</p>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="flex gap-2">
              <div className="w-12 shrink-0" />
              {dates.map((d) => {
                const totals = totalsFor(d);
                return (
                  <div key={d} className="flex-1">
                    <p className="font-mono text-[9px] text-ink-faint">
                      {totals ? t.meals.dayTotals(totals.kcal, Math.round(totals.proteinG), Math.round(totals.fiberG)) : "—"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {openRecipe && view && (
        <section className="rounded-xl border border-accent/40 bg-surface p-4">
          {(() => {
            const meal = view.meals.find((m) => m.id === openRecipe);
            if (!meal) return null;
            return (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-accent">{slotLabel(meal.slot)}</span>
                  <h2 className="text-sm font-bold text-ink">{meal.title}</h2>
                  <button onClick={() => setOpenRecipe(null)} className="ml-auto font-mono text-[10px] text-ink-soft">
                    {t.common.close}
                  </button>
                </div>
                <p className="mb-2 font-mono text-[10px] text-ink-faint">
                  {meal.kcal} kcal · P {meal.proteinG}g · F {meal.fatG}g · C {meal.carbG}g · {t.health.fiber} {meal.fiberG}g ·{" "}
                  {t.health.salt} {meal.saltG}g
                </p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">{meal.recipe}</p>
              </>
            );
          })()}
        </section>
      )}

      {view && view.shoppingItems.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.shoppingHeading}</p>
            <span
              className={`ml-auto font-mono text-[11px] font-semibold ${view.estimatedYen > view.plan.budgetYen ? "text-accent" : "text-ink"}`}
            >
              {t.meals.shoppingTotal(view.estimatedYen, view.plan.budgetYen)}
            </span>
          </div>
          {[...new Set(view.shoppingItems.map((i) => i.category))].map((category) => (
            <div key={category} className="flex flex-col gap-1">
              <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{category}</p>
              {view.shoppingItems
                .filter((i) => i.category === category)
                .map((item) => (
                  <label key={item.id} className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      defaultChecked={item.checked}
                      onChange={(e) => void toggleShoppingItemAction(item.id, e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    <span className="text-[11.5px] text-ink">{item.name}</span>
                    <span className="font-mono text-[9.5px] text-ink-faint">{item.quantity}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-soft">¥{item.estimatedYen.toLocaleString()}</span>
                  </label>
                ))}
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.meals.prefHeading}</p>
        <div className="grid grid-cols-2 gap-3">
          <PrefField label={t.meals.prefBudget}>
            <input
              defaultValue={data.preference.weeklyBudgetYen}
              onBlur={(e) => savePreference({ weeklyBudgetYen: Number(e.target.value) })}
              inputMode="numeric"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </PrefField>
          <PrefField label={t.meals.prefCookMinutes}>
            <input
              defaultValue={data.preference.weekdayCookMinutes}
              onBlur={(e) => savePreference({ weekdayCookMinutes: Number(e.target.value) })}
              inputMode="numeric"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </PrefField>
          <PrefField label={t.meals.prefShoppingDay}>
            <select
              defaultValue={data.preference.shoppingWeekday}
              onChange={(e) => savePreference({ shoppingWeekday: Number(e.target.value) })}
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            >
              {t.meals.weekdayNames.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </PrefField>
          <PrefField label={t.meals.prefAllergies}>
            <input
              defaultValue={data.preference.allergies}
              onBlur={(e) => savePreference({ allergies: e.target.value })}
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </PrefField>
        </div>
        <PrefField label={t.meals.prefDislikes}>
          <input
            defaultValue={data.preference.dislikes}
            onBlur={(e) => savePreference({ dislikes: e.target.value })}
            className="w-full bg-transparent text-xs text-ink focus:outline-none"
          />
        </PrefField>
      </section>
    </div>
  );
}

function PrefField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className="rounded-md border border-line bg-surface px-2.5 py-1.5">{children}</span>
    </label>
  );
}
