"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getHealthOverviewAction,
  saveHealthProfileAction,
  issueHealthTokenAction,
  type HealthOverview,
} from "@/app/settings/actions";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Body, goal, and the iPhone link that keeps them current.
 *
 * The targets are shown right under the form rather than only where meals
 * get planned: they're the whole brief the meal planner works from, and a
 * goal that quietly got clamped for safety (see nutritionTargets.ts) is
 * something the owner should see at the moment they set it, not discover
 * in next week's menu.
 */
export function HealthSettings() {
  const { t } = useI18n();
  const [data, setData] = useState<HealthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const todayKey = todayKeyValue();

  const [form, setForm] = useState({
    heightCm: "",
    birthYear: "",
    sex: "MALE" as "MALE" | "FEMALE",
    activityLevel: "LIGHT" as "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE",
    weeklyKgDelta: "0",
    fallbackWeightKg: "",
  });

  useEffect(() => {
    getHealthOverviewAction(todayKey).then((d) => {
      setData(d);
      if (d.profile) {
        setForm({
          heightCm: String(d.profile.heightCm),
          birthYear: String(d.profile.birthYear),
          sex: d.profile.sex,
          activityLevel: d.profile.activityLevel,
          weeklyKgDelta: String(d.profile.weeklyKgDelta),
          fallbackWeightKg: d.profile.fallbackWeightKg === null ? "" : String(d.profile.fallbackWeightKg),
        });
      }
    });
  }, [todayKey]);

  if (!data) return <LoadingBlock label={t.common.loading} />;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveHealthProfileAction(
        {
          heightCm: Number(form.heightCm),
          birthYear: Number(form.birthYear),
          sex: form.sex,
          activityLevel: form.activityLevel,
          weeklyKgDelta: Number(form.weeklyKgDelta),
          fallbackWeightKg: form.fallbackWeightKg === "" ? null : Number(form.fallbackWeightKg),
        },
        todayKey,
      );
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setData((prev) => (prev ? { ...prev, current: res.current } : prev));
    });
  }

  function reissue() {
    setReissueOpen(false);
    startTransition(async () => {
      const token = await issueHealthTokenAction();
      setData((prev) => (prev ? { ...prev, token } : prev));
    });
  }

  const targets = data.current?.targets;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.health.basicsHeading}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.health.heightLabel}>
            <input
              value={form.heightCm}
              onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
              inputMode="decimal"
              placeholder="172"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </Field>
          <Field label={t.health.birthYearLabel}>
            <input
              value={form.birthYear}
              onChange={(e) => setForm({ ...form, birthYear: e.target.value })}
              inputMode="numeric"
              placeholder="1996"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </Field>
          <Field label={t.health.sexLabel}>
            <select
              value={form.sex}
              onChange={(e) => setForm({ ...form, sex: e.target.value as typeof form.sex })}
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            >
              <option value="MALE">{t.health.sexMale}</option>
              <option value="FEMALE">{t.health.sexFemale}</option>
            </select>
          </Field>
          <Field label={t.health.activityLabel}>
            <select
              value={form.activityLevel}
              onChange={(e) => setForm({ ...form, activityLevel: e.target.value as typeof form.activityLevel })}
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            >
              <option value="SEDENTARY">{t.health.activitySedentary}</option>
              <option value="LIGHT">{t.health.activityLight}</option>
              <option value="MODERATE">{t.health.activityModerate}</option>
              <option value="ACTIVE">{t.health.activityActive}</option>
            </select>
          </Field>
          <Field label={t.health.goalLabel}>
            <input
              value={form.weeklyKgDelta}
              onChange={(e) => setForm({ ...form, weeklyKgDelta: e.target.value })}
              inputMode="decimal"
              placeholder="-0.2"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </Field>
          <Field label={t.health.fallbackWeightLabel}>
            <input
              value={form.fallbackWeightKg}
              onChange={(e) => setForm({ ...form, fallbackWeightKg: e.target.value })}
              inputMode="decimal"
              placeholder="68.0"
              className="w-full bg-transparent text-xs text-ink focus:outline-none"
            />
          </Field>
        </div>
        {error && <p className="text-[10.5px] text-accent">{error}</p>}
        <button
          onClick={save}
          disabled={pending}
          className="btn-sheen w-fit rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
      </div>

      {/* The composition and the goal for it live with the training now,
          where they're compared against each other week by week. */}
      <p className="text-[11px] leading-relaxed text-ink-soft">
        {t.health.compositionMoved}{" "}
        <Link href="/training" className="font-mono text-accent hover:underline">
          /training
        </Link>
      </p>

      {targets && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
          <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.health.targetsHeading}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Stat label={t.health.targetKcal} value={`${targets.targetKcal} kcal`} accent />
            <Stat label={t.health.protein} value={`${targets.proteinG} g`} />
            <Stat label={t.health.fat} value={`${targets.fatG} g`} />
            <Stat label={t.health.carb} value={`${targets.carbG} g`} />
            <Stat label={t.health.fiber} value={`${targets.fiberG} g+`} />
            <Stat label={t.health.salt} value={`< ${targets.saltMaxG} g`} />
          </div>
          <p className="font-mono text-[9.5px] leading-relaxed text-ink-faint">
            {t.health.basisLine(
              targets.basalKcal,
              targets.maintenanceKcal,
              data.current?.weightKg ?? 0,
              targets.energyBasis === "measured" ? t.health.basisMeasured(data.current?.activeEnergyDays ?? 0) : t.health.basisEstimated,
            )}
          </p>
          <p className="font-mono text-[9.5px] text-ink-faint">
            {t.health.basisEquation(targets.bodyBasis === "lean" ? "Katch-McArdle" : "Mifflin-St Jeor")}
          </p>
          {targets.bodyBasis === "lean" && (
            <p className="font-mono text-[9.5px] leading-relaxed text-ink-faint">{t.health.leanBasis}</p>
          )}
          {targets.deficitLimited && <p className="text-[10.5px] text-accent">{t.health.deficitLimited}</p>}
          <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.health.disclaimer}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.health.syncHeading}</p>
        <p className="text-[11px] leading-relaxed text-ink-soft">{t.health.syncIntro}</p>
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-relaxed text-ink-soft">
          {t.health.syncSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="flex flex-col gap-1 rounded-lg bg-surface-alt p-3">
          <code className="font-mono text-[10.5px] break-all text-ink">POST {origin}/api/health/ingest</code>
          <code className="font-mono text-[10.5px] break-all text-ink-soft">
            Authorization: Bearer {data.token ? data.token.token : t.health.tokenNotIssued}
          </code>
          <code className="font-mono text-[10px] break-all text-ink-soft">
            {`{ "date": "${todayKey}", "weightKg": 68.4, "activeEnergyKcal": 620, "steps": 9210 }`}
          </code>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (data.token ? setReissueOpen(true) : reissue())}
            disabled={pending}
            className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs font-semibold text-ink transition-colors hover:bg-surface-alt disabled:opacity-50"
          >
            {data.token ? t.health.reissueToken : t.health.issueToken}
          </button>
          {data.token?.lastUsedAt && (
            <span className="font-mono text-[9.5px] text-ink-faint">
              {t.health.lastUsed(new Date(data.token.lastUsedAt).toLocaleString())}
            </span>
          )}
        </div>

        {data.recent.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            {data.recent.map((m) => (
              <div key={m.dateKey} className="flex items-center gap-3 font-mono text-[10px] text-ink-soft">
                <span className="text-ink-faint">{m.dateKey}</span>
                <span>{m.weightKg !== null ? `${m.weightKg} kg` : "—"}</span>
                <span>{m.activeEnergyKcal !== null ? `${Math.round(m.activeEnergyKcal)} kcal` : "—"}</span>
                <span>{m.steps !== null ? `${m.steps.toLocaleString()} ${t.health.stepsUnit}` : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={reissueOpen}
        title={t.health.reissueConfirmTitle}
        warning={t.health.reissueConfirmWarning}
        confirmLabel={t.health.reissueToken}
        onCancel={() => setReissueOpen(false)}
        onConfirm={reissue}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className="rounded-md border border-line bg-surface px-2.5 py-1.5">{children}</span>
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className={`text-sm font-bold ${accent ? "text-accent" : "text-ink"}`}>{value}</span>
    </div>
  );
}
