import * as aiCredentials from "@/lib/aiCredentials";
import { AiProvider } from "@/lib/aiCredentials";

/**
 * Asks the owner's own model for a JSON document.
 *
 * Separate from src/lib/discovery.ts's provider calls on purpose: those are
 * built around each provider's server-side web-search loop, which this
 * doesn't want and shouldn't pay for. What's shared is the principle — the
 * app holds no API key of its own, so everything here runs on the key the
 * owner put in Settings, and "no key configured" is a normal state that
 * callers handle rather than an error.
 */

export type AiErrorCode = "notConfigured" | "authError" | "rateLimitError" | "apiError" | "invalidResponse" | "truncated";

export class AiJsonError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Meal planning is a constraint-satisfaction job over a week — noticeably
// harder than discovery's "summarize what you found", so these are the
// mid-tier models rather than the cheapest. It runs once a week on the
// owner's key, not per note, so the cost profile allows it.
const ANTHROPIC_MODEL = "claude-sonnet-5";
const OPENAI_MODEL = "gpt-5";
const GOOGLE_MODEL = "gemini-2.5-pro";

function errorCodeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return "authError";
  if (status === 429) return "rateLimitError";
  return "apiError";
}

/** Enough of the reply to recognise what went wrong — a refusal, a
 * preamble, an error page — without pasting a whole week into a toast. */
function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

/** Models wrap JSON in prose and code fences however much you ask them not
 * to, so take the outermost balanced object rather than trusting the reply
 * to be bare JSON. Refuses an incomplete document — callers that can use a
 * partial one go through parseJsonLoose instead. */
export function extractJsonObject(text: string): unknown {
  const { value, truncated } = parseJsonLoose(text);
  if (truncated) throw new AiJsonError("truncated", "the JSON object in the response was never closed");
  return value;
}

export interface LooseParse {
  value: unknown;
  /** The reply was cut off and what came back is the part that parsed.
   * Carried out rather than swallowed: a five-day meal plan presented as a
   * week is worse than one labelled as incomplete. */
  truncated: boolean;
}

/**
 * Parses a reply that may have been cut off mid-sentence.
 *
 * A model that hits its token ceiling stops mid-object, and the whole
 * document then fails to parse — losing eighteen good meals because the
 * nineteenth was half-written. So on failure the scan rewinds to the last
 * element that did close, and the open brackets are shut there. What comes
 * back is a smaller but valid document, flagged as incomplete.
 */
export function parseJsonLoose(text: string): LooseParse {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new AiJsonError("invalidResponse", `JSONが含まれていません。返答の冒頭: ${snippet(text)}`);
  }

  const closers: string[] = [];
  // Where the last complete nested element ended, and what was still open
  // at that point — the pair needed to cut and close cleanly.
  let lastCompleteIndex = -1;
  let lastCompleteClosers = "";
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") closers.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      closers.pop();
      if (closers.length === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), truncated: false };
        } catch (e) {
          throw new AiJsonError("invalidResponse", `JSONとして壊れています: ${(e as Error).message}。返答の冒頭: ${snippet(text)}`);
        }
      }
      lastCompleteIndex = i + 1;
      lastCompleteClosers = [...closers].reverse().join("");
    }
  }

  if (lastCompleteIndex === -1) {
    throw new AiJsonError("truncated", `返答が使える所まで届く前に切れました。冒頭: ${snippet(text)}`);
  }
  try {
    return { value: JSON.parse(text.slice(start, lastCompleteIndex) + lastCompleteClosers), truncated: true };
  } catch {
    throw new AiJsonError("truncated", "the response was cut off and could not be repaired");
  }
}

/**
 * An empty reply, told apart by why it is empty.
 *
 * A model that spends its whole token budget thinking returns HTTP 200
 * with no text at all. Reported as "empty response" that looks like a bug
 * in the app; named properly, it points at the one setting that fixes it.
 */
function emptyReply(outOfTokens: boolean, detail: string): AiJsonError {
  return outOfTokens
    ? new AiJsonError("truncated", `本文が空のまま出力の上限に達しました（AIが思考で枠を使い切った可能性）。${detail}`)
    : new AiJsonError("invalidResponse", `本文が空の返答でした。${detail}`);
}

/** The provider's own error text, not just the status line — a 400 that
 * says which field it disliked is worth reading. */
async function apiError(provider: string, res: Response): Promise<AiJsonError> {
  let body = "";
  try {
    body = snippet(await res.text());
  } catch {
    // The body is a bonus; the status is the fact.
  }
  return new AiJsonError(errorCodeForStatus(res.status), `${provider} API error: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
}

interface AnthropicBlock {
  type: string;
  text?: string;
}

/**
 * A file sent alongside the prompt — only PDFs so far.
 *
 * All three providers read PDFs natively, text layer and scanned pages
 * alike, so nothing on this side has to pull text out of the file first.
 * That matters for statements in particular: text extraction from a
 * multi-column PDF comes out interleaved, and a scanned one has no text at
 * all, whereas the model reads the page the way a person would.
 */
export interface AiAttachment {
  mimeType: "application/pdf";
  filename: string;
  base64: string;
}

/** The reply text, plus whether the model ran out of room while writing
 * it. Every provider says so in its own field; knowing which failure this
 * is decides whether retrying can possibly help. */
interface ProviderReply {
  text: string;
  truncated: boolean;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  attachment?: AiAttachment,
): Promise<ProviderReply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          // The document goes before the question — the order the API
          // documents for PDF input.
          content: attachment
            ? [
                { type: "document", source: { type: "base64", media_type: attachment.mimeType, data: attachment.base64 } },
                { type: "text", text: user },
              ]
            : user,
        },
      ],
      // Thinking is on by default on this model and is paid for out of the
      // same token budget as the answer — which is how a week of meals
      // came back empty. The brief here is long and prescriptive, and the
      // result is verified afterwards either way, so the depth is better
      // spent on the answer.
      ...(tuned ? { output_config: { effort: "low" } } : {}),
    }),
  });
  if (!res.ok) throw await apiError("Anthropic", res);
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
  if (!text) throw emptyReply(data.stop_reason === "max_tokens", `stop_reason=${data.stop_reason ?? "不明"}`);
  return { text, truncated: data.stop_reason === "max_tokens" };
}

async function callOpenAi(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  attachment?: AiAttachment,
): Promise<ProviderReply> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      instructions: system,
      input: attachment
        ? [
            {
              role: "user",
              content: [
                {
                  type: "input_file",
                  filename: attachment.filename,
                  file_data: `data:${attachment.mimeType};base64,${attachment.base64}`,
                },
                { type: "input_text", text: user },
              ],
            },
          ]
        : user,
      // Same reason as Anthropic: reasoning tokens come out of the output
      // budget on this model.
      ...(tuned ? { reasoning: { effort: "low" } } : {}),
    }),
  });
  if (!res.ok) throw await apiError("OpenAI", res);
  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type: string; text?: string }> }>;
    status?: string;
    incomplete_details?: { reason?: string };
  };
  const text =
    data.output_text ??
    (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === "output_text" && c.text)
      .map((c) => c.text)
      .join("");
  const cutOff = data.status === "incomplete" || data.incomplete_details?.reason === "max_output_tokens";
  if (!text) throw emptyReply(cutOff, `status=${data.status ?? "不明"} reason=${data.incomplete_details?.reason ?? "なし"}`);
  return { text, truncated: cutOff };
}

async function callGoogle(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  attachment?: AiAttachment,
): Promise<ProviderReply> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: "user",
          parts: attachment
            ? [{ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } }, { text: user }]
            : [{ text: user }],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        // Same reason again: this model thinks by default, out of the same
        // budget. A bounded budget leaves room for the answer.
        ...(tuned ? { thinkingConfig: { thinkingBudget: 2048 } } : {}),
      },
    }),
  });
  if (!res.ok) throw await apiError("Google", res);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const cutOff = candidate?.finishReason === "MAX_TOKENS";
  if (!text) throw emptyReply(cutOff, `finishReason=${candidate?.finishReason ?? "不明"}`);
  return { text, truncated: cutOff };
}

/* ---------- streaming ---------- */

/**
 * What a streaming call reports while it runs: the model is reasoning
 * (no answer text yet), or this is the answer so far. The chats turn these
 * into the progress the owner watches instead of a frozen button.
 */
export type AiProgress = { kind: "thinking" } | { kind: "text"; text: string };

/** The `data:` payloads of a server-sent-events response, one per event. */
async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield data;
    }
  }
}

function parseEvent(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The request bodies below are the non-streaming ones plus the provider's
 * own "stream" switch; the reply is assembled from the deltas. */
async function streamAnthropic(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  onProgress: (p: AiProgress) => void,
): Promise<ProviderReply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      stream: true,
      ...(tuned ? { output_config: { effort: "low" } } : {}),
    }),
  });
  if (!res.ok) throw await apiError("Anthropic", res);
  let text = "";
  let stopReason = "";
  for await (const data of sseData(res)) {
    const event = parseEvent(data);
    if (!event) continue;
    if (event.type === "content_block_delta") {
      const delta = event.delta as { type?: string; text?: string };
      if (delta.type === "text_delta" && delta.text) {
        text += delta.text;
        onProgress({ kind: "text", text });
      } else if (delta.type === "thinking_delta") {
        onProgress({ kind: "thinking" });
      }
    } else if (event.type === "message_delta") {
      stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? stopReason;
    } else if (event.type === "error") {
      throw new AiJsonError("apiError", `Anthropic stream error: ${snippet(JSON.stringify(event.error ?? event))}`);
    }
  }
  if (!text) throw emptyReply(stopReason === "max_tokens", `stop_reason=${stopReason || "不明"}`);
  return { text, truncated: stopReason === "max_tokens" };
}

async function streamOpenAi(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  onProgress: (p: AiProgress) => void,
): Promise<ProviderReply> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      instructions: system,
      input: user,
      stream: true,
      ...(tuned ? { reasoning: { effort: "low" } } : {}),
    }),
  });
  if (!res.ok) throw await apiError("OpenAI", res);
  let text = "";
  let status = "";
  let reason = "";
  for await (const data of sseData(res)) {
    const event = parseEvent(data);
    if (!event) continue;
    const type = String(event.type ?? "");
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      text += event.delta;
      onProgress({ kind: "text", text });
    } else if (type.startsWith("response.reasoning")) {
      onProgress({ kind: "thinking" });
    } else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
      const response = (event.response ?? {}) as { status?: string; incomplete_details?: { reason?: string } };
      status = response.status ?? status;
      reason = response.incomplete_details?.reason ?? reason;
    } else if (type === "error") {
      throw new AiJsonError("apiError", `OpenAI stream error: ${snippet(JSON.stringify(event))}`);
    }
  }
  const cutOff = status === "incomplete" || reason === "max_output_tokens";
  if (!text) throw emptyReply(cutOff, `status=${status || "不明"} reason=${reason || "なし"}`);
  return { text, truncated: cutOff };
}

async function streamGoogle(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  tuned: boolean,
  onProgress: (p: AiProgress) => void,
): Promise<ProviderReply> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          ...(tuned ? { thinkingConfig: { thinkingBudget: 2048 } } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw await apiError("Google", res);
  let text = "";
  let finishReason = "";
  for await (const data of sseData(res)) {
    const event = parseEvent(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }> } | null;
    const candidate = event?.candidates?.[0];
    if (!candidate) continue;
    for (const part of candidate.content?.parts ?? []) {
      if (part.thought) onProgress({ kind: "thinking" });
      else if (part.text) {
        text += part.text;
        onProgress({ kind: "text", text });
      }
    }
    finishReason = candidate.finishReason ?? finishReason;
  }
  const cutOff = finishReason === "MAX_TOKENS";
  if (!text) throw emptyReply(cutOff, `finishReason=${finishReason || "不明"}`);
  return { text, truncated: cutOff };
}

/**
 * Runs the prompt on whichever provider the owner configured.
 *
 * Throws AiJsonError("notConfigured") when there's no key — callers turn
 * that into an explanation, not a failure. `truncated` in the result means
 * the model hit its ceiling: the value is the part that parsed, and the
 * caller decides whether a partial answer is worth showing.
 *
 * The default ceiling is the largest that comfortably fits a non-streaming
 * request without risking an HTTP timeout. With `onProgress` the reply is
 * streamed instead, which also keeps a long answer from timing out.
 *
 * `attachment` sends a file with the prompt (see AiAttachment).
 */
export async function askForJson(
  ownerSub: string,
  system: string,
  user: string,
  maxTokens = 16000,
  attachment?: AiAttachment,
  /** Streams the reply and reports it as it arrives (see AiProgress).
   * Text-only prompts; an attachment always takes the plain request. */
  onProgress?: (p: AiProgress) => void,
): Promise<LooseParse> {
  const credential = await aiCredentials.get(ownerSub);
  if (!credential) throw new AiJsonError("notConfigured", "No AI provider configured");

  const call = (tuned: boolean): Promise<ProviderReply> => {
    if (onProgress && !attachment) {
      switch (credential.provider) {
        case AiProvider.ANTHROPIC:
          return streamAnthropic(credential.apiKey, system, user, maxTokens, tuned, onProgress);
        case AiProvider.OPENAI:
          return streamOpenAi(credential.apiKey, system, user, maxTokens, tuned, onProgress);
        case AiProvider.GOOGLE:
          return streamGoogle(credential.apiKey, system, user, maxTokens, tuned, onProgress);
      }
    }
    switch (credential.provider) {
      case AiProvider.ANTHROPIC:
        return callAnthropic(credential.apiKey, system, user, maxTokens, tuned, attachment);
      case AiProvider.OPENAI:
        return callOpenAi(credential.apiKey, system, user, maxTokens, tuned, attachment);
      case AiProvider.GOOGLE:
        return callGoogle(credential.apiKey, system, user, maxTokens, tuned, attachment);
      default:
        throw new AiJsonError("notConfigured", "Unknown provider");
    }
  };

  let reply: ProviderReply;
  try {
    reply = await call(true);
  } catch (e) {
    // The reasoning-budget fields differ per provider and move over time.
    // If one is rejected, the request itself is still good — retry it
    // plain rather than reporting a failure the owner can do nothing
    // about. A tuned request that merely came back empty is not retried:
    // that would double the bill on their own key for the same answer.
    if (!(e instanceof AiJsonError && e.code === "apiError")) throw e;
    reply = await call(false);
  }
  const parsed = parseJsonLoose(reply.text);
  return { value: parsed.value, truncated: parsed.truncated || reply.truncated };
}
