import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import * as engine from '../public/play/engine.mjs';
import {
  ClaimError, MAX_CLAIM_BYTES, CLAIM_UPSERT_SQL, PROFILE_COUNT_SQL, PROFILE_CLAIMS_SQL,
  LEADERBOARD_SQL, claimParameters, playerAlias, publicClaim, readClaimBody,
  requireSameOrigin, utcDay, validDay, validateDailyClaim,
} from '../app/api/_lib/claim-policy.mjs';

const DAY = '2026-11-04';
const NOW = new Date(`${DAY}T12:34:56Z`);
const ORIGIN = 'https://sea-gates-watch.example';
const migration = readFileSync(new URL('../drizzle/0000_wide_mad_thinker.sql', import.meta.url), 'utf8');

function completedReplay() {
  let state = engine.createGame(engine.seedForDay(DAY), 'daily');
  while (state.phase === 'planning') state = engine.defend(state);
  return engine.serializeGame(state);
}

const terminalReplay = completedReplay();
function validBody() { return { day: DAY, replay: structuredClone(terminalReplay) }; }
function claim(override = {}) {
  return { day: DAY, rulesVersion: '1', phase: 'victory', hull: 8, score: 1500, tide: 7, movesUsed: 20, replayJson: '{}', ...override };
}
function makeDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(migration);
  return db;
}
function errorCode(code) { return error => error instanceof ClaimError && error.code === code; }
function request(body = '{}', headers = {}) {
  return new Request(`${ORIGIN}/api/claim`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body,
  });
}

test('daily reward date is UTC and rejects normalized impossible dates', () => {
  assert.equal(utcDay(new Date('2026-11-05T01:15:00+02:00')), DAY);
  assert.equal(validDay('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '26-11-04', DAY + 'T00:00Z', null]) assert.equal(validDay(value), false);
});

test('a real terminal engine replay determines all saved results', () => {
  const expected = engine.replayRun(terminalReplay).state;
  const body = { ...validBody(), userId: 'other-player', score: 999999999, hull: 999999999, phase: 'victory' };
  const result = validateDailyClaim(body, engine, NOW);
  assert.equal(result.score, expected.score);
  assert.equal(result.hull, expected.hull);
  assert.equal(result.phase, expected.phase);
  assert.equal(result.day, DAY);
  assert.deepEqual(JSON.parse(result.replayJson), terminalReplay);
  assert.equal('userId' in result, false);
});

test('replays cannot choose a historical or future daily reward', () => {
  for (const day of ['2026-11-03', '2026-11-05', '2026-02-31', null]) {
    assert.throws(() => validateDailyClaim({ ...validBody(), day }, engine, NOW), errorCode('day_closed'));
  }
});

test('wrong seed, mode, or rules version cannot claim the common daily', () => {
  for (const patch of [{ seed: 17 }, { mode: 'voyage' }, { version: 999 }]) {
    const body = validBody();
    Object.assign(body.replay, patch);
    assert.throws(() => validateDailyClaim(body, engine, NOW), errorCode('wrong_daily'));
  }
});

test('a pending game cannot earn a completion tile', () => {
  const replay = engine.serializeGame(engine.createGame(engine.seedForDay(DAY), 'daily'));
  assert.throws(() => validateDailyClaim({ day: DAY, replay }, engine, NOW), errorCode('unfinished_watch'));
});

test('tampered result fields and impossible swap histories fail engine replay', () => {
  const body = validBody();
  body.replay.score = 999999;
  assert.throws(() => validateDailyClaim(body, engine, NOW), errorCode('invalid_replay'));
  const illegal = validBody();
  illegal.replay.turns[0].swaps = [[0, 47]];
  assert.throws(() => validateDailyClaim(illegal, engine, NOW), errorCode('invalid_replay'));
});

test('same-origin mutation checks reject missing, foreign and cross-site origins', () => {
  assert.doesNotThrow(() => requireSameOrigin(request()));
  assert.doesNotThrow(() => requireSameOrigin(request('{}', { 'sec-fetch-site': 'same-origin' })));
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.throws(() => requireSameOrigin(request('{}', headers)), errorCode('cross_origin'));
  }
  const missing = new Request(`${ORIGIN}/api/claim`, { method: 'POST', body: '{}' });
  assert.throws(() => requireSameOrigin(missing), errorCode('cross_origin'));
});

test('claim body parser accepts JSON and rejects malformed or wrong content', async () => {
  assert.deepEqual(await readClaimBody(request('{"day":"2026-11-04"}')), { day: DAY });
  await assert.rejects(readClaimBody(request('broken')), errorCode('invalid_json'));
  await assert.rejects(readClaimBody(request('{}', { 'content-type': 'text/plain' })), errorCode('unsupported_content_type'));
});

test('claim body limit applies to byte streams and declared lengths', async () => {
  await assert.rejects(readClaimBody(request('{}', { 'content-length': String(MAX_CLAIM_BYTES + 1) })), errorCode('body_too_large'));
  await assert.rejects(readClaimBody(request(' '.repeat(MAX_CLAIM_BYTES + 1))), errorCode('body_too_large'));
  // Unicode counts as bytes, so a shorter JavaScript string can exceed the cap.
  await assert.rejects(readClaimBody(request(JSON.stringify('海'.repeat(12000)))), errorCode('body_too_large'));
});

test('aliases are stable and never expose email or internal account IDs', async () => {
  const alias = await playerAlias('synthetic-user-1');
  assert.match(alias, /^Mariner [0-9A-F]{8}$/);
  assert.equal(alias, await playerAlias('synthetic-user-1'));
  assert.notEqual(alias, await playerAlias('synthetic-user-2'));
  assert.deepEqual(publicClaim({ user_id: 'secret', replay_json: 'secret', day: DAY, phase: 'defeat', hull: 0, score: 10, tide: 2, moves_used: 0 }),
    { day: DAY, phase: 'defeat', hull: 0, score: 10, tide: 2, movesUsed: 0 });
});

test('repeated and worse submissions preserve one day and its best result', () => {
  const db = makeDatabase();
  try {
    const write = db.prepare(CLAIM_UPSERT_SQL);
    const original = claim();
    assert.equal(write.run(...claimParameters('a', original, NOW)).changes, 1);
    assert.equal(write.run(...claimParameters('a', original, NOW)).changes, 0);
    assert.equal(write.run(...claimParameters('a', claim({ phase: 'defeat', hull: 0, score: 99999 }), NOW)).changes, 0);
    assert.equal(write.run(...claimParameters('a', claim({ hull: 7, score: 99999 }), NOW)).changes, 0);
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('a').total, 1);
    const saved = db.prepare(PROFILE_CLAIMS_SQL).get('a');
    assert.equal(saved.hull, 8);
    assert.equal(saved.score, 1500);
  } finally { db.close(); }
});

test('improved mastery updates an existing tile without changing its earned date', () => {
  const db = makeDatabase();
  try {
    const write = db.prepare(CLAIM_UPSERT_SQL);
    write.run(...claimParameters('a', claim({ phase: 'defeat', hull: 0 }), NOW));
    write.run(...claimParameters('a', claim({ hull: 12, score: 1600 }), new Date(`${DAY}T18:00Z`)));
    write.run(...claimParameters('a', claim({ hull: 12, score: 1600, movesUsed: 18 }), new Date(`${DAY}T19:00Z`)));
    const saved = db.prepare('SELECT * FROM watch_claims WHERE user_id = ?').get('a');
    assert.equal(saved.phase, 'victory');
    assert.equal(saved.hull, 12);
    assert.equal(saved.moves_used, 18);
    assert.equal(saved.created_at, NOW.toISOString());
    assert.equal(saved.updated_at, `${DAY}T19:00:00.000Z`);
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('a').total, 1);
  } finally { db.close(); }
});

test('profile counts are per account and cumulative across days', () => {
  const db = makeDatabase();
  try {
    const write = db.prepare(CLAIM_UPSERT_SQL);
    for (const day of ['2026-10-01', '2026-10-14', DAY]) write.run(...claimParameters('a', claim({ day }), NOW));
    write.run(...claimParameters('b', claim(), NOW));
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('a').total, 3);
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('b').total, 1);
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('missing').total, 0);
    assert.deepEqual(db.prepare(PROFILE_CLAIMS_SQL).all('a').map(r => r.day), [DAY, '2026-10-14', '2026-10-01']);
  } finally { db.close(); }
});

test('public ranking prefers victory then hull, score and fewer orders', () => {
  const db = makeDatabase();
  try {
    const write = db.prepare(CLAIM_UPSERT_SQL);
    for (const [id, values] of [['loss', { phase: 'defeat', hull: 0, score: 90000 }], ['low', { hull: 8 }], ['high', { hull: 12 }], ['efficient', { hull: 12, movesUsed: 15 }]]) {
      write.run(...claimParameters(id, claim(values), NOW));
    }
    assert.deepEqual(db.prepare(LEADERBOARD_SQL).all(DAY).map(r => r.user_id), ['efficient', 'high', 'low', 'loss']);
    assert.equal(db.prepare(LEADERBOARD_SQL).all('2026-11-03').length, 0);
  } finally { db.close(); }
});

test('concurrent connections cannot multiply a daily reward or overwrite a better run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sea-gates-claims-'));
  const path = join(directory, 'claims.sqlite');
  const db = makeDatabase(path);
  db.exec('PRAGMA journal_mode=WAL');
  try {
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.path);
      db.exec('PRAGMA busy_timeout=5000');
      const write = db.prepare(workerData.sql);
      for (const params of workerData.submissions) write.run(...params);
      db.close();
      parentPort.postMessage('done');
    `;
    const tasks = Array.from({ length: 4 }, (_, worker) => {
      const submissions = Array.from({ length: 24 }, (_, i) => claimParameters('shared-player', claim({ hull: (i % 12) + 1, score: 1000 + worker, movesUsed: 20 }), NOW));
      return new Promise((resolve, reject) => {
        const thread = new Worker(workerSource, { eval: true, workerData: { path, sql: CLAIM_UPSERT_SQL, submissions } });
        thread.once('message', resolve);
        thread.once('error', reject);
        thread.once('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
      });
    });
    await Promise.all(tasks);
    assert.equal(db.prepare(PROFILE_COUNT_SQL).get('shared-player').total, 1);
    const saved = db.prepare(PROFILE_CLAIMS_SQL).get('shared-player');
    assert.equal(saved.hull, 12);
    assert.equal(saved.score, 1003);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
