import { prisma } from "@/lib/db";
import { DiscoveryKind, DiscoveryStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/errors";
import * as quickNotes from "@/lib/quickNotes";
import type { QuickNoteDetail } from "@/lib/quickNotes";
import * as aiCredentials from "@/lib/aiCredentials";
import { AiProvider } from "@/lib/aiCredentials";

export interface DiscoveryCandidateSummary {
  id: string;
  quickNoteId: string;
  kind: DiscoveryKind;
  status: DiscoveryStatus;
  title: string;
  summary: string;
  sourceLabel: string;
  url: string | null;
  confidence: number;
  literatureMemoId: string | null;
}

interface DiscoveryCandidateRow {
  id: string;
  quickNoteId: string;
  kind: DiscoveryKind;
  status: DiscoveryStatus;
  title: string;
  summary: string;
  sourceLabel: string;
  url: string | null;
  confidence: number;
  literatureMemoId: string | null;
}

function toSummary(row: DiscoveryCandidateRow): DiscoveryCandidateSummary {
  return {
    id: row.id,
    quickNoteId: row.quickNoteId,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    sourceLabel: row.sourceLabel,
    url: row.url,
    confidence: row.confidence,
    literatureMemoId: row.literatureMemoId,
  };
}

/** All candidates for a set of active QuickNotes, grouped by quickNoteId —
 * highest-confidence first, so a shelf's horizontal scroll leads with its
 * best matches. */
export async function listForQuickNotes(
  ownerSub: string,
  quickNoteIds: string[],
): Promise<Record<string, DiscoveryCandidateSummary[]>> {
  if (quickNoteIds.length === 0) return {};
  const rows = await prisma.discoveryCandidate.findMany({
    where: { ownerSub, quickNoteId: { in: quickNoteIds } },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  });
  const byNote: Record<string, DiscoveryCandidateSummary[]> = {};
  for (const row of rows) {
    (byNote[row.quickNoteId] ??= []).push(toSummary(row));
  }
  return byNote;
}

async function requireOwnedCandidate(ownerSub: string, id: string) {
  const candidate = await prisma.discoveryCandidate.findFirst({ where: { id, ownerSub } });
  if (!candidate) throw new NotFoundError("discoveryCandidateNotFound", `DiscoveryCandidate not found: ${id}`);
  return candidate;
}

export interface DiscoveryFinding {
  kind: DiscoveryKind;
  title: string;
  summary: string;
  sourceLabel: string;
  url: string | null;
  /** 0-100 — the app never re-judges this once found; it's shown as-is next
   * to the "AI候補" badge until the owner confirms it (see resolveLiteratureForCandidate). */
  confidence: number;
}

export type DiscoveryErrorCode = "authError" | "rateLimitError" | "apiError" | "unknownError";

/** Thrown by a provider call when the request itself failed outright (bad
 * key, rate limit, etc.) — as opposed to succeeding but finding nothing,
 * which just resolves to []. runForActiveNotes catches this to record a
 * DiscoveryRunStatus the /scratch page can surface as a banner. */
export class DiscoveryProviderError extends Error {
  code: DiscoveryErrorCode;
  status: number | null;

  constructor(code: DiscoveryErrorCode, status: number | null, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function errorCodeForStatus(status: number): DiscoveryErrorCode {
  if (status === 401 || status === 403) return "authError";
  if (status === 429) return "rateLimitError";
  return "apiError";
}

// Cheapest current-gen model per provider — this task is "search +
// summarize + score", not deep reasoning, and it runs unattended across
// every active note, on the *owner's own* API key.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_MODEL = "gpt-5-mini";
const GOOGLE_MODEL = "gemini-2.5-flash";
// Capped per note (not just per run) since a web-search tool call is
// typically billed per search performed — this bounds worst-case spend for
// one note regardless of how much the model might otherwise want to search.
const MAX_SEARCHES_PER_NOTE = 2;
// Every active note is eligible for a periodic refresh (see
// runForActiveNotes) — this caps how many the least-recently-run rotation
// will refresh in one run, so a large note count trickles across runs
// instead of spiking one run's cost.
const MAX_NOTES_PER_RUN = 15;
const MIN_REFRESH_INTERVAL_HOURS = 12;

const DISCOVERY_SYSTEM_PROMPT = `あなたはユーザーの走り書きメモを読み、関連しそうな最新ニュースと文献（書籍・論文など）をWeb検索で探すアシスタントです。

手順:
1. 与えられたメモの内容を理解する。
2. Web検索ツールを使って、内容に関連する最新ニュースを最大3件、関連する文献（書籍・論文など）を最大3件探す。
3. 実在するURLが確認できたものだけ url に入れる。確認できなければ null にする。
4. メモとの関連度を0〜100の整数で見積もる（確信が持てない場合は低めに見積もる）。
5. 何も見つからなければ無理に候補を作らない。

出力は次のJSON配列のみ。説明文・前置き・コードフェンスは一切書かないこと（kindは"NEWS"か"LITERATURE"のどちらか、urlは実在URLの文字列かnull）:
[{"kind":"NEWS","title":"...","summary":"（1〜2文の要約、メモと同じ言語で）","sourceLabel":"（媒体名と相対時刻、または書籍/論文などの種別や著者・年）","url":"https://...またはnull","confidence":0から100の整数}]

関連するものが見つからない場合は空配列 [] を出力する。`;

function normalizeFinding(item: Record<string, unknown>): DiscoveryFinding | null {
  const kind =
    item.kind === "NEWS" ? DiscoveryKind.NEWS : item.kind === "LITERATURE" ? DiscoveryKind.LITERATURE : null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!kind || !title) return null;

  const summary = typeof item.summary === "string" ? item.summary.trim() : "";
  const sourceLabel = typeof item.sourceLabel === "string" ? item.sourceLabel.trim() : "";
  const url = typeof item.url === "string" && item.url.trim() ? item.url.trim() : null;
  const confidenceRaw = typeof item.confidence === "number" ? item.confidence : Number(item.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, Math.round(confidenceRaw))) : 50;

  return { kind, title, summary, sourceLabel, url, confidence };
}

/** Shared across all three providers: extract the first JSON array literal
 * from the model's final text output and turn it into findings. Never
 * throws — malformed output just yields no findings. */
function parseFindings(text: string | undefined | null): DiscoveryFinding[] {
  if (!text) return [];
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map(normalizeFinding)
      .filter((f): f is DiscoveryFinding => f !== null)
      .slice(0, 6);
  } catch {
    return [];
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

/**
 * Calls the Anthropic Messages API with the server-side web_search tool —
 * one call does "search the web for what's relevant, then summarize and
 * score it" in one shot; Anthropic runs the search loop server-side, so this
 * is a single request, not a client-managed tool loop.
 */
async function findViaAnthropic(apiKey: string, noteText: string): Promise<DiscoveryFinding[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES_PER_NOTE }],
      system: DISCOVERY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: noteText }],
    }),
  });
  if (!res.ok) {
    throw new DiscoveryProviderError(errorCodeForStatus(res.status), res.status, `Anthropic API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const textBlocks = (data.content ?? []).filter((b) => b.type === "text" && b.text);
  return parseFindings(textBlocks[textBlocks.length - 1]?.text);
}

interface OpenAiOutputItem {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Calls OpenAI's Responses API with its built-in web_search tool — same
 * "one request, server-side search loop" shape as Anthropic's. NOTE: tool
 * and model names on OpenAI's side move fast; verify `web_search` and
 * `gpt-5-mini` are still current in OpenAI's docs before relying on this —
 * this was written against the API shape known at implementation time and
 * hasn't been exercised against a live key in this environment.
 */
async function findViaOpenAi(apiKey: string, noteText: string): Promise<DiscoveryFinding[]> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
        { role: "user", content: noteText },
      ],
      tools: [{ type: "web_search" }],
    }),
  });
  if (!res.ok) {
    throw new DiscoveryProviderError(errorCodeForStatus(res.status), res.status, `OpenAI API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { output?: OpenAiOutputItem[] };
  const messages = (data.output ?? []).filter((o) => o.type === "message");
  const lastMessage = messages[messages.length - 1];
  const textPart = lastMessage?.content?.find((c) => c.type === "output_text" || c.type === "text");
  return parseFindings(textPart?.text);
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}

/**
 * Calls Google's Gemini API with Grounding with Google Search. NOTE: same
 * caveat as findViaOpenAi — Gemini's grounding tool shape has changed before
 * (`googleSearchRetrieval` → `googleSearch`); verify against current Gemini
 * docs if this stops finding anything.
 */
async function findViaGoogle(apiKey: string, noteText: string): Promise<DiscoveryFinding[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DISCOVERY_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: noteText }] }],
        tools: [{ googleSearch: {} }],
      }),
    },
  );
  if (!res.ok) {
    throw new DiscoveryProviderError(errorCodeForStatus(res.status), res.status, `Gemini API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { candidates?: GeminiCandidate[] };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("\n");
  return parseFindings(text);
}

/**
 * Dispatches to whichever provider the owner configured in Settings (see
 * AiSettingsForm / aiCredentials.ts) — there is no app-wide default key. No
 * credential configured resolves to no findings (that's a normal,
 * unconfigured state, not an error). A request that fails outright throws
 * DiscoveryProviderError — runForActiveNotes is what catches that and
 * records it as a DiscoveryRunStatus for the /scratch banner; unparseable
 * output still just yields no findings (see parseFindings).
 */
export async function findCandidatesForNote(ownerSub: string, noteText: string): Promise<DiscoveryFinding[]> {
  const credential = await aiCredentials.get(ownerSub);
  if (!credential) return [];

  const text = noteText.slice(0, 2000);
  switch (credential.provider) {
    case AiProvider.ANTHROPIC:
      return findViaAnthropic(credential.apiKey, text);
    case AiProvider.OPENAI:
      return findViaOpenAi(credential.apiKey, text);
    case AiProvider.GOOGLE:
      return findViaGoogle(credential.apiKey, text);
    default:
      return [];
  }
}

/** Refreshes discovery for one note: replaces all of its stored candidates
 * (CONFIRMED ones included) with a fresh search. Confirming a candidate
 * already produced its own independent, permanent record — a LiteratureMemo
 * row, and for "このメモを書く" a new QuickNote too — so the
 * DiscoveryCandidate row itself is just a "this was surfaced" sighting, safe
 * to replace on every refresh without losing anything the owner acted on.
 * Stamps discoveryLastRunAt regardless of whether anything was found, so the
 * least-recently-run rotation in runForActiveNotes doesn't get stuck
 * re-picking a barren note ahead of others. Returns the number of fresh
 * candidates stored. */
export async function runForQuickNote(ownerSub: string, quickNoteId: string): Promise<number> {
  const note = await quickNotes.getDetail(ownerSub, quickNoteId);
  const text = note.content.trim();

  const findings = text ? await findCandidatesForNote(ownerSub, text) : [];

  await prisma.$transaction([
    prisma.discoveryCandidate.deleteMany({ where: { quickNoteId } }),
    ...(findings.length > 0
      ? [
          prisma.discoveryCandidate.createMany({
            data: findings.map((f) => ({
              ownerSub,
              quickNoteId,
              kind: f.kind,
              title: f.title,
              summary: f.summary,
              sourceLabel: f.sourceLabel,
              url: f.url,
              confidence: f.confidence,
            })),
          }),
        ]
      : []),
    prisma.quickNote.update({ where: { id: quickNoteId }, data: { discoveryLastRunAt: new Date() } }),
  ]);

  return findings.length;
}

export interface DiscoveryRunStatusSummary {
  lastRunAt: Date;
  lastErrorCode: DiscoveryErrorCode | null;
  lastErrorStatus: number | null;
  lastErrorAt: Date | null;
}

/** For the /scratch banner — null means "never run yet" (e.g. no AI
 * provider has ever been configured, or no discovery run has fired). */
export async function getRunStatus(ownerSub: string): Promise<DiscoveryRunStatusSummary | null> {
  const row = await prisma.discoveryRunStatus.findUnique({ where: { ownerSub } });
  if (!row) return null;
  return {
    lastRunAt: row.lastRunAt,
    lastErrorCode: row.lastErrorCode as DiscoveryErrorCode | null,
    lastErrorStatus: row.lastErrorStatus,
    lastErrorAt: row.lastErrorAt,
  };
}

async function recordRunStatus(
  ownerSub: string,
  error: { code: DiscoveryErrorCode; status: number | null } | null,
): Promise<void> {
  const now = new Date();
  await prisma.discoveryRunStatus.upsert({
    where: { ownerSub },
    create: {
      ownerSub,
      lastRunAt: now,
      lastErrorCode: error?.code ?? null,
      lastErrorStatus: error?.status ?? null,
      lastErrorAt: error ? now : null,
    },
    update: {
      lastRunAt: now,
      lastErrorCode: error?.code ?? null,
      lastErrorStatus: error?.status ?? null,
      lastErrorAt: error ? now : null,
    },
  });
}

/** Runs discovery across an owner's active QuickNotes — what both the
 * manual "今すぐ探す" trigger and the (schedule-gated) cron call. Every
 * active note is eligible for a refresh every time this runs — a note is
 * never "done forever"; each note's own DiscoverySchedule (1 or 2 times a
 * day, at whichever Asia/Tokyo hour(s) the owner picked) governs how often
 * the cron actually reaches it (see isDueAtHour), while this function
 * itself just refreshes whatever it's given. Only the least-recently-run
 * notes are picked, up to MAX_NOTES_PER_RUN, so a large note count trickles
 * across runs — with two runs a day, everything still cycles through
 * eventually — instead of one run's cost spiking with the note count.
 *
 * Notes refreshed within the last MIN_REFRESH_INTERVAL_HOURS are skipped by
 * default — this is what keeps repeated manual "今すぐ探す" clicks from
 * re-spending API calls on a note that was just checked. `force: true`
 * (the manual trigger, after the owner explicitly confirms the token-spend
 * warning — see DiscoveryConfirmDialog) skips that check entirely; the
 * scheduled cron never passes it, so it always respects the cooldown.
 *
 * If a provider call fails outright (bad key, rate limit, etc.), that's
 * recorded via recordRunStatus and this stops attempting further notes in
 * the same run — one broken credential would otherwise fail identically on
 * every remaining note, burning quota for nothing. A run that completes
 * without any note failing clears any previously recorded error. */
/**
 * Runs discovery over the notes the owner picked for it, not over every
 * active note. Opting in per note is the whole point of the 探索 tab: the
 * search spends the owner's own API credits, and most scraps are never
 * worth spending them on.
 */
export async function runForEnabledNotes(
  ownerSub: string,
  options?: { force?: boolean },
): Promise<{ notesChecked: number; candidatesFound: number }> {
  const refreshCutoff = new Date(Date.now() - MIN_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000);
  const candidateNotes = await prisma.quickNote.findMany({
    where: {
      ownerSub,
      status: "ACTIVE",
      discoveryEnabled: true,
      ...(options?.force ? {} : { OR: [{ discoveryLastRunAt: null }, { discoveryLastRunAt: { lt: refreshCutoff } }] }),
    },
    select: { id: true },
    orderBy: [{ discoveryLastRunAt: { sort: "asc", nulls: "first" } }, { encounteredAt: "asc" }],
    take: MAX_NOTES_PER_RUN,
  });
  if (candidateNotes.length === 0) return { notesChecked: 0, candidatesFound: 0 };

  let candidatesFound = 0;
  let notesChecked = 0;
  for (const note of candidateNotes) {
    try {
      candidatesFound += await runForQuickNote(ownerSub, note.id);
      notesChecked++;
    } catch (e) {
      const error =
        e instanceof DiscoveryProviderError ? { code: e.code, status: e.status } : { code: "unknownError" as const, status: null };
      await recordRunStatus(ownerSub, error);
      return { notesChecked, candidatesFound };
    }
  }

  await recordRunStatus(ownerSub, null);
  return { notesChecked, candidatesFound };
}

/** Every owner who has switched discovery on for at least one note — the
 * cron route fans runForEnabledNotes out across all tenants with this.
 * Owners who never opted a note in are skipped entirely rather than
 * queried and found empty. */
export async function listOwnersWithDiscoveryEnabledNotes(): Promise<string[]> {
  const rows = await prisma.quickNote.findMany({
    where: { status: "ACTIVE", discoveryEnabled: true },
    distinct: ["ownerSub"],
    select: { ownerSub: true },
  });
  return rows.map((r) => r.ownerSub);
}

export interface DiscoverySchedule {
  /** 0 = never on a schedule. Manual runs still work. */
  timesPerDay: 0 | 1 | 2;
  hour1: number;
  hour2: number;
}

/** Off by default. A background job that spends the owner's own API
 * credits is something they should switch on, not something they discover
 * running. */
const DEFAULT_SCHEDULE: DiscoverySchedule = { timesPerDay: 0, hour1: 7, hour2: 19 };

export async function getSchedule(ownerSub: string): Promise<DiscoverySchedule> {
  const row = await prisma.discoverySchedule.findUnique({ where: { ownerSub } });
  if (!row) return DEFAULT_SCHEDULE;
  return { timesPerDay: clampTimes(row.timesPerDay), hour1: row.hour1, hour2: row.hour2 };
}

function clampTimes(value: number): 0 | 1 | 2 {
  return value === 1 ? 1 : value === 2 ? 2 : 0;
}

export async function saveSchedule(ownerSub: string, input: DiscoverySchedule): Promise<void> {
  const timesPerDay = clampTimes(input.timesPerDay);
  const hour1 = Math.min(23, Math.max(0, Math.round(input.hour1)));
  const hour2 = Math.min(23, Math.max(0, Math.round(input.hour2)));
  await prisma.discoverySchedule.upsert({
    where: { ownerSub },
    create: { ownerSub, timesPerDay, hour1, hour2 },
    update: { timesPerDay, hour1, hour2 },
  });
}

/** The Asia/Tokyo local hour (0-23) for a given instant — the schedule is
 * always expressed in that timezone, matching how this feature was
 * originally specified (7:00/19:00 JST), regardless of the owner's locale
 * setting or where the server itself runs. */
export function tokyoHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false }).format(at),
  );
}

/** Whether `schedule` is due at the given hour — what the cron route (see
 * src/app/api/cron/discovery) uses to decide whether to actually run
 * discovery for one owner this pass. The manual "今すぐ探す" trigger never
 * calls this; it always runs immediately regardless of schedule. */
export function isDueAtHour(schedule: DiscoverySchedule, hour: number): boolean {
  if (schedule.timesPerDay === 0) return false;
  return hour === schedule.hour1 || (schedule.timesPerDay === 2 && hour === schedule.hour2);
}

/**
 * Finds-or-creates the LiteratureMemo behind a candidate, keyed by URL —
 * candidates never carry a zoteroKey, so this is the dedup key instead. The
 * same article surfacing again (a later batch, or from a different note)
 * reuses the existing memo rather than creating a duplicate. Citation/url
 * can be edited by the owner before this runs (the shelf's detail view
 * pre-fills them from the candidate but lets them be corrected first).
 * Flips the candidate to CONFIRMED — this is the only thing that does.
 */
export async function resolveLiteratureForCandidate(
  ownerSub: string,
  candidateId: string,
  overrides: { citation: string; url: string | null },
): Promise<string> {
  const candidate = await requireOwnedCandidate(ownerSub, candidateId);
  if (candidate.literatureMemoId) return candidate.literatureMemoId;

  const citation = overrides.citation.trim() || candidate.title;
  const url = overrides.url?.trim() || null;

  const existing = url ? await prisma.literatureMemo.findFirst({ where: { ownerSub, url } }) : null;
  const literatureMemoId = existing
    ? existing.id
    : (await prisma.literatureMemo.create({ data: { ownerSub, zoteroKey: null, citation, url, summary: null } })).id;

  await prisma.discoveryCandidate.update({
    where: { id: candidateId },
    data: { literatureMemoId, status: "CONFIRMED" },
  });

  return literatureMemoId;
}

/** Creates a new QuickNote already linked to the candidate's (resolved)
 * literature memo, and lands it on the real /scratch/[id] editor — the
 * literature link needs that page's dedicated section, so unlike
 * NewQuickNoteOverlay's compose-then-save flow, this one still
 * creates first and navigates to edit. */
export async function writeNoteFromCandidate(
  ownerSub: string,
  candidateId: string,
  overrides: { citation: string; url: string | null },
): Promise<QuickNoteDetail> {
  const literatureMemoId = await resolveLiteratureForCandidate(ownerSub, candidateId, overrides);
  return quickNotes.create(ownerSub, "SCRATCH", literatureMemoId);
}

export interface DiscoveryNoteRow {
  id: string;
  preview: string;
  enabled: boolean;
  candidateCount: number;
  lastRunAt: Date | null;
}

/** The 探索 tab's list: every active note, whether it's opted in, and what
 * discovery has found for it so far. */
export async function listNotesForDiscoveryTab(ownerSub: string): Promise<DiscoveryNoteRow[]> {
  const notes = await prisma.quickNote.findMany({
    where: { ownerSub, status: "ACTIVE" },
    orderBy: [{ discoveryEnabled: "desc" }, { encounteredAt: "desc" }],
    select: {
      id: true,
      content: true,
      discoveryEnabled: true,
      discoveryLastRunAt: true,
      _count: { select: { discoveryCandidates: true } },
    },
  });
  return notes.map((n) => ({
    id: n.id,
    preview: n.content.split("\n").find((line) => line.trim())?.trim().slice(0, 120) ?? "",
    enabled: n.discoveryEnabled,
    candidateCount: n._count.discoveryCandidates,
    lastRunAt: n.discoveryLastRunAt,
  }));
}

export async function setNoteDiscoveryEnabled(ownerSub: string, quickNoteId: string, enabled: boolean): Promise<void> {
  const note = await prisma.quickNote.findFirst({ where: { id: quickNoteId, ownerSub }, select: { id: true } });
  if (!note) throw new NotFoundError("quickNoteNotFound", `QuickNote not found: ${quickNoteId}`);
  await prisma.quickNote.update({ where: { id: quickNoteId }, data: { discoveryEnabled: enabled } });
}
