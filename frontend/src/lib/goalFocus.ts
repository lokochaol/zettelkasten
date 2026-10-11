/**
 * Which goals a day is for — pure, so the goals page can mark the period
 * that covers today with the same rule the calendar uses to pick it.
 */

export type DayKind = "weekday" | "holiday";

/** Saturday and Sunday. National holidays aren't known to the app, so a
 * public holiday reads as a weekday — the 休日 list is a tap away. */
export function dayKindOf(dateKey: string): DayKind {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6 ? "holiday" : "weekday";
}

/** The period that covers the day. Of several, a bounded one beats an
 * open-ended one (the "7/1まで" over a catch-all), then the owner's order. */
export function periodFor<P extends { fromDateKey: string | null; toDateKey: string | null }>(periods: P[], dateKey: string): P | null {
  const covering = periods.filter(
    (p) => (!p.fromDateKey || p.fromDateKey <= dateKey) && (!p.toDateKey || p.toDateKey >= dateKey),
  );
  const bounds = (p: P) => (p.fromDateKey ? 1 : 0) + (p.toDateKey ? 1 : 0);
  return [...covering].sort((a, b) => bounds(b) - bounds(a))[0] ?? null;
}

/** The horizons offered when adding a step — the ones the owner's own page
 * uses. Free text otherwise. */
export const HORIZON_PRESETS = ["~2週間後", "~2ヶ月以内", "1年後", "2年後", "3年後", "毎日の活動"];

/**
 * The date a relative horizon lands on, counted from `baseKey` (the goal's
 * review date): "~2週間後" → +14 days, "~2ヶ月以内" → +2 months, "1年後" →
 * +1 year. Null for a label with no amount of time in it ("毎日の活動").
 * A month or year step that lands past the end of a month (1/31 + 1 month)
 * settles on that month's last day.
 */
export function horizonDateKey(label: string, baseKey: string): string | null {
  const text = label.normalize("NFKC");
  const m = /(\d+)\s*(日|週間|週|ヶ月|か月|カ月|ケ月|月|年)/.exec(text) ?? /(\d+)\s*(days?|weeks?|months?|years?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const [y, mo, d] = baseKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d));
  if (unit === "日" || unit.startsWith("day")) base.setUTCDate(base.getUTCDate() + n);
  else if (unit.startsWith("週") || unit.startsWith("week")) base.setUTCDate(base.getUTCDate() + 7 * n);
  else {
    const months = unit === "年" || unit.startsWith("year") ? 12 * n : n;
    const target = new Date(Date.UTC(y, mo - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target.toISOString().slice(0, 10);
  }
  return base.toISOString().slice(0, 10);
}
