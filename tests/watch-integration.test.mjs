import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as engine from '../public/watch/engine.mjs';
import * as content from '../public/watch/content.mjs';
import { validateDailyClaim, utcDay as serverDay } from '../daily-watch-server/app/api/_lib/claim-policy.mjs';

const play = fileURLToPath(new URL('../public/watch/', import.meta.url));

function runWatch(day, reloadEveryOrder = false) {
  let state = engine.createGame(engine.seedForDay(day));
  while (state.phase === 'planning') {
    for (let order = 0; order < engine.ORDERS_PER_TIDE; order++) {
      const hint = engine.hint(state);
      if (!hint) break;
      const beforeReplay = engine.serializeGame(state);
      const changed = engine.swap(state, hint.from, hint.to);
      assert.notEqual(changed, state, 'A displayed suggestion must be actionable.');
      // Undo is a public action. Its abandoned move must not enter a saved replay.
      state = engine.undo(changed);
      assert.deepEqual(engine.serializeGame(state), beforeReplay);
      state = engine.swap(state, hint.from, hint.to);
      if (reloadEveryOrder) state = engine.restoreGame(JSON.stringify(engine.serializeGame(state)));
      assert.ok(state, 'A valid in-progress watch must survive a checkpoint.');
    }
    const prediction = engine.forecast(state);
    const defended = engine.defend(state);
    assert.equal(defended.hull, Math.max(0, state.hull - prediction.damage));
    state = reloadEveryOrder ? engine.restoreGame(JSON.stringify(engine.serializeGame(defended))) : defended;
    assert.ok(state);
  }
  return state;
}

test('a watch resumed after each order earns exactly the same validated reward as uninterrupted play', () => {
  for (const day of ['2026-11-04', '2026-12-31', '2028-02-29']) {
    const uninterrupted = runWatch(day);
    const resumed = runWatch(day, true);
    assert.deepEqual(engine.serializeGame(resumed), engine.serializeGame(uninterrupted));
    const body = { day, replay: engine.serializeGame(resumed) };
    const claim = validateDailyClaim(body, engine, new Date(`${day}T23:59:59.999Z`));
    assert.equal(claim.phase, uninterrupted.phase);
    assert.equal(claim.hull, uninterrupted.hull);
    assert.equal(claim.score, uninterrupted.score);
    assert.equal(claim.movesUsed, uninterrupted.movesUsed);
    assert.equal(claim.tide, uninterrupted.tide);
    assert.deepEqual(JSON.parse(claim.replayJson), body.replay);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 32768);
  }
});

test('browser and server use the same UTC watch across local midnight, year changes and leap days', () => {
  for (const instant of [
    '2027-01-01T01:59:59+02:00',
    '2027-01-01T02:00:00+02:00',
    '2028-03-01T01:59:59+02:00',
    '2028-03-01T02:00:00+02:00',
    '2026-11-04T20:30:00-08:00',
  ]) {
    const now = new Date(instant);
    const day = content.utcDay(now);
    assert.equal(day, serverDay(now));
    const state = engine.createGame(engine.seedForDay(day));
    assert.equal(content.themeForDay(day), content.DAILY_THEMES[state.seed % content.DAILY_THEMES.length]);
    assert.equal(content.formatDay(day), content.formatDay(now));
  }
});

test('the final planning checkpoint cannot be claimed as a completed reward', () => {
  const day = '2026-11-04';
  let state = engine.createGame(engine.seedForDay(day));
  while (state.tide < engine.DAILY_TIDES && state.phase === 'planning') {
    for (let order = 0; order < engine.ORDERS_PER_TIDE; order++) {
      const hint = engine.hint(state);
      if (!hint) break;
      state = engine.swap(state, hint.from, hint.to);
    }
    state = engine.defend(state);
  }
  assert.equal(state.tide, engine.DAILY_TIDES);
  assert.equal(state.phase, 'planning');
  const checkpoint = engine.serializeGame(state);
  assert.ok(engine.restoreGame(checkpoint));
  assert.throws(() => validateDailyClaim({ day, replay: checkpoint }, engine, new Date(`${day}T12:00:00Z`)), error => error.code === 'unfinished_watch');
});

function references(source, extension) {
  if (extension === '.html') {
    return [...source.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  }
  if (extension === '.css') {
    return [...source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(match => match[1]);
  }
  if (extension === '.mjs') {
    return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*[(']?\s*)["'](\.[^"']+)["']/g)].map(match => match[1]);
  }
  return [];
}

test('the complete static page dependency tree stays inside both its hosted and GitHub Pages mounts', async () => {
  for (const mount of ['/play/', '/sea-gates/watch/']) {
    const pending = [new URL('index.html', `https://example.test${mount}`)];
    const visited = new Set();
    while (pending.length) {
      const url = pending.pop();
      if (visited.has(url.href)) continue;
      visited.add(url.href);
      assert.equal(url.origin, 'https://example.test');
      assert.ok(url.pathname.startsWith(mount), `Asset escaped ${mount}: ${url.pathname}`);
      const path = resolve(play, decodeURIComponent(url.pathname.slice(mount.length)));
      assert.ok(path.startsWith(play), 'Dependency escaped the game directory.');
      assert.ok((await stat(path)).isFile(), `Missing static dependency ${path}`);
      const extension = extname(path);
      if (!['.html', '.css', '.mjs'].includes(extension)) continue;
      for (const reference of references(await readFile(path, 'utf8'), extension)) {
        if (/^(?:data:|https?:|#)/.test(reference)) continue;
        pending.push(new URL(reference, url));
      }
    }
    assert.ok(visited.size >= 6, 'The graph should include the playable client and its rules.');
  }
});

test('the page has unique control IDs and every ARIA relationship points to a real element', async () => {
  const html = await readFile(join(play, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate controls break labels and event binding.');
  for (const match of html.matchAll(/\baria-(?:labelledby|describedby|controls)=["']([^"']+)["']/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(ids.includes(id), `Unresolved ARIA relationship ${id}`);
  }
});

// Execute the real controller against a small DOM adapter. Rendering is covered
// separately by browser QA; these checks exercise storage and network behavior.
import { createContext, runInContext } from 'node:vm';
import { artifactSVG, BATTLE_DURATION } from '../public/watch/board.mjs';
import { HOSTED_ORIGIN, PUBLIC_GAME_URL } from '../public/watch/config.mjs';
import * as Transfer from '../public/watch/transfer.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

async function controller({ origin = 'https://sergiubisceanu.github.io', storage = memoryStorage(), timestamp = '2026-11-04T18:00:00Z', hash = '', fetcher } = {}) {
  const clock = { now: Date.parse(timestamp) };
  const elements = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = new Map(); this.hidden = false; this.isConnected = true; this.textContent = ''; this.open = false; this.classList = { toggle() {}, add() {}, remove() {} }; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); if (node.id) elements.set(node.id, node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this[name] = String(value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { return this.listeners.get('click')?.({ target: this }); }
    focus() {}
    closest() { return null; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.get('close')?.(); }
    remove() { if (this.id) elements.delete(this.id); }
    getBoundingClientRect() { return { left: 0, top: 0, right: 500, bottom: 500 }; }
  }
  const html = await readFile(join(play, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*\bid=["']([^"']+)["']/g)) {
    const element = new Element(match[1]); element.id = match[2]; elements.set(element.id, element);
  }
  const network = [], intervals = [], timers = new Map();
  let timerId = 0;
  class Board {
    constructor() { this.view = null; }
    render(view) { this.view = view; }
    destroy() {}
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const location = new URL('/sea-gates/watch/index.html' + hash, origin);
  const historyChanges = [], windowEvents = new Map();
  const sandbox = {
    Engine: engine, Content: content, Transfer, HarborBoard: Board, artifactSVG, BATTLE_DURATION, HOSTED_ORIGIN, PUBLIC_GAME_URL,
    console, URL, Date: ClockDate, Uint32Array, Number, String, Boolean, Set, Map, Math, JSON,
    AbortController, HTMLElement: Element,
    matchMedia: () => ({ matches: false }),
    location,
    history: { state: null, replaceState(state, title, url) { historyChanges.push(url); location.href = new URL(url, location).href; } },
    requestAnimationFrame: callback => { callback(0); return 1; },
    cancelAnimationFrame() {},
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: callback => { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    fetch: async (...args) => { network.push(args); return fetcher ? fetcher(...args) : Response.json({ error: 'Offline' }, { status: 503 }); },
    crypto,
    window: { localStorage: storage, addEventListener(name, callback) { windowEvents.set(name, callback); }, scrollTo() {} },
    document: {
      title: '', visibilityState: 'visible', activeElement: null,
      getElementById: id => elements.get(id) ?? null,
      createElement: tag => new Element(tag), createTextNode: value => ({ textContent: value }),
      addEventListener() {},
    },
  };
  const context = createContext(sandbox);
  const source = (await readFile(join(play, 'app.mjs'), 'utf8')).replace(/^import[^\n]+\n/gm, '');
  runInContext(source + '\n globalThis.inspect = { startRun, selectPiece, makeSwap, recordCompletion, safeAuthURL, betterClaim, today, progress, pendingClaims, submitPending, openHelp, signInLink, loadAccount, state: () => game, board: () => board.view, setAccount: value => { account = value; } };', context);
  return { app: context.inspect, elements, storage, network, intervals, clock, location, historyChanges, windowEvents };
}

function words(element) { return [element.textContent, ...element.children.map(words)].filter(Boolean).join(' '); }

test('GitHub play starts, saves, undoes and reviews completed runs without an account request', async () => {
  const client = await controller();
  client.elements.get('daily-play').click();
  client.app.makeSwap(9, 1);
  assert.equal(client.app.state().orders, 4);
  client.elements.get('undo-button').click();
  assert.equal(client.app.state().orders, 5);
  assert.equal(client.network.length, 0);
  const complete = runWatch('2026-11-04');
  client.storage.setItem('sea-gates.watch.v1.run.daily.2026-11-04', JSON.stringify({ v: 1, day: '2026-11-04', mode: 'daily', replay: engine.serializeGame(complete) }));
  client.app.startRun('daily', '2026-11-04');
  assert.equal(client.elements.get('modal').open, true);
  assert.match(client.elements.get('modal-title').textContent, /stands|sea found/);
  assert.equal(client.app.progress().days, 1);
  assert.equal(client.network.length, 0);
});

test('an older open tab cannot overwrite the watch saved by another tab', async () => {
  const storage = memoryStorage();
  const first = await controller({ storage }), second = await controller({ storage });
  first.app.startRun('daily', '2026-11-04');
  second.app.startRun('daily', '2026-11-04');
  first.app.makeSwap(9, 1);
  const saved = storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04');
  second.app.makeSwap(9, 1);
  assert.equal(storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04'), saved);
  assert.match(second.elements.get('save-note').textContent, /Another tab/);
});

test('UTC rollover starts a separate watch without discarding the previous unfinished run', async () => {
  const client = await controller({ timestamp: '2026-11-04T23:59:59Z' });
  client.app.startRun('daily', client.app.today());
  client.app.makeSwap(9, 1);
  const previous = client.storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04');
  client.clock.now += 2000;
  client.app.startRun('daily', client.app.today());
  assert.equal(client.app.state().seed, engine.seedForDay('2026-11-05'));
  assert.equal(client.app.state().orders, 5);
  assert.equal(client.storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04'), previous);
  client.app.startRun('daily', '2026-11-04');
  assert.equal(client.app.state().orders, 4);
});

test('empty quay selection and manual recipes describe the current engine', async () => {
  const client = await controller();
  client.app.startRun('daily', '2026-11-04');
  client.app.makeSwap(9, 1);
  assert.equal(client.app.state().board[0], null);
  client.app.selectPiece(0);
  assert.equal(client.app.board().selected, 0);
  assert.match(client.elements.get('piece-description').textContent, /empty quay/i);
  client.app.openHelp();
  const manual = words(client.elements.get('modal-body'));
  for (const meta of Object.values(engine.KINDS).filter(value => value.type === 'resource')) {
    assert.ok(manual.includes(engine.KINDS[meta.machine].name), `Missing recipe for ${meta.machine}`);
  }
});

test('unavailable authentication never becomes a /null or foreign sign-in link', async () => {
  const client = await controller({ origin: HOSTED_ORIGIN });
  for (const url of [null, undefined, '', 'https://another.example/signin', 'javascript:alert(1)']) {
    assert.equal(client.app.safeAuthURL(url), null);
  }
  assert.equal(new URL(client.app.safeAuthURL('/signin-with-chatgpt?return_to=%2Fplay%2Findex.html')).origin, HOSTED_ORIGIN);
});

test('every earned cabinet object renders with self-contained, unique SVG resources', () => {
  const seen = new Set();
  for (const reward of content.REWARDS) {
    for (const earned of [false, true]) {
      const svg = artifactSVG(reward.motif, earned);
      assert.match(svg, /^<svg /);
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
      const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      for (const id of ids) { assert.ok(!seen.has(id), `Duplicate SVG resource ${id}`); seen.add(id); }
      for (const match of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(match[1]), `Missing SVG resource ${match[1]}`);
    }
  }
});

test('a pending account save cannot erase a newer replay of the same UTC watch', async () => {
  let acknowledge;
  const client = await controller({ origin: HOSTED_ORIGIN, fetcher: (url) => {
    if (url === '/api/player') return Response.json({ signedIn: false, profile: null, day: '2026-11-04', serverTime: '2026-11-04T18:00:00Z' });
    assert.equal(url, '/api/claim');
    return new Promise(resolve => { acknowledge = resolve; });
  } });
  await new Promise(setImmediate);
  let original = engine.createGame(engine.seedForDay('2026-11-04'));
  while (original.phase === 'planning') original = engine.defend(original);
  const first = { day: '2026-11-04', replay: engine.serializeGame(original) };
  const newer = { day: '2026-11-04', replay: engine.serializeGame(runWatch('2026-11-04')) };
  client.storage.setItem('sea-gates.watch.v1.pending', JSON.stringify([first]));
  client.app.setAccount({ signedIn: true, profile: { daysPlayed: 0, claims: [] } });
  const saving = client.app.submitPending();
  assert.equal(typeof acknowledge, 'function');
  client.storage.setItem('sea-gates.watch.v1.pending', JSON.stringify([newer]));
  acknowledge(Response.json({ ok: true, profile: { daysPlayed: 1, claims: [] } }));
  await saving;
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.pending')), [newer]);
});

test('local best-run ordering agrees with the account leaderboard', async () => {
  const { app } = await controller();
  const prior = { phase: 'victory', hull: 8, score: 1000, movesUsed: 20 };
  assert.equal(app.betterClaim({ ...prior, phase: 'defeat', hull: 0, score: 100000 }, prior), false);
  assert.equal(app.betterClaim({ ...prior, hull: 9, score: 500 }, prior), true);
  assert.equal(app.betterClaim({ ...prior, score: 1001 }, prior), true);
  assert.equal(app.betterClaim({ ...prior, movesUsed: 19 }, prior), true);
  assert.equal(app.betterClaim({ ...prior, movesUsed: 21 }, prior), false);
  assert.equal(app.betterClaim({ ...prior }, prior), false);
});

test('blocked device storage still allows playable orders and an honest save notice', async () => {
  for (const storage of [null, { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }]) {
    const client = await controller({ storage });
    client.app.startRun('daily', '2026-11-04');
    client.app.makeSwap(9, 1);
    assert.equal(client.app.state().orders, 4);
    assert.equal(client.elements.get('save-note').hidden, false);
    assert.match(client.elements.get('save-note').textContent, /cannot save|could not save/);
    assert.equal(client.network.length, 0);
  }
});

function finishedPayload(day = '2026-11-04', useSuggestions = true) {
  let state = useSuggestions ? runWatch(day) : engine.createGame(engine.seedForDay(day));
  while (state.phase === 'planning') state = engine.defend(state);
  return { day, replay: engine.serializeGame(state) };
}

function watchFragment(payload) { return '#watch=' + encodeURIComponent(JSON.stringify(payload)); }
function playerReply(day = '2026-11-04', signedIn = false) {
  return Response.json({ signedIn, day, serverTime: `${day}T18:00:00Z`, signinUrl: '/signin-with-chatgpt', profile: signedIn ? { alias: 'Captain', daysPlayed: 0, claims: [] } : null });
}

test('a transferred completed watch round-trips to the exact server-verifiable replay', () => {
  const payload = finishedPayload();
  const encoded = Transfer.encodeWatchFragment(payload);
  assert.ok(encoded.startsWith('#watch='));
  assert.ok(encoded.length <= Transfer.MAX_TRANSFER_FRAGMENT_LENGTH);
  const decoded = Transfer.decodeWatchFragment(encoded, payload.day);
  assert.ok(decoded?.result.completed);
  assert.deepEqual(decoded.replay, payload.replay);
  const claim = validateDailyClaim({ day: decoded.day, replay: decoded.replay }, engine, new Date('2026-11-04T20:00:00Z'));
  assert.equal(claim.score, decoded.result.score);
  assert.equal(claim.hull, decoded.result.hull);
  assert.equal(claim.phase, decoded.result.phase);
  assert.equal(Transfer.decodeWatchFragment(encoded, '2026-11-05'), null);
});

test('transfer rejects malformed, oversized, extra-field, wrong-seed and unfinished watches', () => {
  const good = finishedPayload();
  const unfinished = { day: good.day, replay: engine.serializeGame(engine.createGame(engine.seedForDay(good.day))) };
  const invalid = [
    '', '#other=watch', '#watch=%E0%A4%A', '#watch=null', '#watch=[]',
    '#watch=' + 'x'.repeat(Transfer.MAX_TRANSFER_FRAGMENT_LENGTH),
    watchFragment({ ...good, userId: 'someone-else' }),
    watchFragment({ ...good, day: '2026-02-30' }),
    watchFragment({ ...good, replay: { ...good.replay, seed: good.replay.seed + 1 } }),
    watchFragment({ ...good, replay: { ...good.replay, mode: 'voyage' } }),
    watchFragment(unfinished),
  ];
  for (const fragment of invalid) assert.equal(Transfer.decodeWatchFragment(fragment), null);
  assert.equal(Transfer.encodeWatchFragment(unfinished), '');
});

test('the GitHub account link carries only today’s completed watch', async () => {
  const client = await controller();
  const payload = finishedPayload();
  assert.equal(new URL(client.app.signInLink()).hash, '');
  client.app.startRun('daily', payload.day);
  assert.equal(new URL(client.app.signInLink()).hash, '');
  client.storage.setItem('sea-gates.watch.v1.run.daily.' + payload.day, JSON.stringify({ v: 1, day: payload.day, mode: 'daily', replay: payload.replay }));
  const link = new URL(client.app.signInLink());
  assert.equal(link.origin, HOSTED_ORIGIN);
  assert.deepEqual(Transfer.decodeWatchFragment(link.hash, payload.day).replay, payload.replay);
  client.clock.now = Date.parse('2026-11-05T00:00:01Z');
  assert.equal(new URL(client.app.signInLink()).hash, '');
  const foreign = await controller({ origin: 'https://unrelated.example', storage: client.storage });
  assert.equal(new URL(foreign.app.signInLink()).hash, '');
});

test('the receiver clears the fragment and waits for the server date before queuing a transfer', async () => {
  let answer;
  const payload = finishedPayload();
  const client = await controller({ origin: HOSTED_ORIGIN, hash: Transfer.encodeWatchFragment(payload), fetcher: url => {
    assert.equal(url, '/api/player');
    return new Promise(resolve => { answer = resolve; });
  } });
  assert.equal(client.location.hash, '');
  assert.equal(client.historyChanges.length, 1);
  assert.equal(client.storage.getItem('sea-gates.watch.v1.pending'), null);
  assert.equal(client.storage.getItem('sea-gates.watch.v1.run.daily.' + payload.day), null);
  answer(playerReply());
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.pending')), [payload]);
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.run.daily.' + payload.day)).replay, payload.replay);
});

test('expired or malformed incoming watches cannot become pending account claims', async () => {
  for (const hash of [Transfer.encodeWatchFragment(finishedPayload()), '#watch=broken']) {
    const client = await controller({ origin: HOSTED_ORIGIN, hash, fetcher: () => playerReply('2026-11-05', true) });
    await new Promise(setImmediate);
    assert.equal(client.location.hash, '');
    assert.equal(client.storage.getItem('sea-gates.watch.v1.pending'), null);
    assert.equal(client.network.filter(([url]) => url === '/api/claim').length, 0);
    assert.match(words(client.elements.get('modal-body')), /different UTC day|could not be read/);
  }
});

test('incoming results preserve an active hosted watch and a stronger unsynced result', async () => {
  const storage = memoryStorage();
  const active = engine.swap(engine.createGame(engine.seedForDay('2026-11-04')), 9, 1);
  const best = finishedPayload(), weaker = finishedPayload('2026-11-04', false);
  assert.ok(Transfer.betterResult(engine.replayRun(best.replay).result, engine.replayRun(weaker.replay).result));
  storage.setItem('sea-gates.watch.v1.run.daily.2026-11-04', JSON.stringify({ v: 1, day: '2026-11-04', mode: 'daily', replay: engine.serializeGame(active) }));
  storage.setItem('sea-gates.watch.v1.view', JSON.stringify({ screen: 'game', mode: 'daily', day: '2026-11-04' }));
  storage.setItem('sea-gates.watch.v1.pending', JSON.stringify([best]));
  const client = await controller({ origin: HOSTED_ORIGIN, storage, hash: Transfer.encodeWatchFragment(weaker), fetcher: () => playerReply() });
  await new Promise(setImmediate);
  assert.deepEqual(engine.serializeGame(client.app.state()), engine.serializeGame(active));
  assert.deepEqual(JSON.parse(storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04')).replay, engine.serializeGame(active));
  assert.deepEqual(JSON.parse(storage.getItem('sea-gates.watch.v1.pending')), [best]);
  assert.equal(client.elements.get('game-screen').hidden, false);
});

test('a signed-in receiver verifies the transferred result without replaying the watch', async () => {
  const payload = finishedPayload();
  const client = await controller({ origin: HOSTED_ORIGIN, hash: Transfer.encodeWatchFragment(payload), fetcher: (url, options) => {
    if (url === '/api/player') return playerReply(payload.day, true);
    assert.equal(url, '/api/claim');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, payload);
    const verified = validateDailyClaim(body, engine, new Date('2026-11-04T18:00:00Z'));
    return Response.json({ ok: true, profile: { alias: 'Captain', daysPlayed: 1, claims: [verified] } });
  } });
  await new Promise(setImmediate);
  assert.equal(client.app.state(), null);
  assert.equal(client.app.progress().days, 1);
  assert.equal(client.network.filter(([url]) => url === '/api/claim').length, 1);
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.pending')), []);
  assert.match(words(client.elements.get('modal-body')), /verified|up to date/i);
});

test('an account outage retains the transfer in memory for a same-day retry', async () => {
  let available = false;
  const payload = finishedPayload();
  const client = await controller({ origin: HOSTED_ORIGIN, hash: Transfer.encodeWatchFragment(payload), fetcher: () => available ? playerReply() : Response.json({ error: 'Offline' }, { status: 503 }) });
  await new Promise(setImmediate);
  assert.equal(client.storage.getItem('sea-gates.watch.v1.pending'), null);
  available = true;
  await client.app.loadAccount();
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.pending')), [payload]);
});

test('opening a transfer in an existing hosted tab preserves its active watch', async () => {
  const client = await controller({ origin: HOSTED_ORIGIN, fetcher: () => playerReply() });
  await new Promise(setImmediate);
  client.app.startRun('daily', '2026-11-04');
  client.app.makeSwap(9, 1);
  const active = engine.serializeGame(client.app.state());
  const checkpoint = client.storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04');
  const payload = finishedPayload();
  client.location.hash = Transfer.encodeWatchFragment(payload);
  client.windowEvents.get('hashchange')();
  assert.equal(client.location.hash, '');
  await new Promise(setImmediate);
  assert.deepEqual(engine.serializeGame(client.app.state()), active);
  assert.equal(client.storage.getItem('sea-gates.watch.v1.run.daily.2026-11-04'), checkpoint);
  assert.deepEqual(JSON.parse(client.storage.getItem('sea-gates.watch.v1.pending')), [payload]);
  assert.equal(client.elements.get('game-screen').hidden, false);
  client.location.hash = '#watch=invalid';
  client.windowEvents.get('hashchange')();
  await new Promise(setImmediate);
  assert.equal(client.location.hash, '');
  assert.match(words(client.elements.get('modal-body')), /could not be read/);
  assert.deepEqual(engine.serializeGame(client.app.state()), active);
});
