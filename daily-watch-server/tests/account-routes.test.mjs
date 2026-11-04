import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../public/play/engine.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const ORIGIN = 'https://sea-gates-watch.example';
const context = { headers: new Headers(), env: { DB: null } };
globalThis.__seaGatesAccountTest = context;

// Exercise the actual route modules. Only the two platform facilities are
// replaced in memory, with no preview or production authentication bypass.
const moduleURLs = new Map();
const platform = {
  'cloudflare:workers': 'export const env = globalThis.__seaGatesAccountTest.env;',
  'next/headers': 'export async function headers() { return globalThis.__seaGatesAccountTest.headers; }',
  'next/navigation': 'export function redirect(path) { throw new Error(`Unexpected redirect ${path}`); }',
};
function dataURL(source) { return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`; }
function loadModuleURL(path) {
  if (moduleURLs.has(path)) return moduleURLs.get(path);
  let source = readFileSync(path, 'utf8');
  if (path.endsWith('.ts')) source = stripTypeScriptTypes(source, { mode: 'transform' });
  source = source.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (match, quote, specifier) => {
    let target;
    if (platform[specifier]) target = dataURL(platform[specifier]);
    else if (specifier.startsWith('.')) {
      let resolved = resolve(dirname(path), specifier);
      if (!existsSync(resolved)) resolved += '.ts';
      target = loadModuleURL(resolved);
    } else throw new Error(`Unmocked route dependency ${specifier}`);
    return `from ${JSON.stringify(target)}`;
  });
  const url = dataURL(source);
  moduleURLs.set(path, url);
  return url;
}

const playerRoute = await import(loadModuleURL(resolve(root, 'app/api/player/route.ts')));
const claimRoute = await import(loadModuleURL(resolve(root, 'app/api/claim/route.ts')));
const leaderboardRoute = await import(loadModuleURL(resolve(root, 'app/api/leaderboard/route.ts')));
const dailyRoute = await import(loadModuleURL(resolve(root, 'app/api/daily/route.ts')));

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(root, 'drizzle/0000_wide_mad_thinker.sql'), 'utf8'));
  context.headers = new Headers();
  context.env.DB = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async all() { return execute(); },
        execute,
      };
      function execute() {
        const query = db.prepare(sql);
        const hasRows = query.columns().length > 0;
        if (hasRows) return { success: true, results: query.all(...values), meta: { changes: 0 } };
        const result = query.run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      }
      return statement;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(s => s.execute());
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return db;
}

function signIn(id) {
  context.headers = new Headers({
    'oai-authenticated-user-id': id,
    'oai-authenticated-user-email': `${id}@example.test`,
    'oai-authenticated-user-full-name': 'Real Person',
  });
}

function today() { return new Date().toISOString().slice(0, 10); }
function finishedBody() {
  const day = today();
  let state = engine.createGame(engine.seedForDay(day), 'daily');
  while (state.phase === 'planning') state = engine.defend(state);
  return { day, replay: engine.serializeGame(state) };
}
function submit(body, origin = ORIGIN) {
  return new Request(`${ORIGIN}/api/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
  });
}

test('anonymous account routes return guest metadata and reject writes without touching D1', async () => {
  context.env.DB = null;
  context.headers = new Headers();
  const player = await playerRoute.GET();
  assert.equal(player.status, 200);
  assert.match(player.headers.get('cache-control'), /no-store/);
  const data = await player.json();
  assert.equal(data.signedIn, false);
  assert.equal(data.profile, null);
  assert.equal(data.signinUrl, '/signin-with-chatgpt?return_to=%2Fplay%2Findex.html');
  const claim = await claimRoute.POST(submit(finishedBody()));
  assert.equal(claim.status, 401);
  assert.equal((await claim.json()).code, 'sign_in_required');
});

test('signed-in route claims are idempotent and isolate accounts despite submitted user IDs', async () => {
  const db = setup();
  try {
    signIn('player-a');
    const body = { ...finishedBody(), userId: 'player-b', score: 999999999 };
    const firstResponse = await claimRoute.POST(submit(body));
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.ok, true);
    assert.equal(first.alreadyClaimed, false);
    assert.equal(first.profile.daysPlayed, 1);
    assert.equal(first.profile.claims.length, 1);
    assert.notEqual(first.profile.claims[0].score, 999999999);
    const repeat = await (await claimRoute.POST(submit(body))).json();
    assert.equal(repeat.alreadyClaimed, true);
    assert.equal(repeat.improved, false);
    assert.equal(repeat.profile.daysPlayed, 1);
    assert.equal(db.prepare('SELECT user_id FROM watch_claims').get().user_id, 'player-a');
    signIn('player-b');
    const other = await (await playerRoute.GET()).json();
    assert.equal(other.profile.daysPlayed, 0);
    assert.deepEqual(other.profile.claims, []);
    assert.notEqual(other.profile.alias, first.profile.alias);
  } finally { db.close(); }
});

test('write route rejects cross-origin posts, unfinished watches and closed dates', async () => {
  const db = setup();
  try {
    signIn('player-a');
    const foreign = await claimRoute.POST(submit(finishedBody(), 'https://other.example'));
    assert.equal(foreign.status, 403);
    const day = today();
    const unfinished = { day, replay: engine.serializeGame(engine.createGame(engine.seedForDay(day), 'daily')) };
    assert.equal((await (await claimRoute.POST(submit(unfinished))).json()).code, 'unfinished_watch');
    const old = { ...finishedBody(), day: '2020-01-01' };
    assert.equal((await (await claimRoute.POST(submit(old))).json()).code, 'day_closed');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM watch_claims').get().total, 0);
  } finally { db.close(); }
});

test('public leaderboard uses aliases and never returns private identity or replay data', async () => {
  const db = setup();
  try {
    signIn('private-internal-id');
    await claimRoute.POST(submit(finishedBody()));
    context.headers = new Headers();
    const response = await leaderboardRoute.GET(new Request(`${ORIGIN}/api/leaderboard?day=${today()}`));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes('private-internal-id'), false);
    assert.equal(text.includes('example.test'), false);
    assert.equal(text.includes('Real Person'), false);
    assert.equal(text.includes('replay'), false);
    const data = JSON.parse(text);
    assert.equal(data.entries.length, 1);
    assert.match(data.entries[0].alias, /^Mariner /);
    const malformed = await leaderboardRoute.GET(new Request(`${ORIGIN}/api/leaderboard?day=2026-02-31`));
    assert.equal(malformed.status, 400);
  } finally { db.close(); }
});

test('daily API provides the same server-day seed used by claim verification', async () => {
  const response = await dailyRoute.GET();
  const data = await response.json();
  assert.equal(data.day, today());
  assert.equal(data.seed, engine.seedForDay(data.day));
  assert.equal(data.version, engine.VERSION);
  assert.equal(data.tides, engine.DAILY_TIDES);
  assert.equal(new Date(data.resetsAt).getUTCHours(), 0);
  assert.ok(new Date(data.resetsAt) > new Date(data.serverTime));
});
