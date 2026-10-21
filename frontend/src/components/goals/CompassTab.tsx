"use client";

import { useState, type FormEvent } from "react";
import { saveCompassFieldAction } from "@/app/goals/actions";
import { addChangeAction, createCheckAction, deleteChangeAction, deleteCheckAction, savePlanAction, updateCheckAction } from "@/app/goals/planActions";
import type { ChangeInput, CheckInput, CheckView } from "@/lib/goalPlan";
import type { CompassField } from "@/lib/goals";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { BlurText, Card, DateInput, GoalChip, INPUT, LABEL, NO_GOAL_HEX, PILL, PRIMARY, okOr, useDay, type TabProps } from "@/components/goals/ui";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** The compass in the order it's read: why, what's already here, what's
 * enough, what gets in the way — then the years behind. */
const COMPASS_ORDER: CompassField[] = ["principles", "happiness", "essentials", "obstacles", "archive"];

const SOURCE_COLOR: Record<string, string> = { MANUAL: "#64748b", ADVISOR: "#8b5cf6", IMPORT: "#3b6fe0" };

/**
 * 指針 — what steers the plan when it has to change: the rules (when this
 * is observed, change that), what's still to be confirmed, the log of every
 * change and why, and under it all the compass the goals stand on.
 */
export function CompassTab(props: TabProps) {
  const { ov, setOv, generation, onError } = props;
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <Card title={t.plan.rulesHeading} intro={t.plan.rulesIntro}>
        <BlurText
          key={`rules:${generation}`}
          value={ov.plan.decisionRules}
          rows={5}
          onSave={async (decisionRules) => {
            const res = await savePlanAction({ decisionRules });
            if ("error" in res) throw new Error(res.error);
            setOv((o) => ({ ...o, plan: res.plan }));
          }}
        />
      </Card>
      <ChecksCard {...props} />
      <ChangeLogCard {...props} />

      <h2 className="mt-2 font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.plan.compassHeading}</h2>
      <div className="@container">
        <div className="grid items-start gap-4 @[900px]:grid-cols-2">
          {COMPASS_ORDER.map((field) => (
            <section key={field} className={`flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 ${field === "archive" ? "@[900px]:col-span-2" : ""}`}>
              <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-ink-soft">{t.goals.compass[field].title}</p>
              <p className="text-[11px] text-ink-faint">{t.goals.compass[field].hint}</p>
              <MarkdownNoteEditor
                key={`${field}:${generation}`}
                content={ov.compass[field]}
                draftKey={`goal-compass:${field}`}
                onSave={async (content) => {
                  const res = await saveCompassFieldAction(field, content);
                  if ("error" in res) {
                    onError(res.error);
                    throw new Error(res.error);
                  }
                  setOv((o) => ({ ...o, compass: { ...o.compass, [field]: content } }));
                }}
              />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChecksCard({ ov, setOv, todayKey, active, hexes, onError }: TabProps) {
  const { t } = useI18n();
  const day = useDay();
  const [question, setQuestion] = useState("");
  const put = (c: CheckView) => setOv((o) => ({ ...o, checks: o.checks.map((x) => (x.id === c.id ? c : x)) }));
  async function save(c: CheckView, p: Partial<CheckInput>) {
    const res = await updateCheckAction(c.id, { ...c, ...p });
    if ("error" in res) {
      onError(res.error);
      throw new Error(res.error);
    }
    put(res.check);
  }
  const open = ov.checks.filter((c) => !c.done);
  const done = ov.checks.filter((c) => c.done);

  const row = (c: CheckView) => {
    const overdue = !c.done && !!c.dueDateKey && c.dueDateKey < todayKey;
    const goal = active.find((g) => g.id === c.goalId);
    return (
      <li key={c.id} className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${overdue ? "border-accent" : "border-line"} ${c.done ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={c.done} onChange={(e) => void save(c, { done: e.target.checked }).catch(() => {})} aria-label={t.plan.done} className="h-4 w-4 accent-[var(--color-accent)]" />
          {goal && <GoalChip goal={goal} hex={hexes.get(goal.id) ?? NO_GOAL_HEX} />}
          <div className="min-w-0 flex-1">
            <BlurText value={c.question} onSave={(question) => (question.trim() ? save(c, { question }) : undefined)} className={`font-semibold ${c.done ? "line-through" : ""}`} />
          </div>
          <DateInput value={c.dueDateKey} onChange={(dueDateKey) => void save(c, { dueDateKey }).catch(() => {})} label={t.plan.checkDue} className={overdue ? "border-accent text-accent" : ""} />
          <button
            type="button"
            onClick={() => {
              setOv((o) => ({ ...o, checks: o.checks.filter((x) => x.id !== c.id) }));
              void deleteCheckAction(c.id);
            }}
            aria-label={t.plan.remove}
            className="font-mono text-[11px] text-ink-faint hover:text-accent"
          >
            ×
          </button>
        </div>
        <div className="grid gap-x-3 gap-y-1 pl-6 sm:grid-cols-3">
          <BlurText label={t.plan.checkMethod} value={c.method} rows={2} onSave={(method) => save(c, { method })} />
          <BlurText label={t.plan.checkImpact} value={c.impact} rows={2} onSave={(impact) => save(c, { impact })} />
          <BlurText label={t.plan.checkAnswer} value={c.answer} rows={2} onSave={(answer) => save(c, { answer })} />
        </div>
        {c.done && c.dueDateKey && <span className="pl-6 font-mono text-[9.5px] text-ink-faint">{day.short(c.dueDateKey)}</span>}
      </li>
    );
  };

  return (
    <Card title={t.plan.checksHeading} intro={t.plan.checksIntro}>
      <ul className="flex flex-col gap-2">{open.map(row)}</ul>
      <form
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const res = okOr(await createCheckAction({ goalId: null, question, method: "", impact: "", dueDateKey: null, answer: "", done: false }), onError);
          if (!res) return;
          setOv((o) => ({ ...o, checks: [...o.checks, res.check] }));
          setQuestion("");
        }}
        className="flex items-center gap-1.5"
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.plan.checkQuestion} className={`${INPUT} min-w-0 flex-1`} />
        <button type="submit" disabled={!question.trim()} className={PILL}>
          + {t.plan.addCheck}
        </button>
      </form>
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[10px] text-ink-faint">
            {t.plan.done}（{done.length}）
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{done.map(row)}</ul>
        </details>
      )}
    </Card>
  );
}

function ChangeLogCard({ ov, setOv, todayKey, onError }: TabProps) {
  const { t } = useI18n();
  const day = useDay();
  const [draft, setDraft] = useState<ChangeInput | null>(null);
  return (
    <Card
      title={t.plan.changeLogHeading}
      intro={t.plan.changeLogIntro}
      action={
        !draft && (
          <button type="button" onClick={() => setDraft({ dateKey: todayKey, before: "", after: "", reason: "", checkDateKey: null })} className={PILL}>
            + {t.plan.addChange}
          </button>
        )
      }
    >
      {draft && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const res = okOr(await addChangeAction(draft), onError);
            if (!res) return;
            setOv((o) => ({ ...o, changeLog: [res.change, ...o.changeLog] }));
            setDraft(null);
          }}
          className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {(["before", "after", "reason"] as const).map((f) => (
              <label key={f} className="flex flex-col gap-0.5">
                <span className={LABEL}>{f === "before" ? t.plan.changeBefore : f === "after" ? t.plan.changeAfter : t.plan.changeReason}</span>
                <textarea value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} rows={2} className={`${INPUT} text-[12px]`} />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={draft.dateKey} onChange={(e) => setDraft({ ...draft, dateKey: e.target.value })} className={INPUT} required />
            <span className={LABEL}>{t.plan.changeCheck}</span>
            <DateInput value={draft.checkDateKey} onChange={(checkDateKey) => setDraft({ ...draft, checkDateKey })} />
            <button type="submit" disabled={!draft.after.trim() && !draft.before.trim()} className={`${PRIMARY} ml-auto`}>
              {t.plan.addChange}
            </button>
            <button type="button" onClick={() => setDraft(null)} className={PILL}>
              {t.plan.cancel}
            </button>
          </div>
        </form>
      )}
      <ol className="flex flex-col">
        {ov.changeLog.map((c) => {
          const hex = SOURCE_COLOR[c.source] ?? SOURCE_COLOR.MANUAL;
          return (
            <li key={c.id} className="relative flex flex-col gap-1 border-l-2 py-2 pl-4" style={{ borderColor: hex }}>
              <span className="absolute top-3 -left-[5px] h-2 w-2 rounded-full" style={{ background: hex }} />
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                <span className="font-semibold text-ink">{day.full(c.dateKey)}</span>
                <span style={{ color: hex }}>{t.plan.source[c.source as keyof typeof t.plan.source] ?? c.source}</span>
                {c.checkDateKey && (
                  <span className="text-ink-faint">
                    {t.plan.changeCheck} {day.short(c.checkDateKey)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOv((o) => ({ ...o, changeLog: o.changeLog.filter((x) => x.id !== c.id) }));
                    void deleteChangeAction(c.id);
                  }}
                  aria-label={t.plan.remove}
                  className="ml-auto text-[11px] text-ink-faint hover:text-accent"
                >
                  ×
                </button>
              </div>
              {(c.before || c.after) && (
                <p className="text-[12px] leading-relaxed">
                  {c.before && <span className="text-ink-faint line-through">{c.before}</span>}
                  {c.before && c.after && <span className="mx-1.5 text-ink-faint">→</span>}
                  {c.after && <span className="text-ink">{c.after}</span>}
                </p>
              )}
              {c.reason && <p className="text-[11px] whitespace-pre-wrap text-ink-soft">{c.reason}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
