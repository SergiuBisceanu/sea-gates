import { getChatGPTUser } from "../../chatgpt-auth";
import * as engine from "../../../public/play/engine.mjs";
import { CLAIM_UPSERT_SQL, PROFILE_CLAIMS_SQL, PROFILE_COUNT_SQL, claimParameters, readClaimBody, requireSameOrigin, validateDailyClaim } from "../_lib/claim-policy.mjs";
import { apiError, database, json, profileFromResults } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "Sign in to save this reward to your account.", code: "sign_in_required" }, 401);
    requireSameOrigin(request);
    const body = await readClaimBody(request);
    const now = new Date();
    const claim = validateDailyClaim(body, engine, now);
    const db = database();
    const result = await db.batch([
      db.prepare("SELECT day FROM watch_claims WHERE user_id = ? AND day = ?").bind(user.userId, claim.day),
      db.prepare(CLAIM_UPSERT_SQL).bind(...claimParameters(user.userId, claim, now)),
      db.prepare(PROFILE_COUNT_SQL).bind(user.userId),
      db.prepare(PROFILE_CLAIMS_SQL).bind(user.userId),
    ]);
    const alreadyClaimed = result[0].results.length > 0;
    return json({ ok: true, alreadyClaimed, improved: alreadyClaimed && result[1].meta.changes > 0,
      profile: await profileFromResults(user.userId, result[2], result[3]) });
  } catch (error) { return apiError(error); }
}
