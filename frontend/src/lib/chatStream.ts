import { AiJsonError } from "@/lib/aiJson";
import { ValidationError } from "@/lib/errors";
import { translateAiError, translateDomainError } from "@/lib/i18n/errors";
import type { Locale } from "@/lib/i18n/types";
import type { ChatProgress, ChatStreamEvent } from "@/lib/chatProgress";

/** Progress lines are sent at most this often while text streams; a stage
 * change always goes out at once. Enough to look live, without one line
 * per token. */
const PROGRESS_INTERVAL_MS = 150;

/**
 * A chat request as a streamed response: newline-delimited JSON events —
 * progress while the model works, then the stored conversation, or an error
 * the owner can read (see ChatStreamEvent).
 *
 * The work runs to the end even if the browser goes away mid-answer: the
 * reply is still stored, and the conversation shows it on the next visit.
 */
export function chatStreamResponse<T>(locale: Locale, run: (onProgress: (p: ChatProgress) => void) => Promise<T[]>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatStreamEvent<T>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // the browser left; keep working, stop writing
        }
      };
      let lastStage = "";
      let lastSent = 0;
      let pending: ChatProgress | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (!pending) return;
        send({ type: "progress", progress: pending });
        lastSent = Date.now();
        pending = null;
      };
      const onProgress = (p: ChatProgress) => {
        pending = p;
        if (p.stage !== lastStage) {
          lastStage = p.stage;
          if (timer) clearTimeout(timer);
          flush();
        } else if (!timer) {
          timer = setTimeout(flush, Math.max(0, PROGRESS_INTERVAL_MS - (Date.now() - lastSent)));
        }
      };
      try {
        const messages = await run(onProgress);
        if (timer) clearTimeout(timer);
        send({ type: "done", messages });
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (e instanceof ValidationError) send({ type: "error", error: translateDomainError(locale, e) });
        else if (e instanceof AiJsonError) {
          console.error("chat failed", e.code, e.message);
          send({ type: "error", error: translateAiError(locale, e) });
        } else {
          console.error("chat failed", e);
          send({ type: "error", error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
