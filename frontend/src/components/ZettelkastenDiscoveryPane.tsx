"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listDiscoveryNotesAction,
  setNoteDiscoveryEnabledAction,
  getDiscoveryScheduleAction,
  saveDiscoveryScheduleAction,
  runDiscoveryAction,
} from "@/app/dash-off/actions";
import { LoadingBlock, Spinner } from "@/components/LoadingSpinner";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { DiscoveryNoteRow, DiscoverySchedule } from "@/lib/discovery";

/**
 * Picking what discovery looks at, and how often.
 *
 * This replaces "run over every active note on a schedule someone set once
 * in Settings". Two things were wrong with that. The search spends the
 * owner's own API credits, so it shouldn't have been on by default; and
 * most 走り書き are scraps that will be archived in a week, so searching
 * the web for all of them was mostly waste. Notes opt in here, one at a
 * time, and the frequency lives next to that choice rather than three
 * screens away — including 0, which is now the default.
 */
export function ZettelkastenDiscoveryPane() {
  const { t } = useI18n();
  const [notes, setNotes] = useState<DiscoveryNoteRow[] | null>(null);
  const [schedule, setSchedule] = useState<DiscoverySchedule | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [, startSaving] = useTransition();

  useEffect(() => {
    Promise.all([listDiscoveryNotesAction(), getDiscoveryScheduleAction()]).then(([n, s]) => {
      setNotes(n);
      setSchedule(s);
    });
  }, []);

  if (!notes || !schedule) return <LoadingBlock label={t.discoveryTab.loading} />;

  const enabledCount = notes.filter((n) => n.enabled).length;

  function toggle(note: DiscoveryNoteRow) {
    const next = !note.enabled;
    setNotes((prev) => prev?.map((n) => (n.id === note.id ? { ...n, enabled: next } : n)) ?? prev);
    startSaving(async () => {
      await setNoteDiscoveryEnabledAction(note.id, next);
    });
  }

  function saveSchedule(patch: Partial<DiscoverySchedule>) {
    const next = { ...schedule!, ...patch };
    setSchedule(next);
    startSaving(async () => {
      await saveDiscoveryScheduleAction(next);
    });
  }

  function runNow() {
    setRunning(true);
    setResult(null);
    void runDiscoveryAction(true)
      .then((r) => setResult(t.discovery.triggerResult(r.notesChecked, r.candidatesFound)))
      .catch(() => setResult(t.discovery.triggerFailed))
      .finally(() => setRunning(false));
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 p-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-extrabold tracking-tight text-ink">{t.discoveryTab.heading}</h1>
        <p className="font-mono text-[10.5px] leading-relaxed text-ink-soft">{t.discoveryTab.description}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.discoveryTab.frequencyHeading}</p>
        <div className="flex flex-wrap items-center gap-2">
          {([0, 1, 2] as const).map((times) => (
            <button
              key={times}
              onClick={() => saveSchedule({ timesPerDay: times })}
              className={`rounded-full border px-3 py-1.5 font-mono text-[10.5px] transition-colors ${
                schedule.timesPerDay === times
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-ink-soft hover:text-ink"
              }`}
            >
              {t.discoveryTab.timesPerDay(times)}
            </button>
          ))}
          {schedule.timesPerDay > 0 && (
            <>
              <HourPicker value={schedule.hour1} onChange={(hour1) => saveSchedule({ hour1 })} />
              {schedule.timesPerDay === 2 && <HourPicker value={schedule.hour2} onChange={(hour2) => saveSchedule({ hour2 })} />}
              <span className="font-mono text-[9.5px] text-ink-faint">{t.discoveryTab.timezoneNote}</span>
            </>
          )}
        </div>
        {schedule.timesPerDay === 0 && <p className="font-mono text-[10px] text-ink-faint">{t.discoveryTab.offExplainer}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
            {t.discoveryTab.notesHeading(enabledCount, notes.length)}
          </p>
          <button
            onClick={runNow}
            disabled={running || enabledCount === 0}
            className="btn-sheen ml-auto flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent disabled:opacity-40"
          >
            {running && <Spinner size="xs" />}
            {running ? t.discovery.triggerRunning : t.discovery.triggerLabel}
          </button>
        </div>
        {result && <p className="font-mono text-[10px] text-accent">{result}</p>}

        {notes.length === 0 ? (
          <p className="font-mono text-[10.5px] text-ink-faint">{t.discoveryTab.noNotes}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {notes.map((note) => (
              <li key={note.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:border-accent">
                  <input
                    type="checkbox"
                    checked={note.enabled}
                    onChange={() => toggle(note)}
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{note.preview || t.common.noContent}</span>
                  {note.candidateCount > 0 && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9px] text-accent">
                      {t.discoveryTab.candidateCount(note.candidateCount)}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                    {note.lastRunAt ? t.discoveryTab.lastRun(new Date(note.lastRunAt).toLocaleDateString()) : t.discoveryTab.neverRun}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HourPicker({ value, onChange }: { value: number; onChange: (hour: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10.5px] text-ink focus:outline-none"
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}
