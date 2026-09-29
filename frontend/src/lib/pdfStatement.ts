import { askForJson } from "@/lib/aiJson";
import { parseAmount, type ColumnMapping, type ParsedCsv } from "@/lib/csvImport";

/**
 * Reading a card statement PDF.
 *
 * The PDF is handed to the owner's own model rather than parsed here.
 * Every issuer lays its statement out differently, text pulled out of a
 * multi-column PDF comes back interleaved, and a scanned statement has no
 * text layer at all — a parser for this would be a parser per issuer, and
 * still wrong on the one nobody wrote. The model reads the page the way a
 * person does.
 *
 * What it returns is turned into the same shape a CSV parses to, with
 * fixed column names, so everything after this — the preview, the
 * already-imported check, the categories, the write — is the CSV path
 * unchanged. Nothing is written until the owner has looked at the rows.
 */

const DATE = "利用日";
const AMOUNT = "利用金額";
const MEMO = "利用先";

/** The mapping a PDF's rows always come with. Not saved as a profile: it
 * would overwrite the CSV mapping of a card whose statements arrive both
 * ways. */
export const PDF_MAPPING: ColumnMapping = {
  dateColumn: DATE,
  amountColumn: AMOUNT,
  memoColumn: MEMO,
  amountIsNegativeForSpending: false,
};

/** Vercel refuses request bodies over 4.5 MB before the app sees them, and
 * the multipart wrapping takes a little of that. A monthly card statement
 * is a few hundred KB; this only turns away things that aren't one. */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

export interface PdfStatement extends ParsedCsv {
  /** The total the statement itself prints for the listed usage, when it
   * prints one. Compared against the rows so a skipped page or a misread
   * figure shows up before it's imported rather than in next month's
   * totals. */
  statedTotalYen: number | null;
  /** The rows added up, refunds included, on the same basis. */
  extractedTotalYen: number;
  /** The reply hit its length limit; the rows are the part that arrived. */
  truncated: boolean;
}

const SYSTEM_PROMPT = `あなたはクレジットカードの利用明細（PDF）から、利用の1行1行を正確に書き写す担当です。

書き写すもの:
- 明細に載っている利用の行をすべて。ページをまたいでいても、1行も飛ばさない。
- 返金・取消の行も含める。金額はマイナスで書く。
- 年会費・手数料・利息のように、この明細で請求される行も含める。

書き写さないもの:
- 合計行・小計行・前回請求額・お支払い額の案内・ポイントの案内など、利用の行ではないもの。

各行の書き方:
- date: 利用日を YYYY-MM-DD で。明細に年が書かれていなければ、締め日や請求月から年を決める（12月の利用が1月請求の明細に載ることに注意）。2桁の年（例: 26/09/15）は 2026年。
- amount: 利用金額（その買い物の金額）を円の整数で。分割払い・リボ払いの行でも、今回の支払額ではなく利用金額を書く。
- memo: 利用先（店名・サービス名）を明細の表記のまま。

statedTotalYen: 明細に「ご利用金額合計」のような、利用の行を合計した金額が印字されていればその数値。無ければ null。請求額（お支払い金額）は利用金額の合計と一致しないことがあるので、使わない。

読み取れない文字を推測で埋めないこと。金額や日付が読めない行は、読めた範囲で書いて memo の末尾に「（判読不可）」と付ける。

出力は次のJSONのみ。説明文・前置き・コードフェンスは書かない:
{
  "rows": [
    { "date": "2026-09-15", "amount": 1234, "memo": "セブン-イレブン" }
  ],
  "statedTotalYen": 123456
}`;

interface RawRow {
  date?: unknown;
  amount?: unknown;
  memo?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * Reads the statement. Throws AiJsonError on the AI's failures (no key
 * among them) — the caller turns those into messages.
 */
export async function readPdfStatement(ownerSub: string, filename: string, bytes: Uint8Array): Promise<PdfStatement> {
  const { value, truncated } = await askForJson(
    ownerSub,
    SYSTEM_PROMPT,
    "添付の利用明細から、利用の行をすべて書き写してください。",
    16000,
    { mimeType: "application/pdf", filename, base64: Buffer.from(bytes).toString("base64") },
  );
  return statementFromReply(value, truncated);
}

/**
 * The model's reply as CSV-shaped rows.
 *
 * Everything stays a string under the fixed column names and goes through
 * the CSV path's own date and amount parsers afterwards, so a row the model
 * got wrong shows up in the preview as unreadable instead of being trusted.
 * Pure, so it can be checked without a model on the other end.
 */
export function statementFromReply(value: unknown, truncated: boolean): PdfStatement {
  const parsed = (value ?? {}) as { rows?: unknown; statedTotalYen?: unknown };
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).map((raw) => {
    const row = (raw ?? {}) as RawRow;
    return { [DATE]: str(row.date), [AMOUNT]: str(row.amount), [MEMO]: str(row.memo) };
  });

  const stated =
    typeof parsed.statedTotalYen === "number" ? parsed.statedTotalYen : parseAmount(str(parsed.statedTotalYen));
  const extractedTotalYen = rows.reduce((sum, row) => sum + (parseAmount(row[AMOUNT]) ?? 0), 0);

  return {
    headers: [DATE, AMOUNT, MEMO],
    rows,
    statedTotalYen: stated === null || !Number.isFinite(stated) ? null : Math.round(stated),
    extractedTotalYen: Math.round(extractedTotalYen),
    truncated,
  };
}

/** Whether the bytes are a PDF at all — the extension and the MIME type
 * are whatever the browser guessed, and only the header is the file's own
 * word for it. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}
