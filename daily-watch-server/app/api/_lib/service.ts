import { env } from "cloudflare:workers";
import { ClaimError, playerAlias, PROFILE_CLAIMS_SQL, PROFILE_COUNT_SQL, publicClaim } from "./claim-policy.mjs";

export function database(): D1Database {
  if (!env.DB) throw new Error("Account database binding is unavailable.");
  return env.DB;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  } });
}

type ClaimRow = { day: string; phase: string; hull: number; score: number; tide: number; moves_used: number };

export async function profileFor(userId: string) {
  const db = database();
  const result = await db.batch([
    db.prepare(PROFILE_COUNT_SQL).bind(userId),
    db.prepare(PROFILE_CLAIMS_SQL).bind(userId),
  ]);
  return profileFromResults(userId, result[0], result[1]);
}

export async function profileFromResults(userId: string, count: D1Result, list: D1Result) {
  const claims = (list.results as unknown as ClaimRow[]).map(publicClaim);
  return {
    alias: await playerAlias(userId),
    daysPlayed: Number((count.results[0] as { total?: number } | undefined)?.total ?? 0),
    claims,
    latestClaim: claims[0] ?? null,
  };
}

export function apiError(error: unknown) {
  if (error instanceof ClaimError) return json({ error: error.message, code: error.code }, error.status);
  console.error("Sea Gates account operation failed", error instanceof Error ? error.message : "Unknown account error");
  return json({ error: "Account progress is temporarily unavailable. Please try again shortly.", code: "account_unavailable" }, 503);
}
