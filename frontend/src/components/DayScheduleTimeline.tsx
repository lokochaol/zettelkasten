"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addTimeBlockAction,
  getDayScheduleAction,
  removeTimeBlockAction,
  setMealStatusAction,
  type DayMeal,
  type DayScheduleView,
} from "@/app/calendar/actions";
import { Spinner } from "@/components/LoadingSpinner";
import { ExpenseQuickEntry } from "@/components/ExpenseQuickEntry";
import { useEnterKey } from "@/lib/ime";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { layoutSpans } from "@/lib/dayLayout";
import { todayKey as todayKeyIn } from "@/lib/dateKey";

/** Hours are drawn at a fixed scale rather than stretched to fill: an hour
 * has to be the same height on a day with two events and a day with ten,
 * or the timeline stops being readable at a glance. */
const HOUR_PX = 44;

/** The whole day, every day. A window that grew to fit whatever the day
 * happened to hold meant the same hour sat at a different height each
 * time, and a block at six in the morning changed where lunch was drawn.
 * A fixed midnight-to-midnight axis is the one thing that makes two days
 * comparable at a glance. */
const DAY_FROM = 0;
const DAY_TO = 24;

function clockLabel(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function hourOf(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/**
 * The day's schedule at the top of the calendar: Google Calendar events on
 * an hour axis, and beside them the tasks still open in that day's project
 * task notes.
 *
 * The two halves come from different places on purpose. Events are the
 * owner's calendar, which lives in Google and is only mirrored here; tasks
 * are lines of Bullet Journal text in the notes below, read out rather than
 * stored twice (see src/lib/bulletJournal.ts). Nothing is copied between
 * them — this is one view over both, so neither can drift from its source.
 *
 * A calendar that isn't linked, or has stopped authorizing, is a state
 * this renders rather than an error it throws: the task side still works,
 * and the calendar side says exactly what to do about it.
 */
export function DayScheduleTimeline({ dateKey, timeZone }: { dateKey: string; timeZone: string }) {
  const { t, locale } = useI18n();
  // The loaded day travels with its data. Remounting per day used to be
  // the caller's job (key={dateKey}), but a keyed remount here left the
  // previous day's block on screen and stacked one per step; owning the
  // reset means there is only ever one of these in the tree.
  const [loaded, setLoaded] = useState<{ dateKey: string; view: DayScheduleView } | null>(null);
  const [, startLogging] = useTransition();
  // The clock, for the line across the day. A minute is as fine as the
  // line can be read at this scale, and finer would redraw the page for
  // no one's benefit.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  // Never the previous day's schedule under today's heading: until the
  // fetch for this day lands, this component has nothing to show.
  const view = loaded?.dateKey === dateKey ? loaded.view : null;

  function removeBlock(id: string) {
    startLogging(async () => setLoaded({ dateKey, view: await removeTimeBlockAction(id, dateKey) }));
  }

  function logMeal(mealId: string, status: DayMeal["status"], note = "") {
    startLogging(async () => {
      const next = await setMealStatusAction(mealId, status, note, dateKey);
      if (!("error" in next)) setLoaded({ dateKey, view: next });
    });
  }

  useEffect(() => {
    let cancelled = false;
    getDayScheduleAction(dateKey).then((v) => {
      if (!cancelled) setLoaded({ dateKey, view: v });
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  if (!view) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-line bg-surface">
        <Spinner size="sm" />
      </div>
    );
  }

  const events = view.calendar === "linked" ? view.events : [];
  const timed = events.filter((e) => !e.allDay && e.start);
  const allDay = events.filter((e) => e.allDay);

  const isToday = dateKey === todayKeyIn(timeZone);
  const nowHour = now && isToday ? hourOf(now, timeZone) : null;
  const from = DAY_FROM;
  const hours = Array.from({ length: DAY_TO - DAY_FROM }, (_, i) => DAY_FROM + i);
  const timeLabel = (d: Date) =>
    new Intl.DateTimeFormat(localeTag(locale), { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  // Only on today: a line through a day that has already happened, or
  // hasn't yet, is a line through nothing.
  const nowTop = nowHour === null ? null : (nowHour - from) * HOUR_PX;

  // Events and hand-placed blocks share the left lane, so they have to
  // share its width where they overlap.
  const laneItems = [
    ...timed.map((e) => ({
      kind: "event" as const,
      event: e,
      start: hourOf(e.start as Date, timeZone),
      end: hourOf((e.end ?? e.start) as Date, timeZone),
    })),
    ...view.blocks.map((b) => ({
      kind: "block" as const,
      block: b,
      start: b.startMinutes / 60,
      end: (b.startMinutes + b.durationMinutes) / 60,
    })),
  ];
  const lanes = layoutSpans(laneItems.map((i) => ({ start: i.start, end: i.end })));

  return (
    <div className="@container flex flex-col gap-4">
      {view.nutrition && <StatCards nutrition={view.nutrition} />}

      {/* Side by side once the container is wide enough to read two
          columns; stacked when it isn't. Measured against this element
          rather than the window, because the pane can be half the width
          of the screen it sits in. */}
      <div className="flex flex-col gap-4 @[1100px]:flex-row">
        {/* 今日の流れ */}
        <section className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
          <Heading
            label={t.daySchedule.flowHeading}
            extra={view.calendar === "linked" ? t.daySchedule.eventCount(events.length) : undefined}
          />
          {view.calendar !== "linked" && <CalendarNotice state={view.calendar} />}
          {allDay.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allDay.map((e) => (
                <span key={e.id} className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[10px] text-accent">
                  {t.daySchedule.allDay} {e.title}
                </span>
              ))}
            </div>
          )}

          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-0 left-0 flex items-start gap-2" style={{ top: i * HOUR_PX }}>
                <span className="w-9 shrink-0 pt-[1px] text-right font-mono text-[9.5px] text-ink-faint">
                  {String(h).padStart(2, "0")}
                </span>
                <span className="mt-[7px] h-px flex-1 bg-line" />
              </div>
            ))}

            {/* 予定と時間枠 — 食事が無い日は右半分を空けておく理由がない */}
            <div className={`absolute top-0 bottom-0 left-12 ${view.meals.length > 0 ? "right-[48%]" : "right-0"}`}>
              {laneItems.map((item, i) => {
                const lane = lanes[i];
                const top = (item.start - from) * HOUR_PX;
                const height = Math.max(20, (item.end - item.start) * HOUR_PX - 2);
                const style = {
                  top,
                  height,
                  left: `${(lane.column / lane.columns) * 100}%`,
                  width: `calc(${100 / lane.columns}% - 4px)`,
                };
                // Below two lines' worth of height the second line would be
                // sliced in half, which is worse than not showing it. A
                // short block tightens its padding first, so a 45-minute
                // one still gets to say when it is.
                const tight = height < 40;
                const roomForMeta = height >= (tight ? 30 : 34);
                const pad = tight ? "py-0.5" : "py-1";
                if (item.kind === "event") {
                  const e = item.event;
                  const s = e.start as Date;
                  const en = (e.end ?? e.start) as Date;
                  return (
                    <a
                      key={e.id}
                      href={e.htmlLink ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className={`absolute overflow-hidden rounded-r-lg border-l-[3px] border-accent bg-accent-soft pr-2 pl-2 transition-colors hover:bg-accent/15 ${pad}`}
                      style={style}
                    >
                      <p className="truncate text-[11.5px] leading-tight font-semibold text-ink">{e.title}</p>
                      {roomForMeta && (
                        <p className="truncate font-mono text-[9.5px] leading-tight text-ink-soft">
                          {timeLabel(s)}–{timeLabel(en)}
                          {e.location ? ` · ${e.location}` : ""}
                        </p>
                      )}
                    </a>
                  );
                }
                const b = item.block;
                return (
                  <div
                    key={b.id}
                    // Placed by hand, so it reads as the owner's own: the
                    // page's surface with an outline, against the filled
                    // blocks that came from the calendar.
                    className={`group absolute overflow-hidden rounded-r-lg border border-accent/45 border-l-[3px] border-l-accent bg-surface pr-2 pl-2 ${pad}`}
                    style={style}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-[11.5px] leading-tight font-semibold text-ink">{b.title}</p>
                      <button
                        onClick={() => removeBlock(b.id)}
                        className="shrink-0 font-mono text-[9px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent"
                      >
                        {t.common.delete}
                      </button>
                    </div>
                    {roomForMeta && (
                      <p className="truncate font-mono text-[9.5px] leading-tight text-ink-soft">
                        {clockLabel(b.startMinutes)}–{clockLabel(b.startMinutes + b.durationMinutes)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 食事 */}
            <div className="absolute top-0 right-0 bottom-0 w-[46%]">
              {view.meals.map((m) => {
                const start = new Date(m.start);
                const end = new Date(m.end);
                const top = (hourOf(start, timeZone) - from) * HOUR_PX;
                const height = Math.max(20, (hourOf(end, timeZone) - hourOf(start, timeZone)) * HOUR_PX - 2);
                return (
                  <div
                    key={m.id}
                    title={m.recipe}
                    className={`absolute right-0 left-0 overflow-hidden rounded-r-lg border-l-[3px] border-[var(--color-meal)] bg-[var(--color-meal-soft)] pr-2 pl-2 ${
                      height < 40 ? "py-0.5" : "py-1"
                    }`}
                    style={{ top, height }}
                  >
                    <p
                      className={`truncate text-[11px] leading-tight font-semibold ${
                        m.status === "SKIPPED" ? "text-ink-faint line-through" : "text-ink"
                      }`}
                    >
                      {m.title}
                    </p>
                    {height >= (height < 40 ? 30 : 34) && (
                      <p className="truncate font-mono text-[9px] leading-tight text-ink-soft">
                        {m.status === "REPLACED" ? t.daySchedule.logOther : `${m.kcal} kcal`} · {timeLabel(start)}
                        {m.prepMinutes > 0 ? ` · ${t.daySchedule.prep(m.prepMinutes)}` : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* いま */}
            {isToday && nowTop !== null && now && (
              <div
                data-now-line
                className="pointer-events-none absolute right-0 left-9 z-10 flex items-center"
                style={{ top: nowTop }}
              >
                <span className="-ml-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="h-px flex-1 bg-accent" />
                <span className="ml-1 rounded bg-accent px-1 font-mono text-[8.5px] text-on-accent">{timeLabel(now)}</span>
              </div>
            )}

            {timed.length === 0 && view.meals.length === 0 && view.blocks.length === 0 && (
              <p className="absolute top-2 left-12 font-mono text-[10px] text-ink-faint">{t.daySchedule.noEvents}</p>
            )}
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.daySchedule.flowNote}</p>
        </section>

        {/* 右の列 — それぞれ独立したブロック */}
        <div className="flex w-full min-w-0 flex-col gap-4 @[1100px]:w-[330px] @[1100px]:shrink-0">
          {view.meals.length > 0 && (
            <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
              <Heading label={t.daySchedule.mealsHeading} />
              <ul className="flex flex-col gap-2">
                {view.meals.map((m) => (
                  <MealRow key={m.id} meal={m} onLog={logMeal} />
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
            <Heading label={t.daySchedule.openTasks(view.tasks.length)} />
            {view.tasks.length === 0 ? (
              <p className="font-mono text-[10px] text-ink-faint">{t.daySchedule.noTasks}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {view.tasks.map((task, i) => (
                  <li
                    key={`${task.projectId}-${task.line}-${i}`}
                    className="flex items-baseline gap-2"
                    // Indented rather than nested in a list: the depth comes
                    // from the note's own indentation, and a subtask that
                    // reads as one line of text should stay one line here.
                    style={{ paddingLeft: task.depth * 14 }}
                  >
                    <span className="font-mono text-[11px] text-accent">{task.priority ? "*-" : "-"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[11.5px] text-ink">{task.text}</span>
                      <span className="ml-1.5 font-mono text-[9px] text-ink-faint">{task.projectName}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="font-mono text-[9px] leading-relaxed text-ink-faint">{t.daySchedule.tasksSource}</p>
            <TimeBlockForm
              dateKey={dateKey}
              suggestions={view.tasks.map((task) => task.text)}
              onAdded={(next) => setLoaded({ dateKey, view: next })}
            />
          </section>

          <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4">
            <Heading label={t.daySchedule.spendingHeading} />
            <ExpenseQuickEntry dateKey={dateKey} compact />
          </section>
        </div>
      </div>
    </div>
  );
}

/** `// LABEL` — the heading every block on this screen wears. */
function Heading({ label, extra }: { label: string; extra?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-[0.2em] text-accent uppercase">{"//"}</span>
      <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft uppercase">{label}</span>
      {extra && <span className="font-mono text-[9.5px] text-ink-faint">{extra}</span>}
    </div>
  );
}

/**
 * Putting a task on the clock.
 *
 * The day's open tasks are offered as titles, because that is where most
 * of these come from — but the field stays free text: plenty of what
 * takes an hour was never written down as a task, and a picker that
 * refused those would just send the owner to another app.
 */
function TimeBlockForm({
  dateKey,
  suggestions,
  onAdded,
}: {
  dateKey: string;
  suggestions: string[];
  onAdded: (view: DayScheduleView) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [minutes, setMinutes] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [pending, startAdding] = useTransition();
  const listId = `tasks-${dateKey}`;
  const enterKey = useEnterKey(() => submit());

  function submit() {
    if (!title.trim()) return;
    const [h, m] = start.split(":").map(Number);
    setError(null);
    startAdding(async () => {
      const res = await addTimeBlockAction({
        dateKey,
        startMinutes: (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0),
        durationMinutes: Number(minutes),
        title,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onAdded(res);
      setTitle("");
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
      <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.daySchedule.blockHeading}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-md border border-line bg-surface px-1.5 py-1 font-mono text-[10.5px] text-ink focus:border-accent focus:outline-none"
        />
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          inputMode="numeric"
          aria-label={t.daySchedule.blockMinutes}
          className="w-12 rounded-md border border-line bg-surface px-1.5 py-1 text-right font-mono text-[10.5px] text-ink focus:border-accent focus:outline-none"
        />
        <span className="font-mono text-[9.5px] text-ink-faint">{t.daySchedule.blockMinutes}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          {...enterKey}
          list={listId}
          placeholder={t.daySchedule.blockTitlePlaceholder}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button
          onClick={submit}
          disabled={pending || !title.trim()}
          className="btn-sheen rounded-md bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold text-on-accent disabled:opacity-40"
        >
          {t.common.add}
        </button>
      </div>
      {error && <p className="text-[10.5px] text-accent">{error}</p>}
    </div>
  );
}

/**
 * One planned meal, and the one question the plan can't answer by itself:
 * did it actually happen.
 *
 * Three answers, not a checkbox, because "no" splits into two different
 * facts — the meal was skipped, or something else was eaten instead — and
 * they mean opposite things for the day's totals. Unanswered stays
 * unanswered: silence is not a skip.
 */
function MealRow({ meal, onLog }: { meal: DayMeal; onLog: (id: string, status: DayMeal["status"], note?: string) => void }) {
  const { t } = useI18n();
  const answers: [DayMeal["status"], string][] = [
    ["EATEN", t.daySchedule.logAte],
    ["SKIPPED", t.daySchedule.logSkipped],
    ["REPLACED", t.daySchedule.logOther],
  ];
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9px] text-[var(--color-meal)]">{t.daySchedule.slot[meal.slot]}</span>
        <span className="min-w-0 flex-1">
          <span className={`text-[11.5px] ${meal.status === "SKIPPED" ? "text-ink-faint line-through" : "text-ink"}`}>
            {meal.title}
          </span>
          {/* Whether tonight means cooking or just heating something up is
              the first thing worth knowing when the day is already long. */}
          <span className="ml-1.5 rounded bg-surface-alt px-1 py-px font-mono text-[9px] text-ink-soft">
            {meal.kind === "COOK" ? t.meals.kindCook : meal.kind === "BATCH" ? t.meals.kindBatch : t.meals.kindReady}
          </span>
          <span className="ml-1.5 font-mono text-[9px] text-ink-faint">
            {meal.kcal} kcal · {t.daySchedule.prep(meal.prepMinutes)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {answers.map(([status, label]) => (
          <button
            key={status}
            // Answering the same way again clears it: the fastest way back
            // from a mis-tap, and the only way to return to "not yet said".
            onClick={() => onLog(meal.id, meal.status === status ? "PLANNED" : status, meal.replacementNote)}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] transition-colors ${
              meal.status === status
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-ink-faint hover:border-accent hover:text-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {meal.status === "REPLACED" && (
        <input
          defaultValue={meal.replacementNote}
          onBlur={(e) => e.target.value !== meal.replacementNote && onLog(meal.id, "REPLACED", e.target.value)}
          placeholder={t.daySchedule.logOtherPlaceholder}
          className="rounded border border-line bg-surface px-2 py-1 text-[10.5px] text-ink focus:border-accent focus:outline-none"
        />
      )}
    </li>
  );
}

/**
 * The day's headline figures, one card each.
 *
 * Separate cards rather than one strip: these are four different
 * questions — what the body spent, what the plan provides, whether those
 * two meet, and what the food cost — and reading them side by side is
 * the whole point of a dashboard. The nutrients that are easy to miss
 * get their own card underneath, because calories alone can be right
 * while the day is still short on protein.
 */
function StatCards({ nutrition: n }: { nutrition: NonNullable<DayScheduleView["nutrition"]> }) {
  const { t } = useI18n();
  const burn = n.activeEnergyKcal;
  const i = n.intake;
  // Anything answered at all is enough to start showing the day as it
  // actually went; before that, only the plan is known.
  const logged = i.eaten + i.skipped + i.replaced;
  const intakeKcal = logged > 0 ? i.kcal : n.plannedKcal;
  const short = (value: number, target: number) => value < target * 0.9;
  const tone = (value: number, target: number) => (value === 0 ? "faint" : short(value, target) ? "warn" : "ok");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 @[420px]:grid-cols-2 @[860px]:grid-cols-4">
        <Card
          label={burn === null ? t.daySchedule.statTarget : t.daySchedule.statBurn}
          value={`${Math.round(burn ?? n.targetKcal)} kcal`}
          note={burn === null ? undefined : t.daySchedule.statTarget + ` ${n.targetKcal} kcal`}
        />
        <Card
          label={logged > 0 ? t.daySchedule.statActual : t.daySchedule.statPlanned}
          value={`${Math.round(intakeKcal)} kcal`}
          tone={intakeKcal === 0 ? "faint" : Math.abs(intakeKcal - n.targetKcal) > 150 ? "warn" : "ok"}
          note={logged > 0 ? `${t.daySchedule.statPlanned} ${Math.round(n.plannedKcal)} kcal` : undefined}
        />
        {/* Against the target when the phone hasn't reported, against the
            body when it has — the second is the real one. */}
        {/* With nothing eaten and nothing planned, the difference is the
            whole target with a minus in front — a number that looks like
            a deficit and means "no data". A dash says that instead. */}
        <Card
          label={t.daySchedule.statNet}
          value={
            intakeKcal === 0
              ? "—"
              : `${Math.round(intakeKcal - (burn ?? n.targetKcal)) > 0 ? "+" : ""}${Math.round(intakeKcal - (burn ?? n.targetKcal))} kcal`
          }
          tone={intakeKcal === 0 ? "faint" : "plain"}
        />
        <Card label={t.daySchedule.statFoodToday} value={`¥${n.foodSpentYen.toLocaleString()}`} />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3">
        <Stat
          label={t.health.protein}
          value={`${Math.round(logged > 0 ? i.proteinG : n.plannedProteinG)} / ${n.targetProteinG} g`}
          tone={tone(logged > 0 ? i.proteinG : n.plannedProteinG, n.targetProteinG)}
        />
        <Stat
          label={t.health.fiber}
          value={`${Math.round(logged > 0 ? i.fiberG : n.plannedFiberG)} / ${n.targetFiberG} g`}
          tone={tone(logged > 0 ? i.fiberG : n.plannedFiberG, n.targetFiberG)}
        />
        <Stat
          label={t.health.salt}
          value={`${(logged > 0 ? i.saltG : n.plannedSaltG).toFixed(1)} / ${n.saltMaxG} g`}
          tone={
            (logged > 0 ? i.saltG : n.plannedSaltG) === 0
              ? "faint"
              : (logged > 0 ? i.saltG : n.plannedSaltG) > n.saltMaxG
                ? "warn"
                : "ok"
          }
        />
        {n.weightKg !== null && <Stat label={t.daySchedule.statWeight} value={`${n.weightKg} kg`} />}
        {logged > 0 && (
          <span className="ml-auto font-mono text-[9px] leading-relaxed text-ink-faint">
            {[
              i.unlogged > 0 ? t.daySchedule.intakeUnlogged(i.unlogged) : null,
              i.replaced > 0 ? t.daySchedule.intakeReplaced(i.replaced) : null,
              t.daySchedule.intakeNote,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

/** One headline figure in its own block. */
function Card({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "ok" | "warn" | "faint";
}) {
  const color = tone === "warn" ? "text-accent" : tone === "faint" ? "text-ink-faint" : "text-ink";
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className={`text-[19px] leading-none font-extrabold ${color}`}>{value}</span>
      {note && <span className="font-mono text-[9px] text-ink-faint">{note}</span>}
    </div>
  );
}

function Stat({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "ok" | "warn" | "faint" }) {
  const color = tone === "warn" ? "text-accent" : tone === "faint" ? "text-ink-faint" : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] tracking-wider text-ink-faint uppercase">{label}</span>
      <span className={`text-[13px] font-bold ${color}`}>{value}</span>
    </div>
  );
}

function CalendarNotice({ state }: { state: "not_linked" | "reauth_required" | "error" }) {
  const { t } = useI18n();
  const body =
    state === "not_linked" ? t.daySchedule.notLinked : state === "reauth_required" ? t.daySchedule.reauthRequired : t.daySchedule.apiError;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2.5">
      <p className="text-[11.5px] text-ink-soft">{body}</p>
      {state !== "error" && (
        <a
          href="/api/google-calendar/connect"
          className="btn-sheen rounded-full bg-accent px-3.5 py-1.5 font-mono text-[10.5px] font-semibold text-on-accent"
        >
          {state === "not_linked" ? t.daySchedule.connect : t.daySchedule.reconnect}
        </a>
      )}
    </div>
  );
}
