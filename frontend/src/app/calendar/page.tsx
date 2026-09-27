import Link from "next/link";
import { requireSession } from "@/lib/session";
import * as projectTaskNotes from "@/lib/projectTaskNotes";
import { CalendarViewSwitch } from "@/components/CalendarViewSwitch";
import { CalendarMonthNav } from "@/components/CalendarMonthNav";
import { CalendarTodayView } from "@/components/CalendarTodayView";
import { CalendarTodaySection } from "@/components/CalendarTodaySection";
import { CalendarTimelineSection } from "@/components/CalendarTimelineSection";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderAccountBadge } from "@/components/HeaderAccountBadge";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, localeTag } from "@/lib/i18n/dictionary";
import { formatDateKey } from "@/lib/dateKey";
import { getTodayKey } from "@/lib/preferences/preferences";

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const ownerSub = session.ownerSub;
  const locale = await getLocale();
  const dict = getDictionary(locale);

  const topView: "today" | "timeline" = searchParams.view === "timeline" ? "timeline" : "today";
  const selectedDate = searchParams.view === "day" && typeof searchParams.date === "string" ? searchParams.date : null;
  const todayKey = await getTodayKey();
  const today = new Date(`${todayKey}T00:00:00.000Z`);

  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  const requestedYear = Number(searchParams.year);
  const requestedMonth = Number(searchParams.month);
  const isValidRequestedMonth =
    Number.isInteger(requestedYear) && Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12;
  let viewedYear = isValidRequestedMonth ? requestedYear : currentYear;
  let viewedMonth = isValidRequestedMonth ? requestedMonth : currentMonth;
  // Clamp to the current month rather than trust an arbitrary future ?year=/?month= —
  // a project can't have notes ahead of today.
  if (viewedYear > currentYear || (viewedYear === currentYear && viewedMonth > currentMonth)) {
    viewedYear = currentYear;
    viewedMonth = currentMonth;
  }
  const isCurrentViewedMonth = viewedYear === currentYear && viewedMonth === currentMonth;
  const monthLabel = new Date(Date.UTC(viewedYear, viewedMonth - 1, 1)).toLocaleDateString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    timeZone: "UTC",
  });

  const todayNotes =
    !selectedDate && topView === "today" ? await projectTaskNotes.listAllProjectsTodayNotes(ownerSub, todayKey) : [];
  const timelineMarks =
    !selectedDate && topView === "timeline"
      ? await projectTaskNotes.listTimelineMarks(ownerSub, viewedYear, viewedMonth, todayKey)
      : [];
  const selectedDayNotes = selectedDate ? await projectTaskNotes.listAllProjectsTodayNotes(ownerSub, selectedDate) : [];
  const selectedDayLabel = selectedDate ? formatDateKey(selectedDate, localeTag(locale)) : "";

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <div className="flex w-full flex-col gap-8">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/scratch"
            className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
          >
            <span className="text-accent">&lt;</span> {dict.calendar.backToScratch}
          </Link>
          <HeaderMenu>
            <div className="flex w-full flex-col items-end gap-1.5 border-b border-line pb-2.5">
              <HeaderAccountBadge email={session.user?.email ?? dict.common.unknownEmail} />
              <Link href="/settings" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
                {dict.nav.settingsLabel}
              </Link>
            </div>
            <Link href="/projects" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.projectsLabel}
            </Link>
            <Link href="/literature" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.literatureLabel}
            </Link>
            <Link href="/guide" className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent">
              {dict.nav.guideLabel}
            </Link>
          </HeaderMenu>
        </div>

        {selectedDate ? (
          <>
            <div className="flex items-center gap-3">
              <Link
                href={`/calendar?view=timeline&year=${viewedYear}&month=${viewedMonth}`}
                className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-accent"
              >
                <span className="text-accent">&lt;</span> {dict.calendar.viewTimeline}
              </Link>
              <h1 className="text-lg font-extrabold tracking-tight text-ink">{selectedDayLabel}</h1>
            </div>
            <CalendarTodayView key={selectedDate} dateKey={selectedDate} initialNotes={selectedDayNotes} />
          </>
        ) : topView === "today" ? (
          <CalendarTodaySection
            initialNotes={todayNotes}
            initialNotesDateKey={todayKey}
            headerRight={<CalendarViewSwitch view={topView} />}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <CalendarMonthNav year={viewedYear} month={viewedMonth} isCurrentMonth={isCurrentViewedMonth}>
                <h1 className="text-lg font-extrabold tracking-tight text-ink">{monthLabel}</h1>
              </CalendarMonthNav>
              <CalendarViewSwitch view={topView} />
            </div>

            <CalendarTimelineSection marks={timelineMarks} year={viewedYear} month={viewedMonth} todayKey={todayKey} />
          </>
        )}
      </div>
    </main>
  );
}
