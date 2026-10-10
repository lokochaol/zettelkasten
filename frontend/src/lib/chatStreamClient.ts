import type { ChatProgress, ChatStreamEvent } from "@/lib/chatProgress";

/**
 * Posts a chat message to one of the streaming chat routes and reads the
 * answer as it comes (src/lib/chatStream.ts): progress is handed to
 * `onProgress` line by line, and the result is the stored conversation or
 * an error to show.
 *
 * Anything that isn't the expected stream — an expired login answered with
 * the sign-in page, a deploy mid-request, a dropped connection — comes back
 * as `fallbackError` rather than a thrown exception, so the screen can keep
 * the typed text and say what to do.
 */
export async function postChatStream<T>(
  url: string,
  body: unknown,
  onProgress: (p: ChatProgress) => void,
  fallbackError: string,
): Promise<{ messages: T[] } | { error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: fallbackError };
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) return { error: fallbackError };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line) as ChatStreamEvent<T>;
        if (event.type === "progress") onProgress(event.progress);
        else if (event.type === "done") return { messages: event.messages };
        else if (event.type === "error") return { error: event.error };
      }
    }
  } catch {
    return { error: fallbackError };
  }
  return { error: fallbackError };
}
