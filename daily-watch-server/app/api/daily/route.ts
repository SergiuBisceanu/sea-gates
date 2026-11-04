import { VERSION, seedForDay } from "../../../public/play/engine.mjs";
import { utcDay } from "../_lib/claim-policy.mjs";
import { json } from "../_lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const day = utcDay(now);
  const nextDay = new Date(now);
  nextDay.setUTCHours(24, 0, 0, 0);
  return json({ day, seed: seedForDay(day), version: VERSION, mode: "daily", tides: 7, serverTime: now.toISOString(), resetsAt: nextDay.toISOString() });
}
