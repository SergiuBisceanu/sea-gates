import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, defend, oracle, rotate, traceLight } from '../public/heliograph/engine.mjs';

function instruments(state) {
  const result = [];
  for (const [row, line] of state.board.entries()) {
    for (const [col, tile] of line.entries()) if (tile) result.push({ row, col });
  }
  return result;
}

function forecast(state, followRay = false) {
  const { ports, segments } = traceLight(state);
  let damage = 0, sunk = 0, usedLight = 0;
  let progress = 0;
  for (const ship of state.ships) {
    if (ports[ship.row] >= ship.hp) sunk++;
    else damage += ship.breach;
    usedLight += Math.min(ship.hp, ports[ship.row]);
    if (followRay) {
      let closest = 0;
      for (const seg of segments) {
        if (seg.y2 < 0 || seg.y2 >= state.board.length || seg.x2 < 0) continue;
        const distance = state.board[0].length - seg.x2 + Math.abs(seg.y2 - ship.row);
        closest = Math.max(closest, (1 + 0.1 * Math.min(ship.hp, seg.power)) / (1 + distance));
      }
      progress += 6 * closest;
    }
  }
  if (followRay) {
    const lit = new Set();
    for (const seg of segments) {
      if (state.board[seg.y2]?.[seg.x2]) lit.add(`${seg.x2},${seg.y2}`);
      if (seg.x2 > seg.x1) progress += 0.065;
    }
    progress += lit.size;
  }
  return { damage, sunk, usedLight, progress };
}

function better(a, b) {
  return a.damage < b.damage || (a.damage === b.damage &&
    (a.sunk > b.sunk || (a.sunk === b.sunk &&
      (a.usedLight > b.usedLight || (a.usedLight === b.usedLight && a.progress > b.progress + 1e-8)))));
}

// The novice follows immediate visible improvement: sinking ships first and
// useful light second. If no single turn helps, they send the current beam.
function greedy(state, followRay = false) {
  while (state.history.length < state.budget) {
    let best = state, bestScore = forecast(state, followRay);
    for (const { row, col } of instruments(state)) {
      const candidate = rotate(state, row, col);
      const score = forecast(candidate, followRay);
      if (better(score, bestScore)) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best === state) break;
    state = best;
  }
  return state;
}

// Each instrument has two orientations. Any final configuration reachable
// within the budget can be reached by turning each changed instrument once.
// Independently enumerate these subsets without consulting the Oracle.
function minimumDamage(state) {
  const pieces = instruments(state);
  let minimum = forecast(state).damage;
  function search(position, start, remaining) {
    if (!remaining || !minimum) return;
    for (let i = start; i < pieces.length; i++) {
      const {row, col} = pieces[i];
      const after = rotate(position, row, col);
      minimum = Math.min(minimum, forecast(after).damage);
      if (!minimum) return;
      search(after, i + 1, remaining - 1);
    }
  }
  search(state, 0, state.budget - state.history.length);
  return minimum;
}

function assisted(state, sample) {
  const hint = oracle(state);
  assert(hint.moves.length <= state.budget - state.history.length);
  assert.equal(hint.breaches, minimumDamage(state), 'Oracle discarded a better legal defence');
  for (const {row, col} of hint.moves) {
    const before = state.history.length;
    state = rotate(state, row, col);
    assert.equal(state.history.length, before + 1);
  }
  const result = forecast(state);
  assert.equal(result.damage, hint.breaches, 'Oracle damage forecast differs from its legal route');
  assert.equal(result.sunk, hint.sunk);
  sample.moves[state.tide - 1] += hint.moves.length;
  sample.unavoidableDamage += result.damage;
  return state;
}

function run(seed, policy, sample) {
  let state = createGame(seed);
  for (let tide = 1; state.phase === 'planning'; tide++) {
    assert(tide <= 7, 'Campaign never terminated');
    assert.equal(state.tide, tide);
    sample.layouts[tide - 1].add(JSON.stringify([state.sourceRow, state.board, state.ships]));
    if (policy === 'oracle') state = assisted(state, sample);
    if (policy === 'greedy' || policy === 'ray-reader') state = greedy(state, policy === 'ray-reader');
    const before = state.hull;
    const prediction = forecast(state);
    state = defend(state);
    assert.equal(state.lastResult.damage, prediction.damage);
    assert.equal(state.hull, Math.max(0, before - prediction.damage));
    assert.equal(state.lastResult.ships.filter(ship => ship.sunk).length, prediction.sunk);
  }
  assert(['victory', 'defeat'].includes(state.phase));
  if (state.phase === 'victory') {
    sample.wins++;
    if (state.hull === state.maxHull) sample.flawless++;
    assert(state.hull > 0);
  } else {
    assert.equal(state.hull, 0);
    sample.lossesByTide[state.tide - 1]++;
  }
  sample.finalHull += state.hull;
}

test('four legal strategies play the same hundred seeded campaigns', t => {
  const summary = {};
  for (const policy of ['idle', 'greedy', 'ray-reader', 'oracle']) {
    const sample = { wins: 0, flawless: 0, lossesByTide: Array(7).fill(0), finalHull: 0,
      moves: Array(7).fill(0), unavoidableDamage: 0, layouts: Array.from({length: 7}, () => new Set()) };
    for (let seed = 1; seed <= 100; seed++) run(seed, policy, sample);
    sample.layouts = sample.layouts.map(layouts => layouts.size);
    summary[policy] = sample;
  }
  t.diagnostic(JSON.stringify(summary));
  assert.equal(summary.oracle.wins, 100, 'Some encounters could not be survived');
  assert.equal(summary.oracle.unavoidableDamage, 0, 'Some starting encounters require a breach');
  assert.equal(summary.idle.wins, 0, 'A seed wins without turning any instrument');
});
