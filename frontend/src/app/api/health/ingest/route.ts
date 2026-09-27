import { NextResponse, type NextRequest } from "next/server";
import * as health from "@/lib/health";
import { ValidationError } from "@/lib/errors";

/**
 * Where the iPhone Shortcut posts each morning's Health summary.
 *
 * HealthKit has no web API — a web app cannot read it, full stop. A
 * Shortcuts automation is the only way to get these numbers out of the
 * phone without shipping a native app, so this endpoint is shaped for what
 * Shortcuts can comfortably send: one small JSON body, a bearer token in a
 * header, once a day.
 *
 * It authenticates on that token alone rather than a session, because
 * there's no browser here — which is also why it has to be exempt from the
 * session redirect in proxy.ts, and why the token is the only thing
 * standing in front of it.
 *
 *   POST /api/health/ingest
 *   Authorization: Bearer hk_…
 *   { "date": "2026-09-28", "weightKg": 68.4, "activeEnergyKcal": 620, "steps": 9210 }
 *
 * Every field but `date` is optional: a day the phone recorded steps but no
 * weight is a normal day, not a malformed request.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "missing bearer token" }, { status: 401 });

  const ownerSub = await health.ownerForIngestToken(token);
  if (!ownerSub) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  // Shortcuts sends numbers as strings depending on how the action is
  // wired up, so accept either rather than making the owner debug an
  // automation over a type.
  const num = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const dateKey = typeof payload.date === "string" ? payload.date.trim() : "";

  try {
    const metric = await health.recordDailyMetric(ownerSub, {
      dateKey,
      weightKg: num(payload.weightKg),
      activeEnergyKcal: num(payload.activeEnergyKcal),
      steps: num(payload.steps) === null ? null : Math.round(num(payload.steps) as number),
    });
    return NextResponse.json({
      ok: true,
      date: metric.dateKey,
      weightKg: metric.weightKg,
      activeEnergyKcal: metric.activeEnergyKcal,
      steps: metric.steps,
    });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
