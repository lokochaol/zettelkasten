"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Switches /calendar between ③今日 and ④横向きタイムライン via the `view`
 * query param — a plain router.replace, not a client-only toggle, so the
 * chosen view survives a reload/share the way the wireframe's two screens do. */
export function CalendarViewSwitch({ view }: { view: "today" | "timeline" }) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 gap-1.5 rounded-full border border-line-strong bg-surface p-1">
      {(["today", "timeline"] as const).map((v) => (
        <button
          key={v}
          onClick={() => router.push(`/calendar?view=${v}`)}
          className={`rounded-full px-3 py-1.5 font-mono whitespace-nowrap text-[10.5px] transition-colors ${
            view === v ? "bg-accent text-on-accent" : "text-ink-soft hover:text-accent"
          }`}
        >
          {v === "today" ? t.calendar.viewToday : t.calendar.viewTimeline}
        </button>
      ))}
    </div>
  );
}
