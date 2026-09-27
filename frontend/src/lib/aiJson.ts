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

export type AiErrorCode = "notConfigured" | "authError" | "rateLimitError" | "apiError" | "invalidResponse";

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

/** Models wrap JSON in prose and code fences however much you ask them not
 * to, so take the outermost balanced object rather than trusting the reply
 * to be bare JSON. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new AiJsonError("invalidResponse", "no JSON object in the response");
  let depth = 0;
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
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (e) {
          throw new AiJsonError("invalidResponse", `response was not valid JSON: ${(e as Error).message}`);
        }
      }
    }
  }
  throw new AiJsonError("invalidResponse", "the JSON object in the response was never closed");
}

interface AnthropicBlock {
  type: string;
  text?: string;
}

async function callAnthropic(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new AiJsonError(errorCodeForStatus(res.status), `Anthropic API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { content?: AnthropicBlock[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("");
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return text;
}

async function callOpenAi(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
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
  };
  const text =
    data.output_text ??
    (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((c) => c.type === "output_text" && c.text)
      .map((c) => c.text)
      .join("");
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return text;
}

async function callGoogle(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
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
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  if (!text) throw new AiJsonError("invalidResponse", "empty response");
  return text;
}

/** Runs the prompt on whichever provider the owner configured and returns
 * the parsed JSON object. Throws AiJsonError("notConfigured") when there's
 * no key — callers turn that into an explanation, not a failure. */
export async function askForJson(
  ownerSub: string,
  system: string,
  user: string,
  maxTokens = 8000,
): Promise<unknown> {
  const credential = await aiCredentials.get(ownerSub);
  if (!credential) throw new AiJsonError("notConfigured", "No AI provider configured");

  let text: string;
  switch (credential.provider) {
    case AiProvider.ANTHROPIC:
      text = await callAnthropic(credential.apiKey, system, user, maxTokens);
      break;
    case AiProvider.OPENAI:
      text = await callOpenAi(credential.apiKey, system, user, maxTokens);
      break;
    case AiProvider.GOOGLE:
      text = await callGoogle(credential.apiKey, system, user, maxTokens);
      break;
    default:
      throw new AiJsonError("notConfigured", "Unknown provider");
  }
  return extractJsonObject(text);
}
