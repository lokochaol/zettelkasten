"use client";

import { LiteratureMemoField } from "@/components/LiteratureMemoField";
import { setLiteratureMemoAction } from "@/app/dash-off/actions";
import { updateLiteratureMemoSummaryAction } from "@/app/literature/actions";
import type { LiteratureMemoRef, LiteratureSelection } from "@/lib/literatureMemos";

export function QuickNoteLiteratureSection({ noteId, literatureMemo }: { noteId: string; literatureMemo: LiteratureMemoRef | null }) {
  return (
    <LiteratureMemoField
      linked={literatureMemo}
      onPick={async (selection: LiteratureSelection) => {
        const note = await setLiteratureMemoAction(noteId, selection);
        return { literatureMemo: note.literatureMemo };
      }}
      onSaveSummary={async (memoId, summary) => {
        await updateLiteratureMemoSummaryAction(memoId, summary);
      }}
    />
  );
}
