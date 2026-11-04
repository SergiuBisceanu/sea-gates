import { replayRun, seedForDay, serializeGame } from './engine.mjs';

// A transfer contains only an anonymous, deterministic game replay. The
// fragment is never sent as part of the HTTP request and is removed on arrival.
export const MAX_TRANSFER_FRAGMENT_LENGTH = 16_000;

function validate(payload, currentDay) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes('day') || !keys.includes('replay')) return null;
  let seed;
  try { seed = seedForDay(payload.day); } catch { return null; }
  if (currentDay !== null && payload.day !== currentDay) return null;
  const checked = replayRun(payload.replay);
  if (!checked.valid || !checked.result.completed || checked.result.mode !== 'daily' || checked.result.seed !== seed) return null;
  return { day: payload.day, replay: serializeGame(checked.state), state: checked.state, result: checked.result };
}

export function decodeWatchFragment(fragment, currentDay = null) {
  if (typeof fragment !== 'string' || !fragment.startsWith('#watch=') || fragment.length > MAX_TRANSFER_FRAGMENT_LENGTH) return null;
  try { return validate(JSON.parse(decodeURIComponent(fragment.slice(7))), currentDay); } catch { return null; }
}

export function encodeWatchFragment(payload) {
  const checked = validate(payload, null);
  if (!checked) return '';
  const fragment = '#watch=' + encodeURIComponent(JSON.stringify({ day: checked.day, replay: checked.replay }));
  return fragment.length <= MAX_TRANSFER_FRAGMENT_LENGTH ? fragment : '';
}

export function betterResult(next, previous) {
  if (!previous) return true;
  const a = [next.phase === 'victory' ? 1 : 0, next.hull || 0, next.score || 0, -(next.movesUsed || 0)];
  const b = [previous.phase === 'victory' ? 1 : 0, previous.hull || 0, previous.score || 0, -(previous.movesUsed || 0)];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
