import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSION, COLS, ROWS, WATER, KINDS, createGame, isLand, seedForDay, swap, undo, defend, forecast, hint, serializeGame, restoreGame, replayRun, waveFor, weaponRange } from '../public/play/engine.mjs';

function play(seed, policy = 'hint', mode = 'daily') {
  let state = createGame(seed, mode);
  while (state.phase === 'planning') {
    if (policy === 'hint') for (let order = 0; order < 5; order++) {
      const action = hint(state);
      if (!action) break;
      state = swap(state, action.from, action.to);
    }
    state = defend(state);
  }
  return state;
}

function emptyState(seed = 1) {
  return { ...createGame(seed), board: Array(COLS * ROWS).fill(null) };
}

test('the same seed creates a full, identical board with exactly two water channels', () => {
  const first = createGame(20261104);
  assert.deepEqual(first, createGame(20261104));
  assert.equal(first.board.length, 48);
  assert.equal(first.board.filter(Boolean).length, 36);
  for (let index = 0; index < first.board.length; index++) {
    assert.equal(first.board[index] === null, WATER.includes(index % COLS));
    if (first.board[index]) assert.ok(KINDS[first.board[index].kind]);
  }
  assert.equal(first.orders, 5);
  assert.equal(first.phase, 'planning');
  assert.equal(first.hull, first.maxHull);
  assert.throws(() => createGame(-1));
  assert.throws(() => createGame(1, 'ranked'));
});

test('the opening timber match consumes precisely three and creates a gun at the destination', () => {
  const before = createGame(9);
  const snapshot = structuredClone(before);
  const after = swap(before, 9, 1);
  assert.deepEqual(after.board[1], { kind: 'ballista', tier: 1 });
  assert.equal(after.board[0], null);
  assert.equal(after.board[8], null);
  assert.equal(after.board[9].kind, 'stone');
  assert.equal(after.orders, 4);
  assert.equal(after.movesUsed, 1);
  assert.deepEqual(after.lastAction.merges[0].consumed, [1, 0, 8]);
  assert.deepEqual(before, snapshot, 'a legal action never mutates its input');
});

test('water, diagonal, distant, same-piece and malformed swaps do not consume orders', () => {
  const state = createGame(1);
  for (const pair of [[0, 2], [0, 9], [0, 16], [-1, 0], [0, 48], [0, 8], [NaN, 1], ['0', 1]]) assert.equal(swap(state, ...pair), state);
  assert.equal(isLand(2), false);
  assert.equal(isLand(47), true);
});

test('undo restores all consumed pieces, actions, and move totals and stops at the tide boundary', () => {
  const original = createGame(19);
  const after = swap(original, 9, 1);
  const restored = undo(after);
  assert.deepEqual(restored, original);
  assert.equal(undo(original), original);
  const nextTide = defend(after);
  assert.equal(nextTide.tide, 2);
  assert.equal(nextTide.orders, 5);
  assert.equal(undo(nextTide), nextTide);
  assert.equal(nextTide.board.filter(Boolean).length, 36);
});

test('dawn restores a possible resource match in a deadlocked bank without moving machines', () => {
  const state = createGame(27);
  const cells = Array.from({ length: 6 }, (_, row) => [row * 8, row * 8 + 1]).flat();
  const pieces = ['timber', 'timber', 'stone', 'stone', 'bronze', 'bronze', 'wine', 'wine', 'ballista', 'ballista', 'catapult', 'catapult'];
  cells.forEach((index, offset) => { state.board[index] = { kind: pieces[offset], tier: offset < 8 ? 0 : 1 }; });
  const after = defend(state);
  assert.equal(after.phase, 'planning');
  const counts = new Map();
  for (const index of cells.slice(0, 8)) counts.set(after.board[index].kind, (counts.get(after.board[index].kind) || 0) + 1);
  assert.ok([...counts.values()].some(count => count >= 3));
  assert.ok(cells.slice(0, 8).filter(index => after.board[index].kind !== state.board[index].kind).length <= 2);
  for (const index of cells.slice(8)) assert.deepEqual(after.board[index], state.board[index]);
});

test('a crowded voyage bank gets supplies that unlock its existing machine pair', () => {
  const state = createGame(27, 'voyage');
  const cells = Array.from({ length: 6 }, (_, row) => [row * 8, row * 8 + 1]).flat();
  const kinds = ['wine', 'wine', 'wine', 'ballista', 'ballista', 'catapult', 'catapult', 'claw', 'claw', 'siphon', 'siphon', 'catapult'];
  cells.forEach((index, offset) => { state.board[index] = { kind: kinds[offset], tier: offset < 3 ? 0 : offset === 11 ? 2 : 1 }; });
  const after = defend(state);
  assert.ok(cells.slice(0, 3).every(index => after.board[index].kind === 'timber'));
  for (const index of cells.slice(3)) assert.deepEqual(after.board[index], state.board[index]);
  const daily = defend({ ...state, mode: 'daily' });
  assert.ok(cells.slice(0, 3).every(index => daily.board[index].kind === 'wine'));
});

test('five orders are a hard limit and non-matching positional swaps are legal', () => {
  let state = createGame(10);
  for (let index = 0; index < 5; index++) {
    let moved = false;
    for (let from = 0; from < state.board.length && !moved; from++) for (const to of [from + 1, from + 8]) {
      const after = swap(state, from, to);
      if (after !== state) { state = after; moved = true; break; }
    }
    assert.equal(moved, true);
  }
  assert.equal(state.orders, 0);
  assert.equal(state.movesUsed, 5);
  assert.equal(swap(state, 0, 1), state);
  assert.equal(undo(state).orders, 1);
});

test('connected groups can chain upgrades while tier three remains the maximum', () => {
  const state = emptyState();
  state.board[25] = { kind: 'ballista', tier: 2 };
  for (const index of [17, 33, 41]) state.board[index] = { kind: 'ballista', tier: 1 };
  state.board[24] = { kind: 'ballista', tier: 2 };
  const after = swap(state, 17, 25);
  assert.deepEqual(after.board[25], { kind: 'ballista', tier: 3 });
  assert.equal(after.lastAction.merges.length, 2);
  assert.deepEqual(after.lastAction.merges.map(merge => merge.tier), [2, 3]);
  assert.equal(after.board.filter(Boolean).length, 1);
  const max = emptyState();
  for (const index of [0, 8, 9]) max.board[index] = { kind: 'ballista', tier: 3 };
  max.board[1] = { kind: 'stone', tier: 0 };
  const unchanged = swap(max, 9, 1);
  assert.equal(unchanged.lastAction.merges.length, 0);
  assert.equal(unchanged.board.filter(piece => piece?.tier === 3).length, 3);
});

test('forecasts are deterministic, pure, and agree exactly with resolved combat', () => {
  const state = swap(createGame(20261104), 9, 1);
  const snapshot = structuredClone(state);
  const prediction = forecast(state);
  assert.deepEqual(forecast(structuredClone(state)), prediction);
  assert.deepEqual(state, snapshot);
  const after = defend(state);
  assert.equal(after.hull, prediction.remainingHull);
  assert.deepEqual(after.lastBattle.enemies, prediction.enemies);
  assert.deepEqual(after.lastBattle.events, prediction.events);
  assert.ok(prediction.ticks > 0 && prediction.ticks <= 240);
  for (const event of prediction.events) {
    assert.ok(event.tick >= 0 && event.tick < prediction.ticks);
    assert.ok(prediction.enemies.some(ship => ship.id === event.shipId));
  }
});

test('all Claws share one boss-wrench flag and never capture or lethally wrench a boss', () => {
  const state = emptyState(3);
  state.tide = 7;
  for (let index = 0; index < state.board.length; index++) if (isLand(index)) state.board[index] = { kind: 'claw', tier: 3 };
  const prediction = forecast(state);
  const boss = prediction.enemies.find(ship => ship.boss);
  const wrenches = prediction.events.filter(event => event.type === 'wrench' && event.shipId === boss.id);
  assert.equal(wrenches.length, 1);
  assert.ok(wrenches[0].damage > 0 && wrenches[0].damage < boss.maxHp);
  assert.ok(boss.hp >= 1);
  assert.equal(boss.sunk, false);
  assert.equal(boss.breached, true);
  assert.equal(prediction.events.filter(event => event.type === 'capture' && event.shipId === boss.id).length, 0);
});

test('Siphon shots bypass armor and can hit multiple ships in a close formation', () => {
  const state = emptyState(3);
  state.tide = 6;
  state.board[25] = { kind: 'siphon', tier: 2 };
  state.board[30] = { kind: 'siphon', tier: 2 };
  const prediction = forecast(state);
  const shots = prediction.events.filter(event => event.type === 'shot');
  assert.ok(shots.length > 0);
  assert.ok(prediction.enemies.some(ship => ship.armor > 0));
  for (const shot of shots) assert.ok(Math.abs(shot.damage - 2.7 * 2.2) < 1e-9);
  const sameTick = new Map();
  for (const shot of shots) {
    const key = `${shot.tick}:${shot.from.x}:${shot.from.y}`;
    sameTick.set(key, (sameTick.get(key) || 0) + 1);
  }
  assert.ok([...sameTick.values()].some(value => value > 1));
});

test('daily themes produce their declared differences and boss lanes are forecast', () => {
  const base = { ...createGame(7), tide: 5 };
  const swift = waveFor({ ...base, seed: 8 });
  assert.ok(swift.filter((_, index) => index % 2 === 0).every(ship => ship.kind === 'skiff'));
  assert.ok(waveFor({ ...base, seed: 9 }).filter((_, index) => index % 2 === 0).every(ship => ship.kind === 'armored'));
  assert.equal(waveFor({ ...base, seed: 10 })[1].spawn, 2);
  assert.ok(waveFor({ ...base, seed: 11 }).every((ship, index) => ship.lane === WATER[index % 2]));
  assert.equal(waveFor({ ...base, seed: 12 })[1].kind, 'wardship');
  assert.ok(waveFor({ ...base, seed: 13 }).every(ship => ship.kind !== 'skiff'));
  assert.ok(WATER.includes(forecast({ ...base, tide: 7 }).bossLane));
});

test('a complete legal daily victory replays exactly and terminal runs cannot continue', () => {
  const state = play(1);
  assert.equal(state.phase, 'victory');
  assert.equal(state.tide, 7);
  const encoded = serializeGame(state);
  assert.equal(encoded.turns.length, 7);
  assert.ok(encoded.turns.every(turn => turn.defended));
  const replay = replayRun(encoded);
  assert.equal(replay.valid, true);
  assert.deepEqual(serializeGame(replay.state), encoded);
  assert.equal(replay.result.score, state.score);
  assert.equal(replay.result.hull, state.hull);
  assert.equal(replay.result.movesUsed, state.movesUsed);
  assert.equal(replay.result.mastery, state.hull === 12);
  assert.equal(defend(state), state);
  assert.equal(swap(state, 0, 1), state);
  assert.equal(undo(state), state);
});

test('a badly defended run loses, is still complete, and cannot claim victory or mastery', () => {
  const state = play(2, 'none');
  assert.equal(state.phase, 'defeat');
  assert.equal(state.hull, 0);
  const replay = replayRun(serializeGame(state));
  assert.equal(replay.result.completed, true);
  assert.equal(replay.result.victory, false);
  assert.equal(replay.result.mastery, false);
});

test('save restores a pending plan, including legal undo, without trusting board or scores', () => {
  const state = swap(defend(swap(createGame(2718), 9, 1)), 9, 1);
  const saved = serializeGame(state);
  const restored = restoreGame(JSON.stringify(saved));
  assert.deepEqual(restored, state);
  assert.deepEqual(undo(restored), undo(state));
  assert.equal(replayRun(saved).result.completed, false);
  assert.equal(restoreGame({ ...saved, score: 1000000 }), null);
  assert.equal(restoreGame({ ...saved, hull: 12 }), null);
});

test('bounded replay validation rejects malformed actions, false statistics, and extra turns', () => {
  const valid = serializeGame(createGame(1));
  const bad = [null, [], {}, '{', 'x'.repeat(64001),
    { ...valid, version: VERSION + 1 }, { ...valid, seed: -1 }, { ...valid, seed: 1.2 }, { ...valid, mode: 'cheat' },
    { ...valid, turns: [] }, { ...valid, turns: Array(8).fill({ swaps: [], defended: true }) },
    { ...valid, turns: [{ swaps: [[0, 2]], defended: true }] },
    { ...valid, turns: [{ swaps: [[0, 8]], defended: true }] },
    { ...valid, turns: [{ swaps: [[0, 1, 9]], defended: true }] },
    { ...valid, turns: [{ swaps: [['9', 1]], defended: true }] },
    { ...valid, turns: [{ swaps: Array(6).fill([9, 1]), defended: true }] },
    { ...valid, turns: [{ swaps: [], defended: false }, { swaps: [], defended: true }] },
    { ...valid, turns: [{ swaps: [], defended: 'true' }] },
    { ...valid, turns: [{ swaps: [], defended: true, hull: 12 }] },
  ];
  for (const input of bad) {
    assert.equal(restoreGame(input), null);
    assert.equal(replayRun(input).valid, false);
  }
  const lost = serializeGame(play(2, 'none'));
  lost.turns.push({ swaps: [], defended: true });
  assert.equal(replayRun(lost).valid, false);
});

test('calendar seeds are timezone-free and reject nonexistent dates', () => {
  assert.equal(seedForDay('2026-11-04'), 20261104);
  assert.equal(seedForDay('2028-02-29'), 20280229);
  for (const bad of ['2026-02-29', '2026-11-31', '2026-00-01', '2026-13-01', '2026-1-04', '2019-01-01', null]) assert.throws(() => seedForDay(bad));
});

test('voyage bosses recur every five tides, scale into the late campaign, and cap replay length', () => {
  const state = createGame(5, 'voyage');
  assert.equal(waveFor({ ...state, tide: 4 }).some(ship => ship.boss), false);
  const early = waveFor({ ...state, tide: 5 }).find(ship => ship.boss);
  const late = waveFor({ ...state, tide: 50 }).find(ship => ship.boss);
  assert.ok(late.maxHp > early.maxHp * 3);
  assert.equal(late.breach, 6);
  assert.equal(replayRun({ ...serializeGame(state), turns: Array(151).fill({ swaps: [], defended: true }) }).valid, false);
});

test('the archived 152-move legal voyage reaches the fiftieth tide before its final defeat', async () => {
  const fixture = JSON.parse(await readFile(new URL('./voyage-50-seed-21.json', import.meta.url), 'utf8'));
  const replay = replayRun(fixture);
  assert.equal(replay.valid, true);
  assert.equal(replay.state.mode, 'voyage');
  assert.equal(replay.state.seed, 21);
  assert.equal(replay.state.tide, 50);
  assert.equal(replay.state.phase, 'defeat');
  assert.equal(replay.state.movesUsed, 152);
  assert.equal(replay.state.lastBattle.hullBefore, 4);
  assert.equal(replay.state.hull, 0);
  assert.deepEqual(serializeGame(replay.state), fixture);
});

test('the renderer receives the exact combat range and no range for supplies', () => {
  assert.equal(weaponRange(null), null);
  assert.equal(weaponRange({ kind: 'stone', tier: 0 }), null);
  assert.equal(weaponRange({ kind: 'ballista', tier: 4 }), null);
  assert.ok(Math.abs(weaponRange({ kind: 'ballista', tier: 1 }) - 3.2) < 1e-9);
  assert.ok(Math.abs(weaponRange({ kind: 'siphon', tier: 3 }) - 2.4) < 1e-9);
});
