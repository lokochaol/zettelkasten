import { shiftDateKey } from "@/lib/dateKey";

/**
 * The earlier days a Health delivery can carry, so a missed morning fills
 * itself in.
 *
 * The Shortcut runs at a fixed time and asks Health for "today's" weight.
 * When the owner weighs in later, or the scale's own app only writes to
 * Health once it's opened, that run finds nothing — and the next morning's
 * run asks only about its own day, so the gap stays. So alongside the day's
 * figures the Shortcut can send the last week of samples, each with its
 * own date, and the days still empty are filled from them.
 *
 * Pure: the route parses, src/lib/health.ts writes.
 *
 * Two shapes, because of what Shortcuts can build without a fight:
 *
 *   "history": [{ "date": "2026-10-21", "weightKg": 68.4, "bodyFatPercent": 14.2 }]
 *
 * or one text per measure, a line per sample, as a "Repeat with Each" that
 * appends "date value" to a text variable produces:
 *
 *   "weightHistory": "2026-10-21 07:12 68.4\n2026-10-22 06:58 68.1"
 *   "bodyFatHistory": "2026-10-21 0.142\n…"
 */

export interface HistoryRow {
  dateKey: string;
  weightKg?: number;
  bodyFatPercent?: number;
  leanBodyMassKg?: number;
}

/** How far back a delivery may fill: a month covers a phone left at home on holiday. */
export const HISTORY_DAYS = 31;

const DATE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/;
const pad = (n: string) => n.padStart(2, "0");

export function toNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  // "68.4 kg", "9,210" — the unit and the thousands separator aren't the number.
  const text = String(v).replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!/\d/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Health stores body fat as a fraction (0.142); some scales' apps write 14.2. */
export function toBodyFatPercent(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return v > 0 && v < 1 ? v * 100 : v;
}

function dateKeyOf(v: unknown): string | null {
  const m = DATE.exec(String(v ?? ""));
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
}

/** "2026-10-21 07:12 68.4 kg" → ["2026-10-21", 68.4]. The time, when there is one, is not the value. */
function parseLine(line: string): [string, number] | null {
  const m = DATE.exec(line);
  if (!m) return null;
  const rest = line.slice(m.index + m[0].length).replace(/^[T\s]*\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?/i, "");
  const value = /-?\d+(?:\.\d+)?/.exec(rest.replace(/,/g, "."));
  if (!value) return null;
  const n = Number(value[0]);
  return Number.isFinite(n) ? [`${m[1]}-${pad(m[2])}-${pad(m[3])}`, n] : null;
}

function lines(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => lines(x));
  if (typeof v === "string") return v.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return [`${o.date ?? ""} ${o.value ?? o.kg ?? ""}`];
  }
  return [];
}

const sane = {
  weightKg: (n: number) => n >= 20 && n <= 300,
  bodyFatPercent: (n: number) => n >= 2 && n <= 70,
  leanBodyMassKg: (n: number) => n >= 10 && n <= 200,
};

/**
 * The history in a delivery, one row per day, within the month before the
 * day it's for. Several samples on one day: the first one listed wins, so a
 * Shortcut that sorts oldest first keeps the morning reading.
 */
export function parseHistory(payload: Record<string, unknown>, dateKey: string): HistoryRow[] {
  const from = shiftDateKey(dateKey, -HISTORY_DAYS);
  const byDay = new Map<string, HistoryRow>();
  const put = (day: string | null, field: keyof typeof sane, value: number | undefined) => {
    if (!day || value === undefined || day < from || day > dateKey) return;
    const v = field === "bodyFatPercent" ? toBodyFatPercent(value)! : value;
    if (!sane[field](v)) return;
    const row = byDay.get(day) ?? { dateKey: day };
    if (row[field] === undefined) row[field] = Math.round(v * 100) / 100;
    byDay.set(day, row);
  };

  for (const h of Array.isArray(payload.history) ? payload.history : []) {
    const o = (h ?? {}) as Record<string, unknown>;
    const day = dateKeyOf(o.date);
    put(day, "weightKg", toNumber(o.weightKg));
    put(day, "bodyFatPercent", toNumber(o.bodyFatPercent));
    put(day, "leanBodyMassKg", toNumber(o.leanBodyMassKg));
  }
  const texts: [unknown, keyof typeof sane][] = [
    [payload.weightHistory, "weightKg"],
    [payload.bodyFatHistory, "bodyFatPercent"],
    [payload.leanBodyMassHistory, "leanBodyMassKg"],
  ];
  for (const [text, field] of texts) {
    for (const line of lines(text)) {
      const parsed = parseLine(line);
      if (parsed) put(parsed[0], field, parsed[1]);
    }
  }
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** What one delivery carried, kept on the token for the settings screen. */
export interface IngestReceipt {
  at: string;
  dateKey: string;
  /** Which of the day's fields came with a value. */
  fields: string[];
  /** Earlier days that got a figure they didn't have. */
  filled: string[];
  /** How many days of history came with it. */
  historyDays: number;
}

export function toReceipt(value: unknown): IngestReceipt | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.at !== "string" || typeof o.dateKey !== "string") return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { at: o.at, dateKey: o.dateKey, fields: strings(o.fields), filled: strings(o.filled), historyDays: Number(o.historyDays) || 0 };
}
