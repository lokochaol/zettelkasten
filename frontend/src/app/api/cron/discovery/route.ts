import { NextResponse, type NextRequest } from "next/server";
import * as discovery from "@/lib/discovery";

/**
 * The scheduled half of the "Discovery Rails" batch — see
 * frontend/vercel.json, and DiscoveryTriggerButton for the manual,
 * single-owner, schedule-ignoring equivalent.
 *
 * vercel.json registers 24 separate cron jobs hitting this same path, one
 * per Asia/Tokyo hour (0 15 * * *, 0 16 * * *, … each in UTC) — NOT a
 * single hourly cron. Vercel's Hobby plan caps each individual cron job at
 * once per day ("0 * * * *" fails deployment outright), so 24
 * once-a-day jobs at staggered hours is what actually delivers "checked
 * every hour" within that limit (well under the separate 100-cron-job cap).
 * Each invocation still just checks the current Tokyo hour against every
 * owner's own DiscoverySchedule (1 or 2 times a day, at whichever hour(s)
 * they picked in Settings — src/lib/discovery.ts's
 * getSchedule/isDueAtHour) and only runs discovery for the ones due *this*
 * hour, so this route's own logic doesn't need to know it's being fanned
 * out across 24 registrations instead of one.
 *
 * There is no browser session here (Vercel Cron calls this server-to-server),
 * so this can't use requireOwnerSub() — instead it's gated by CRON_SECRET, the
 * shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`
 * when that env var is set. Without CRON_SECRET configured this always
 * rejects, rather than running unauthenticated for every tenant.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hour = discovery.tokyoHour(new Date());
  const owners = await discovery.listOwnersWithDiscoveryEnabledNotes();

  let ownersRun = 0;
  let notesChecked = 0;
  let candidatesFound = 0;
  for (const ownerSub of owners) {
    const schedule = await discovery.getSchedule(ownerSub);
    if (!discovery.isDueAtHour(schedule, hour)) continue;

    ownersRun++;
    const result = await discovery.runForEnabledNotes(ownerSub);
    notesChecked += result.notesChecked;
    candidatesFound += result.candidatesFound;
  }

  return NextResponse.json({ hour, owners: owners.length, ownersRun, notesChecked, candidatesFound });
}
