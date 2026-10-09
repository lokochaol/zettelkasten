"use client";

import { useState } from "react";
import { replaceQuery } from "@/lib/viewState";
import { BulletJournalLegend } from "@/components/BulletJournalLegend";
import { MarkdownNoteEditor } from "@/components/MarkdownNoteEditor";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import { formatDateKey } from "@/lib/dateKey";
import { useUnsavedChanges } from "@/lib/unsavedChanges/UnsavedChangesProvider";
import type { DayStripEntry, ProjectTaskNoteView } from "@/lib/projectTaskNotes";
import { getProjectTaskNoteAction, upsertProjectTaskNoteAction } from "@/app/projects/actions";

function formatDayLabel(dateKey: string, locale: string) {
  return formatDateKey(dateKey, locale, { month: "numeric", day: "numeric" });
}

/** Day-strip + editable task-note for one Project — "プロジェクトタスク管理
 * メモは日にちを指定して編集" — tapping a day in the strip switches which
 * date's note the editor below shows/edits, all inline on the Project detail
 * page (no separate route per day). */
export function ProjectTaskSection({
  projectId,
  days,
  initialDate,
  initialNote,
}: {
  projectId: string;
  days: DayStripEntry[];
  initialDate: string;
  initialNote: ProjectTaskNoteView;
}) {
  const { t, locale } = useI18n();
  const { guard } = useUnsavedChanges();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [note, setNote] = useState(initialNote);
  const [loading, setLoading] = useState(false);

  function selectDay(date: string) {
    if (date === selectedDate) return;
    // Switching day remounts the editor (key={selectedDate}), so an unsaved
    // buffer would vanish — guard asks 保存 / 破棄 first.
    guard(async () => {
      setSelectedDate(date);
      replaceQuery({ date });
      setLoading(true);
      const result = await getProjectTaskNoteAction(projectId, date);
      setNote(result);
      setLoading(false);
    });
  }

  async function save(content: string) {
    await upsertProjectTaskNoteAction(projectId, selectedDate, content);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {days.map((day) => (
          <button
            key={day.date}
            onClick={() => selectDay(day.date)}
            className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-[10px] transition-colors ${
              day.date === selectedDate
                ? "bg-accent text-on-accent"
                : day.hasContent
                  ? "border border-accent/50 text-ink"
                  : "border border-line text-ink-soft"
            }`}
          >
            {formatDayLabel(day.date, localeTag(locale)).split("/")[1]}
          </button>
        ))}
      </div>

      <BulletJournalLegend />

      {loading ? (
        <p className="py-4 text-center font-mono text-xs text-ink-soft">{t.projects.detailLoading}</p>
      ) : (
        <MarkdownNoteEditor key={selectedDate} content={note.content} onSave={save} draftKey={`task:${projectId}:${selectedDate}`} />
      )}
    </div>
  );
}
