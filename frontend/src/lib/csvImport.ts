import { createHash } from "node:crypto";

/**
 * Reading a card or bank statement CSV.
 *
 * Pure — no Prisma — so the parsing can be tested directly and reused on
 * either side of the client/server line. Everything here is shaped by what
 * Japanese issuers actually send: Shift-JIS as often as UTF-8, a BOM when
 * it is UTF-8, quoted fields containing commas, a few preamble lines
 * before the real header, 和暦-free but slash-separated dates, amounts
 * with thousands separators and yen signs, and outgoings signed either way
 * depending on the issuer.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Splits one CSV line, honouring quoted fields and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Whether a row reads as data rather than as column names: headers are
 * words, data is dates and amounts. Keeps the header search from picking
 * the first transaction. */
function looksLikeData(cells: string[]): boolean {
  const filled = cells.filter((c) => c !== "");
  if (filled.length === 0) return false;
  const dataish = filled.filter((c) => parseStatementDate(c) !== null || parseAmount(c) !== null).length;
  return dataish * 2 >= filled.length;
}

/**
 * Finds the header row and reads the rest against it.
 *
 * The header is not always the first line: issuers put account names,
 * export dates and blank lines above it. Taking the row with the most
 * non-empty cells isn't enough on its own — a header with an empty column
 * ("日付,,金額") loses to the first transaction, which fills every cell.
 * So data-looking rows are excluded first, and only then does the widest
 * row win, earliest on a tie.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const searchDepth = Math.min(lines.length, 8);
  let headerIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < searchDepth; i++) {
    const cells = splitCsvLine(lines[i]);
    if (looksLikeData(cells)) continue;
    const score = cells.filter((c) => c !== "").length;
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
  }
  // Every candidate row was data — a file with no header at all. Fall
  // back to the widest row so the columns are at least addressable.
  if (bestScore === -1) {
    for (let i = 0; i < searchDepth; i++) {
      const score = splitCsvLine(lines[i]).filter((c) => c !== "").length;
      if (score > bestScore) {
        bestScore = score;
        headerIndex = i;
      }
    }
  }

  const rawHeaders = splitCsvLine(lines[headerIndex]);
  // Unnamed columns still need a key, and duplicates would shadow each
  // other — both happen in real exports.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `列${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line);
    if (cells.every((c) => c === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }
  return { headers, rows };
}

/** A calendar date out of whatever the issuer wrote. Deliberately narrow:
 * ambiguous day-first/month-first forms are refused rather than guessed,
 * because guessing wrong moves spending to another month silently. */
export function parseStatementDate(value: string): string | null {
  const text = value.trim();
  const m = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/.exec(text);
  if (!m) return null;
  const [, year, month, day] = m;
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}

/** An amount out of "¥1,234", "1234円", "-1,234", "(1,234)". Parentheses
 * are how some exports write a negative. */
export function parseAmount(value: string): number | null {
  let text = value.trim().replace(/[¥￥,，\s円]/g, "");
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  // Full-width digits and minus appear in exports from older systems.
  text = text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[−ー―‐]/g, "-");
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export interface ColumnMapping {
  dateColumn: string;
  amountColumn: string;
  memoColumn: string;
  amountIsNegativeForSpending: boolean;
}

/** First guess at the mapping, from the column names issuers tend to use.
 * Only a starting point — the owner confirms it before anything is
 * imported. */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const find = (patterns: RegExp[]) => headers.find((h) => patterns.some((p) => p.test(h)));
  return {
    dateColumn: find([/日付/, /利用日/, /ご利用日/, /取引日/, /date/i]),
    amountColumn: find([/金額/, /利用金額/, /ご利用金額/, /出金/, /支払/, /amount/i]),
    memoColumn: find([/店名/, /摘要/, /利用先/, /ご利用先/, /内容/, /description/i, /memo/i]),
  };
}

export interface MappedRow {
  dateKey: string;
  amountYen: number;
  memo: string;
  /** Stable across re-imports of an overlapping period, so the same
   * statement line is recognised rather than added twice. */
  externalKey: string;
  /** Why a row can't be imported, when it can't. */
  problem: string | null;
}

/**
 * Applies a mapping to the parsed rows.
 *
 * Rows that aren't spending are dropped rather than imported as negatives:
 * a statement holds refunds, payments to the card, and interest, and
 * treating those as expenses would quietly inflate every total.
 */
export function applyMapping(rows: Record<string, string>[], mapping: ColumnMapping, profileName: string): MappedRow[] {
  return rows.map((row) => {
    const dateKey = parseStatementDate(row[mapping.dateColumn] ?? "");
    const rawAmount = parseAmount(row[mapping.amountColumn] ?? "");
    const memo = (row[mapping.memoColumn] ?? "").trim();

    if (!dateKey) return blocked(`日付を読み取れません: "${row[mapping.dateColumn] ?? ""}"`, memo);
    if (rawAmount === null) return blocked(`金額を読み取れません: "${row[mapping.amountColumn] ?? ""}"`, memo, dateKey);

    const spending = mapping.amountIsNegativeForSpending ? -rawAmount : rawAmount;
    if (spending <= 0) return blocked("支出ではない行（返金・入金など）", memo, dateKey);

    const amountYen = Math.round(spending);
    return {
      dateKey,
      amountYen,
      memo,
      externalKey: fingerprint(profileName, dateKey, amountYen, memo),
      problem: null,
    };
  });
}

function blocked(problem: string, memo: string, dateKey = ""): MappedRow {
  return { dateKey, amountYen: 0, memo, externalKey: "", problem };
}

/** Identity of a statement line. Includes the profile so the same amount
 * on the same day from two different cards stays two expenses. */
export function fingerprint(profileName: string, dateKey: string, amountYen: number, memo: string): string {
  return createHash("sha256").update([profileName, dateKey, String(amountYen), memo].join("\u0000")).digest("hex").slice(0, 32);
}
