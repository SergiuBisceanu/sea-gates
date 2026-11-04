import { LEADERBOARD_SQL, playerAlias, utcDay, validDay } from "../_lib/claim-policy.mjs";
import { apiError, database, json } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const day = new URL(request.url).searchParams.get("day") ?? utcDay();
    if (!validDay(day)) return json({ error: "Choose a valid watch date.", code: "invalid_day" }, 400);
    const result = await database().prepare(LEADERBOARD_SQL).bind(day).all<{
      user_id: string; phase: string; hull: number; score: number; tide: number; moves_used: number;
    }>();
    const entries = await Promise.all(result.results.map(async row => ({
      alias: await playerAlias(row.user_id), phase: row.phase, hull: row.hull, score: row.score,
      tide: row.tide, movesUsed: row.moves_used,
    })));
    return json({ day, entries });
  } catch (error) { return apiError(error); }
}
