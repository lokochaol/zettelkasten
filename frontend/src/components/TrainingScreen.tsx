"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  generateTrainingWeekAction,
  getTrainingOverviewAction,
  logTrainingSessionAction,
  saveCompositionTargetAction,
  saveTrainingPreferenceAction,
  type SessionView,
  type TrainingOverview,
} from "@/app/training/actions";
import { LoadingBlock } from "@/components/LoadingSpinner";
import { formatDateKey, shiftDateKey, todayKey as todayKeyValue } from "@/lib/dateKey";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { replaceQuery } from "@/lib/viewState";
import type { TrainingExperience, TrainingKind, TrainingStatus } from "@/generated/prisma/client";

const EXPERIENCES: TrainingExperience[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

/** Whole weeks from `todayKey` to `dateKey` (0 when absent or malformed). */
function weeksFrom(todayKey: string, dateKey: string | undefined): number {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return 0;
  const days = (Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? Math.round(days / 7) : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number) => {
  const r = round1(n);
  return r === 0 ? "±0" : `${r > 0 ? "+" : ""}${r}`;
};

/**
 * The trainer's screen: where the body is against where it's meant to be,
 * how it has moved week by week, and the week of training written from
 * that — with the trainer's reading of it on top, and a place under each
 * session to say how it went, which is what next week's reading is made of.
 */
export function TrainingScreen({ initialWeek }: { initialWeek?: string }) {
  const { t, locale } = useI18n();
  const todayKey = todayKeyValue();
  const [weekOffset, setWeekOffset] = useState(() => weeksFrom(todayKey, initialWeek));
  const [data, setData] = useState<TrainingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const anchorKey = shiftDateKey(todayKey, weekOffset * 7);

  useEffect(() => {
    getTrainingOverviewAction(anchorKey, todayKey).then(setData);
    // Kept in the address so a reload stays on this week (src/lib/viewState.ts).
    replaceQuery({ week: weekOffset === 0 ? null : anchorKey });
  }, [anchorKey, todayKey, weekOffset]);

  // Closing the tab mid-call costs an API call and leaves no plan.
  useEffect(() => {
    if (!generating) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [generating]);

  if (!data) return <LoadingBlock label={t.common.loading} />;

  const dates = Array.from({ length: 7 }, (_, i) => shiftDateKey(data.weekStartDateKey, i));
  const day = (key: string) => formatDateKey(key, localeTag(locale), { month: "numeric", day: "numeric", weekday: "short" });
  const weekOver = dates[6] < todayKey;

  function generate() {
    setError(null);
    startGenerating(async () => {
      const res = await generateTrainingWeekAction(data!.weekStartDateKey, todayKey);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setData((prev) => (prev ? { ...prev, week: res.week } : prev));
    });
  }

  function replaceSession(session: SessionView) {
    setData((prev) =>
      prev ? { ...prev, week: { ...prev.week, sessions: prev.week.sessions.map((s) => (s.id === session.id ? session : s)) } } : prev,
    );
  }

  const done = data.week.sessions.filter((s) => s.status === "DONE").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t.training.heading}</h1>
      </div>

      {data.sex === null ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-[12px] leading-relaxed text-ink-soft">
          {t.training.profileMissing}{" "}
          <Link href="/settings" className="font-mono text-accent hover:underline">
            /settings
          </Link>
        </p>
      ) : (
        <CompositionPanel data={data} todayKey={todayKey} onSaved={(composition, target) => setData((prev) => (prev ? { ...prev, composition, ...target } : prev))} />
      )}

      <HistoryPanel history={data.history} />

      {/* The week: the trainer's reading first, then the sessions it led to. */}
      <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.training.weekHeading}</p>
          <span className="font-mono text-[10.5px] text-ink">
            {day(dates[0])} 〜 {day(dates[6])}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekOffset((o) => o - 1)}
              aria-label={t.meals.prevWeek}
              className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-soft hover:border-accent hover:text-accent"
            >
              ‹
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className="rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {t.meals.weeksAhead(weekOffset)}
            </button>
            <button
              onClick={() => setWeekOffset((o) => o + 1)}
              aria-label={t.meals.nextWeek}
              className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-soft hover:border-accent hover:text-accent"
            >
              ›
            </button>
          </div>
          {data.week.sessions.length > 0 && (
            <span className="font-mono text-[10px] text-ink-soft">{t.training.doneCount(done, data.week.sessions.length)}</span>
          )}
          {!weekOver && (
            <button
              onClick={generate}
              disabled={generating}
              className="btn-sheen ml-auto rounded-lg bg-accent px-3.5 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-60"
            >
              {generating ? t.training.generating : data.week.plan ? t.training.regenerate : t.training.generate}
            </button>
          )}
        </div>
        {!data.week.plan && !generating && <p className="text-[11.5px] leading-relaxed text-ink-soft">{t.training.intro}</p>}
        {error && <p className="text-[11px] whitespace-pre-line text-accent">{error}</p>}

        {data.week.plan && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-surface-alt p-3">
            <p className="font-mono text-[9px] tracking-wider text-accent uppercase">{t.training.analysisHeading}</p>
            {data.week.plan.focus && <p className="text-[12.5px] font-semibold text-ink">{data.week.plan.focus}</p>}
            <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">{data.week.plan.analysis}</p>
          </div>
        )}

        <div className="@container">
          <div className="grid items-start gap-3 @[720px]:grid-cols-2">
            {data.week.sessions.map((s) => (
              <SessionCard key={s.id} session={s} dayLabel={day(s.dateKey)} isPast={s.dateKey < todayKey} isToday={s.dateKey === todayKey} onSaved={replaceSession} />
            ))}
          </div>
        </div>
      </section>

      <PreferencePanel data={data} onSaved={(preference) => setData((prev) => (prev ? { ...prev, preference } : prev))} />
    </div>
  );
}

/** Now against the goal, side by side — the goal worked out into the same
 * four figures as the scale reports, so "18% → 12%" reads as "lose this
 * much fat, keep this much muscle". */
function CompositionPanel({
  data,
  todayKey,
  onSaved,
}: {
  data: TrainingOverview;
  todayKey: string;
  onSaved: (composition: TrainingOverview["composition"], target: { targetBodyFatPercent: number | null; targetLeanMassKg: number | null }) => void;
}) {
  const { t } = useI18n();
  const [bodyFat, setBodyFat] = useState(data.targetBodyFatPercent === null ? "" : String(data.targetBodyFatPercent));
  const [lean, setLean] = useState(data.targetLeanMassKg === null ? "" : String(data.targetLeanMassKg));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const c = data.composition;

  function save() {
    setError(null);
    const target = {
      targetBodyFatPercent: bodyFat.trim() === "" ? null : Number(bodyFat),
      targetLeanMassKg: lean.trim() === "" ? null : Number(lean),
    };
    startSaving(async () => {
      const res = await saveCompositionTargetAction(target, todayKey);
      if ("error" in res) setError(res.error);
      else onSaved(res.composition, target);
    });
  }

  // The goal in the scale's own terms. Lean mass is held at today's unless
  // a lean target is set; the weight follows from lean and the percentage.
  const current = c?.current;
  const targetBf = c?.targetBodyFatPercent ?? null;
  const targetLean = data.targetLeanMassKg ?? current?.leanMassKg ?? null;
  const targetWeight = targetBf !== null && targetLean !== null ? targetLean / (1 - targetBf / 100) : null;
  const targetFat = targetWeight !== null && targetLean !== null ? targetWeight - targetLean : null;

  const rows: { label: string; now: number | null | undefined; goal: number | null; unit: string }[] = [
    { label: t.health.bodyFat, now: current?.bodyFatPercent, goal: targetBf, unit: "%" },
    { label: t.health.leanMass, now: current?.leanMassKg, goal: targetLean, unit: "kg" },
    { label: t.health.fatMass, now: current?.fatMassKg, goal: targetFat, unit: "kg" },
    { label: t.health.weightLabel, now: current?.weightKg, goal: targetWeight, unit: "kg" },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.training.compositionHeading}</p>
      {!c ? (
        <p className="text-[11px] leading-relaxed text-ink-soft">{t.health.compositionNone}</p>
      ) : (
        <>
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-baseline gap-x-4 gap-y-2">
            <span />
            <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{t.training.now}</span>
            <span className="font-mono text-[9px] tracking-wider text-accent uppercase">{t.training.goal}</span>
            <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{t.training.gap}</span>
            {rows.map((r) => (
              <Row key={r.label} label={r.label} now={r.now ?? null} goal={r.goal} unit={r.unit} />
            ))}
          </div>
          {c.trend.fatMassKgPerWeek !== null && c.trend.leanMassKgPerWeek !== null && (
            <p className="font-mono text-[10px] text-ink-soft">{t.health.weeklyChange(round1(c.trend.fatMassKgPerWeek), round1(c.trend.leanMassKgPerWeek))}</p>
          )}
          {c.plan && (
            <p className="text-[11.5px] leading-relaxed text-ink">
              {c.plan.direction === "lose_fat"
                ? t.health.planLoseFat(c.plan.gapKg, c.plan.weeksToTarget ?? 0)
                : c.plan.direction === "gain_lean"
                  ? t.health.planGainLean
                  : t.health.planHold}
            </p>
          )}
          <p className="font-mono text-[9.5px] text-ink-faint">
            {t.health.averagedOver(c.current.days)} · {t.health.suggestedRange(c.suggested.from, c.suggested.to)}
          </p>
          {c.targetIsAuto && <p className="font-mono text-[10px] text-accent">{t.health.targetAuto(c.targetBodyFatPercent)}</p>}
        </>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
        <Field label={t.health.targetBodyFatLabel}>
          <input
            value={bodyFat}
            onChange={(e) => setBodyFat(e.target.value)}
            inputMode="decimal"
            placeholder={c ? String(c.suggested.to) : "12"}
            className="w-24 bg-transparent text-xs text-ink focus:outline-none"
          />
        </Field>
        <Field label={t.training.targetLeanLabel}>
          <input
            value={lean}
            onChange={(e) => setLean(e.target.value)}
            inputMode="decimal"
            placeholder={current?.leanMassKg ? current.leanMassKg.toFixed(1) : ""}
            className="w-24 bg-transparent text-xs text-ink focus:outline-none"
          />
        </Field>
        <button
          onClick={save}
          disabled={saving}
          className="btn-sheen rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent disabled:opacity-50"
        >
          {saving ? t.common.saving : t.common.save}
        </button>
      </div>
      <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.training.targetNote}</p>
      {error && <p className="text-[10.5px] text-accent">{error}</p>}
    </section>
  );
}

function Row({ label, now, goal, unit }: { label: string; now: number | null; goal: number | null; unit: string }) {
  return (
    <>
      <span className="font-mono text-[10px] text-ink-soft">{label}</span>
      <span className="text-sm font-bold text-ink">{now === null ? "—" : `${round1(now)} ${unit}`}</span>
      <span className="text-sm font-bold text-accent">{goal === null ? "—" : `${round1(goal)} ${unit}`}</span>
      <span className="font-mono text-[11px] text-ink-soft">{now === null || goal === null ? "—" : `${signed(goal - now)} ${unit}`}</span>
    </>
  );
}

/** Twelve weeks of weekly averages, newest at the top: the line that says
 * whether the training and the meals are doing what they're for. */
function HistoryPanel({ history }: { history: TrainingOverview["history"] }) {
  const { t, locale } = useI18n();
  const rows = [...history].reverse();
  if (rows.every((w) => w.window.days === 0)) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.training.historyHeading}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] font-mono text-[10.5px]">
          <thead>
            <tr className="text-left text-[9px] tracking-wider text-ink-faint uppercase">
              <th className="py-1 font-normal">{t.training.weekEnding}</th>
              <th className="py-1 text-right font-normal">{t.health.bodyFat}</th>
              <th className="py-1 text-right font-normal">{t.health.leanMass}</th>
              <th className="py-1 text-right font-normal">{t.health.fatMass}</th>
              <th className="py-1 text-right font-normal">{t.health.weightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => {
              const prev = rows[i + 1]?.window;
              const cell = (v: number | null, p: number | null | undefined, unit: string) =>
                v === null ? (
                  "—"
                ) : (
                  <>
                    {round1(v)}
                    {unit}
                    {p !== null && p !== undefined && <span className="ml-1 text-ink-faint">({signed(v - p)})</span>}
                  </>
                );
              return (
                <tr key={w.endDateKey} className="border-t border-line text-ink">
                  <td className="py-1.5 text-ink-soft">{formatDateKey(w.endDateKey, localeTag(locale), { month: "numeric", day: "numeric" })}</td>
                  <td className="py-1.5 text-right">{cell(w.window.bodyFatPercent, prev?.bodyFatPercent, "%")}</td>
                  <td className="py-1.5 text-right">{cell(w.window.leanMassKg, prev?.leanMassKg, "")}</td>
                  <td className="py-1.5 text-right">{cell(w.window.fatMassKg, prev?.fatMassKg, "")}</td>
                  <td className="py-1.5 text-right">{cell(w.window.weightKg, prev?.weightKg, "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[9px] text-ink-faint">{t.training.historyNote}</p>
    </section>
  );
}

const KIND_STYLE: Record<TrainingKind, string> = {
  STRENGTH: "bg-accent-soft text-accent",
  CARDIO: "bg-surface-alt text-ink",
  MOBILITY: "bg-surface-alt text-ink-soft",
};

/** One session: what to do, and — under it — how it went. */
function SessionCard({
  session,
  dayLabel,
  isPast,
  isToday,
  onSaved,
}: {
  session: SessionView;
  dayLabel: string;
  isPast: boolean;
  isToday: boolean;
  onSaved: (s: SessionView) => void;
}) {
  const { t } = useI18n();
  // The record is held here and sent whole on every change, so two quick
  // edits (done, then effort) can't have the second one carry the status
  // from before the first had come back.
  const [record, setRecord] = useState({ status: session.status, rpe: session.rpe, log: session.log });
  const [error, setError] = useState<string | null>(null);

  function save(patch: Partial<{ status: TrainingStatus; rpe: number | null; log: string }>) {
    setError(null);
    const next = { ...record, ...patch };
    setRecord(next);
    void logTrainingSessionAction(session.id, next).then((res) => {
      if ("error" in res) setError(res.error);
      else onSaved(res.session);
    });
  }

  return (
    <div
      className={`flex flex-col gap-2.5 rounded-xl border p-3.5 ${
        isToday ? "border-accent" : "border-line"
      } ${record.status === "SKIPPED" ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-mono text-[10px] ${isToday ? "font-semibold text-accent" : "text-ink-soft"}`}>{dayLabel}</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] ${KIND_STYLE[session.kind]}`}>{t.training.kind[session.kind]}</span>
        <span className="font-mono text-[9.5px] text-ink-faint">{t.training.minutes(session.minutes)}</span>
        {record.status !== "PLANNED" && (
          <span className={`ml-auto font-mono text-[10px] ${record.status === "DONE" ? "text-accent" : "text-ink-faint"}`}>
            {t.training.status[record.status]}
          </span>
        )}
      </div>
      <p className="text-[13px] font-bold text-ink">{session.title}</p>
      {session.notes && <p className="text-[11px] leading-relaxed text-ink-soft">{session.notes}</p>}

      {session.exercises.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {session.exercises.map((e, i) => (
            <li key={i} className="flex flex-col py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12px] text-ink">{e.name}</span>
                <span className="font-mono text-[10.5px] text-ink-soft">
                  {[e.sets ? `${e.sets} × ${e.reps}` : e.reps, e.load].filter(Boolean).join(" · ")}
                </span>
              </div>
              {e.note && <span className="text-[10.5px] leading-relaxed text-ink-faint">{e.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* The log — only once the day has come: it's a record, not a plan. */}
      {(isPast || isToday) && (
        <div className="flex flex-col gap-2 border-t border-line pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["DONE", "SKIPPED"] as const).map((status) => (
              <button
                key={status}
                onClick={() => save({ status: record.status === status ? "PLANNED" : status })}
                className={`rounded-full border px-3 py-1.5 font-mono text-[10.5px] transition-colors ${
                  record.status === status ? "border-accent bg-accent text-on-accent" : "border-line-strong text-ink-soft hover:border-accent hover:text-accent"
                }`}
              >
                {t.training.mark[status]}
              </button>
            ))}
            <select
              value={record.rpe ?? ""}
              onChange={(e) => save({ rpe: e.target.value === "" ? null : Number(e.target.value) })}
              aria-label={t.training.rpeLabel}
              className="ml-auto rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[10.5px] text-ink focus:outline-none"
            >
              <option value="">{t.training.rpeLabel}</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {t.training.rpeOption(n)}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={record.log}
            onChange={(e) => setRecord({ ...record, log: e.target.value })}
            onBlur={() => record.log !== session.log && save({})}
            rows={2}
            placeholder={t.training.logPlaceholder}
            className="resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
          />
          {error && <p className="text-[10.5px] text-accent">{error}</p>}
        </div>
      )}
    </div>
  );
}

function PreferencePanel({ data, onSaved }: { data: TrainingOverview; onSaved: (p: TrainingOverview["preference"]) => void }) {
  const { t } = useI18n();
  const p = data.preference;
  const [form, setForm] = useState({
    daysPerWeek: String(p.daysPerWeek),
    minutesPerSession: String(p.minutesPerSession),
    experience: p.experience,
    equipment: p.equipment,
    limitations: p.limitations,
    focus: p.focus,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const res = await saveTrainingPreferenceAction({
        daysPerWeek: Number(form.daysPerWeek),
        minutesPerSession: Number(form.minutesPerSession),
        experience: form.experience,
        equipment: form.equipment,
        limitations: form.limitations,
        focus: form.focus,
      });
      if ("error" in res) setError(res.error);
      else {
        onSaved(res.preference);
        setSaved(true);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{t.training.prefHeading}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={t.training.prefDays}>
          <select
            value={form.daysPerWeek}
            onChange={(e) => setForm({ ...form, daysPerWeek: e.target.value })}
            className="w-full bg-transparent text-xs text-ink focus:outline-none"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.training.prefMinutes}>
          <input
            value={form.minutesPerSession}
            onChange={(e) => setForm({ ...form, minutesPerSession: e.target.value })}
            inputMode="numeric"
            className="w-full bg-transparent text-xs text-ink focus:outline-none"
          />
        </Field>
        <Field label={t.training.prefExperience}>
          <select
            value={form.experience}
            onChange={(e) => setForm({ ...form, experience: e.target.value as TrainingExperience })}
            className="w-full bg-transparent text-xs text-ink focus:outline-none"
          >
            {EXPERIENCES.map((x) => (
              <option key={x} value={x}>
                {t.training.experience[x]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t.training.prefEquipment}>
        <input
          value={form.equipment}
          onChange={(e) => setForm({ ...form, equipment: e.target.value })}
          placeholder={t.training.prefEquipmentPlaceholder}
          className="w-full bg-transparent text-xs text-ink focus:outline-none"
        />
      </Field>
      <Field label={t.training.prefLimitations}>
        <input
          value={form.limitations}
          onChange={(e) => setForm({ ...form, limitations: e.target.value })}
          placeholder={t.training.prefLimitationsPlaceholder}
          className="w-full bg-transparent text-xs text-ink focus:outline-none"
        />
      </Field>
      <Field label={t.training.prefFocus}>
        <input
          value={form.focus}
          onChange={(e) => setForm({ ...form, focus: e.target.value })}
          placeholder={t.training.prefFocusPlaceholder}
          className="w-full bg-transparent text-xs text-ink focus:outline-none"
        />
      </Field>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn-sheen w-fit rounded-lg bg-accent px-3 py-2 font-mono text-xs font-semibold text-on-accent disabled:opacity-50"
        >
          {saving ? t.common.saving : t.common.save}
        </button>
        {saved && <span className="font-mono text-[10px] text-ink-soft">{t.common.saved}</span>}
      </div>
      {error && <p className="text-[10.5px] text-accent">{error}</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className="rounded-md border border-line bg-surface px-2.5 py-1.5">{children}</span>
    </label>
  );
}
