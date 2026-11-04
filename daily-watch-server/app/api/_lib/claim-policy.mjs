export const MAX_CLAIM_BYTES = 32768;
export const RETURN_TO = '/play/index.html';

export class ClaimError extends Error {
  constructor(message, code = 'invalid_claim', status = 400) {
    super(message);
    this.name = 'ClaimError';
    this.code = code;
    this.status = status;
  }
}

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!origin || origin !== new URL(request.url).origin || (site && site !== 'same-origin' && site !== 'none')) {
    throw new ClaimError('Open the game on this site before saving a reward.', 'cross_origin', 403);
  }
}

export async function readClaimBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new ClaimError('Send the completed expedition as JSON.', 'unsupported_content_type', 415);
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_CLAIM_BYTES)) {
    throw new ClaimError('The expedition record is too large.', 'body_too_large', 413);
  }
  if (!request.body) throw new ClaimError('The expedition record is missing.', 'missing_body');
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CLAIM_BYTES) {
        await reader.cancel();
        throw new ClaimError('The expedition record is too large.', 'body_too_large', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw new ClaimError('The expedition record could not be read.', 'invalid_json'); }
}

export function validateDailyClaim(body, engine, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClaimError('The expedition record is missing.', 'invalid_claim');
  }
  if (!validDay(body.day) || body.day !== utcDay(now)) {
    throw new ClaimError('Daily rewards can be saved for today’s watch. Earlier watches remain available for practice.', 'day_closed', 409);
  }
  const replay = body.replay;
  if (!replay || typeof replay !== 'object' || Array.isArray(replay) ||
      replay.version !== engine.VERSION || replay.mode !== 'daily' ||
      replay.seed !== engine.seedForDay(body.day)) {
    throw new ClaimError('This expedition does not match today’s watch.', 'wrong_daily');
  }
  let result;
  try { result = engine.replayRun(replay); }
  catch { throw new ClaimError('The expedition moves could not be verified.', 'invalid_replay'); }
  if (!result?.valid || !result.state) {
    throw new ClaimError('The expedition moves could not be verified.', 'invalid_replay');
  }
  const state = result.state;
  if (state.mode !== 'daily' || state.seed !== engine.seedForDay(body.day) ||
      !['victory', 'defeat'].includes(state.phase)) {
    throw new ClaimError('Finish this watch before saving its reward.', 'unfinished_watch');
  }
  for (const value of [state.hull, state.score, state.tide, state.movesUsed]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new ClaimError('The expedition result is invalid.', 'invalid_result');
  }
  if (state.tide < 1 || state.hull > state.maxHull || state.tide > engine.DAILY_TIDES ||
      state.movesUsed > engine.DAILY_TIDES * engine.ORDERS_PER_TIDE || (state.phase === 'defeat' && state.hull !== 0) ||
      (state.phase === 'victory' && (state.hull === 0 || state.tide !== engine.DAILY_TIDES))) {
    throw new ClaimError('The expedition result is invalid.', 'invalid_result');
  }
  return {
    day: body.day, rulesVersion: String(engine.VERSION), phase: state.phase,
    hull: state.hull, score: state.score, tide: state.tide, movesUsed: state.movesUsed,
    replayJson: JSON.stringify(engine.serializeGame(state)),
  };
}

export async function playerAlias(userId) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sea-gates-watch/alias/v1/${userId}`)));
  const suffix = Array.from(bytes.slice(0, 4), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Mariner ${suffix}`;
}

export function publicClaim(row) {
  return { day: row.day, score: row.score, hull: row.hull, phase: row.phase, tide: row.tide, movesUsed: row.moves_used };
}

export const CLAIM_UPSERT_SQL = `
INSERT INTO watch_claims
  (user_id, day, rules_version, phase, hull, score, tide, moves_used, replay_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, day) DO UPDATE SET
  rules_version = excluded.rules_version,
  phase = excluded.phase,
  hull = excluded.hull,
  score = excluded.score,
  tide = excluded.tide,
  moves_used = excluded.moves_used,
  replay_json = excluded.replay_json,
  updated_at = excluded.updated_at
WHERE
  (excluded.phase = 'victory' AND watch_claims.phase != 'victory')
  OR (excluded.phase = watch_claims.phase AND (
    excluded.hull > watch_claims.hull
    OR (excluded.hull = watch_claims.hull AND excluded.score > watch_claims.score)
    OR (excluded.hull = watch_claims.hull AND excluded.score = watch_claims.score AND excluded.moves_used < watch_claims.moves_used)
  ))`;

export const PROFILE_COUNT_SQL = 'SELECT COUNT(*) AS total FROM watch_claims WHERE user_id = ?';
export const PROFILE_CLAIMS_SQL = 'SELECT day, phase, hull, score, tide, moves_used FROM watch_claims WHERE user_id = ? ORDER BY day DESC LIMIT 90';
export const LEADERBOARD_SQL = `SELECT user_id, phase, hull, score, tide, moves_used FROM watch_claims WHERE day = ?
ORDER BY CASE phase WHEN 'victory' THEN 1 ELSE 0 END DESC, hull DESC, score DESC, moves_used ASC, created_at ASC, user_id ASC LIMIT 50`;

export function claimParameters(userId, claim, now = new Date()) {
  const timestamp = now.toISOString();
  return [userId, claim.day, claim.rulesVersion, claim.phase, claim.hull, claim.score, claim.tide, claim.movesUsed, claim.replayJson, timestamp, timestamp];
}
