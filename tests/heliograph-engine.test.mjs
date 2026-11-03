import test from "node:test";
import assert from "node:assert/strict";
import {
  COLS, ROWS, createGame, traceLight, rotate, undo, resetPlan, defend, oracle, serializeGame, restoreGame,
} from "../public/heliograph/engine.mjs";

const empty = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const mirror = tilt => ({ kind: "mirror", tilt });
const splitter = tilt => ({ kind: "splitter", tilt });
const seed2718 = [[15], [12, 17], [4, 14], [13, 18], [8, 12, 13], [2, 7, 16], [2, 14, 17]];
const playMoves = (state, cells) => cells.reduce((s, id) => rotate(s, Math.floor(id / COLS), id % COLS), state);

test("light leaves the east port in its own lane by default", () => {
  const { segments, ports } = traceLight({ board: empty(), sourceRow: 2 });
  assert.deepEqual(ports, [0, 0, 4, 0]);
  assert.equal(segments.length, COLS + 1);
  assert.deepEqual(segments[0], { x1: -1, y1: 2, x2: 0, y2: 2, power: 4 });
  assert.deepEqual(segments.at(-1), { x1: 4, y1: 2, x2: 5, y2: 2, power: 4 });
});

test("mirrors route north and south and beams exiting another edge cannot damage a port", () => {
  for (const [from, to, tilt] of [[0, 3, "\\"], [3, 0, "/"]]) {
    const board = empty();
    board[from][2] = mirror(tilt);
    const lost = traceLight({ board, sourceRow: from });
    assert.deepEqual(lost.ports, [0, 0, 0, 0]);
    board[to][2] = mirror(tilt);
    const redirected = traceLight({ board, sourceRow: from });
    assert.equal(redirected.ports[to], 4);
  }
});

test("a splitter divides power between straight and reflected paths without inventing light", () => {
  const board = empty();
  board[1][1] = splitter("\\");
  board[3][1] = mirror("\\");
  assert.deepEqual(traceLight({ board, sourceRow: 1 }).ports, [0, 2, 0, 2]);
  board[3][3] = splitter("/");
  board[0][3] = mirror("/");
  assert.deepEqual(traceLight({ board, sourceRow: 1 }).ports, [1, 2, 0, 1]);
});

test("a loop terminates without duplicating power at a port", () => {
  const board = empty();
  board[1][1] = splitter("/");
  board[1][3] = mirror("\\");
  board[3][3] = mirror("/");
  board[3][1] = mirror("\\");
  const { segments, ports } = traceLight({ board, sourceRow: 1 });
  assert.ok(segments.length > COLS + ROWS && segments.length < 80);
  assert.deepEqual(ports, [0, 0, 0, 0]);
  const escaped = segments.filter(s => s.x2 < 0 || s.x2 >= COLS || s.y2 < 0 || s.y2 >= ROWS);
  assert.ok(escaped.reduce((sum, ray) => sum + ray.power, 0) <= 4);
});

test("turns are immutable, consume only legal orders, and undo and reset refund them exactly", () => {
  const original = createGame(2718);
  const snapshot = structuredClone(original);
  const { row, col } = oracle(original).move;
  for (const [r, c] of [[-1, 0], [ROWS, 1], [1, COLS], [NaN, 0], [1.5, 1], [0, 0]]) {
    assert.equal(rotate(original, r, c), original);
  }
  const one = rotate(original, row, col);
  const two = rotate(one, row, col);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(two.board, original.board);
  assert.equal(two.orders, 0);
  assert.equal(rotate(two, row, col), two);
  assert.deepEqual(undo(two), one);
  assert.deepEqual(resetPlan(two), original);
  assert.equal(undo(original), original);
});

test("a seven-tide winning route replays from public moves without consulting the Oracle", () => {
  let state = createGame(2718);
  for (const [i, moves] of seed2718.entries()) {
    assert.equal(state.tide, i + 1);
    state = playMoves(state, moves);
    assert.equal(state.history.length, moves.length);
    const expectedLight = traceLight(state).ports;
    state = defend(state);
    assert.equal(state.lastResult.tide, i + 1);
    assert.deepEqual(state.lastResult.ports, expectedLight);
    assert.ok(state.lastResult.ships.every(ship => ship.sunk && ship.hit >= ship.hp));
    assert.equal(state.lastResult.damage, 0);
  }
  assert.equal(state.phase, "victory");
  assert.equal(state.hull, 4);
  assert.equal(state.lastResult.ships[0].kind, "flagship");
  assert.equal(state.lastResult.ships[0].hit, 4);
  assert.equal(defend(state), state);
  assert.equal(resetPlan(state), state);
});

test("a general victory needs a standing harbor; ships that escape inflict their listed breach", () => {
  let state = createGame(2718);
  while (state.phase === "planning") state = defend(state);
  assert.equal(state.phase, "defeat");
  assert.equal(state.tide, 3);
  assert.equal(state.hull, 0);
  assert.ok(state.lastResult.damage > 0);
  assert.equal(rotate(state, 1, 1), state);
  let damaged = createGame(2718);
  for (const moves of seed2718.slice(0, -1)) damaged = defend(playMoves(damaged, moves));
  damaged = defend(damaged);
  assert.equal(damaged.phase, "victory");
  assert.equal(damaged.hull, 1);
  assert.equal(damaged.lastResult.damage, 3);
  assert.equal(damaged.lastResult.ships[0].sunk, false);
});

test("the Oracle can advise firing now and never recommends a rotation when no orders remain", () => {
  const game = createGame(2718);
  const solved = playMoves(game, seed2718[0]);
  const originalPlan = oracle(game);
  assert.equal(originalPlan.moves.length, 1);
  assert.equal(originalPlan.breaches, 0);
  assert.equal(oracle(solved).move, null);
  assert.equal(oracle(solved).sunk, 1);
  const spent = playMoves(game, [seed2718[0][0], seed2718[0][0]]);
  const forecast = oracle(spent);
  assert.equal(forecast.move, null);
  assert.equal(forecast.breaches, defend(spent).lastResult.damage);
  assert.equal(forecast.breaches, 1);
});

test("seeded variants vary both routes and threats and every proposed order is attainable", () => {
  const signatures = new Set();
  for (const seed of [0, 1, 25, 357, 2718, 0x7fffffff, 0xffffffff]) {
    let state = createGame(seed);
    assert.deepEqual(state, createGame(seed));
    signatures.add(JSON.stringify([state.sourceRow, state.board, state.ships[0].row]));
    while (state.phase === "planning") {
      let hints = 0;
      while (true) {
        const hint = oracle(state);
        assert.equal(hint.breaches, 0);
        if (!hint.move) break;
        state = rotate(state, hint.move.row, hint.move.col);
        assert.ok(++hints <= state.budget);
      }
      assert.ok(hints >= 1 && hints <= 4);
      state = defend(state);
      assert.equal(state.lastResult.damage, 0);
    }
    assert.equal(state.phase, "victory");
  }
  assert.equal(signatures.size, 7);
});

test("checkpoints replay through the same public controls and survive mid-tide and terminal recovery", () => {
  let state = createGame(2718);
  for (const moves of seed2718) {
    state = playMoves(state, moves);
    assert.deepEqual(restoreGame(JSON.stringify(serializeGame(state))), state);
    state = defend(state);
    assert.deepEqual(restoreGame(serializeGame(state)), state);
  }
  for (const raw of [null, "", "{", "x".repeat(20000), {}, { ...serializeGame(state), version: 2 },
    { version: 1, seed: -1, completed: [], pending: [] },
    { version: 1, seed: 2718, completed: [], pending: [{ row: 0, col: 0 }] },
    { version: 1, seed: 2718, completed: [[], [], [], []], pending: [] },
    { ...serializeGame(state), pending: [{ row: 0, col: 0 }] }]) {
    assert.equal(restoreGame(raw), null);
  }
});
