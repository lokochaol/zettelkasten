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

interface AnthropicBlock {
  type: string;
  text?: string;
}

/** The reply text, plus whether the model ran out of room while writing
 * it. Every provider says so in its own field; knowing which failure this
 * is decides whether retrying can possibly help. */
interface ProviderReply {
  text: string;
  truncated: boolean;
}

async function callAnthropic(apiKey: string, system: string, user: string, maxTokens: number): Promise<ProviderReply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new AiJsonError(errorCodeForStatus(res.status), `Anthropic API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return { text, truncated: data.stop_reason === "max_tokens" };
}

async function callOpenAi(apiKey: string, system: string, user: string, maxTokens: number): Promise<ProviderReply> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: maxTokens,
      instructions: system,
      input: user,
    }),
  });
  if (!res.ok) throw new AiJsonError(errorCodeForStatus(res.status), `OpenAI API error: ${res.status} ${res.statusText}`);
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
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return { text, truncated: data.status === "incomplete" || data.incomplete_details?.reason === "max_output_tokens" };
}

async function callGoogle(apiKey: string, system: string, user: string, maxTokens: number): Promise<ProviderReply> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new AiJsonError(errorCodeForStatus(res.status), `Google API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return { text, truncated: candidate?.finishReason === "MAX_TOKENS" };
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
 * request without risking an HTTP timeout. Asking for much more than this
 * needs streaming, which is a bigger change than this app has needed so
 * far — so callers that want more output should ask for less text instead.
 */
export async function askForJson(
  ownerSub: string,
  system: string,
  user: string,
  maxTokens = 16000,
): Promise<LooseParse> {
  const credential = await aiCredentials.get(ownerSub);
  if (!credential) throw new AiJsonError("notConfigured", "No AI provider configured");

  let reply: ProviderReply;
  switch (credential.provider) {
    case AiProvider.ANTHROPIC:
      reply = await callAnthropic(credential.apiKey, system, user, maxTokens);
      break;
    case AiProvider.OPENAI:
      reply = await callOpenAi(credential.apiKey, system, user, maxTokens);
      break;
    case AiProvider.GOOGLE:
      reply = await callGoogle(credential.apiKey, system, user, maxTokens);
      break;
    default:
      throw new AiJsonError("notConfigured", "Unknown provider");
  }
  const parsed = parseJsonLoose(reply.text);
  return { value: parsed.value, truncated: parsed.truncated || reply.truncated };
}
