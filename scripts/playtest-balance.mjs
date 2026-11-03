// Run with Node 24+: node scripts/playtest-balance.mjs [greedy|planner|both] [seeds] [last tide]
// Both players use the public controls. Neither looks at future supplies or replays battles.
import assert from "node:assert/strict";
import {
  BOARD_COLS, BOARD_ROWS, WATER_COLS, actOnLandCell, bossChannelForTide, channelForLandCol,
  createInitialGame, isWaterCol, machineForMaterials, selectCargoAt, startBattle, stepBattle,
} from "../app/game-engine.ts";

const [policy = "both", seedCount = "8", maxTide = "55"] = process.argv.slice(2);
assert(["greedy", "planner", "both"].includes(policy), "Use greedy, planner, or both");
for (const value of [seedCount, maxTide]) {
  assert(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0, "Expected a positive integer");
}
const cells = [];
for (let row = 0; row < BOARD_ROWS; row++) {
  for (let col = 0; col < BOARD_COLS; col++) if (!isWaterCol(col)) cells.push([row, col]);
}
const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function* legalMoves(state) {
  for (const [row, col] of cells) {
    if (!state.board[row][col]) continue;
    const selected = actOnLandCell(state, row, col);
    for (const [dy, dx] of neighbors) {
      const changed = actOnLandCell(selected, row + dy, col + dx);
      if (changed.actions === state.actions - 1) yield changed;
    }
  }
  for (const cargo of state.cargo) {
    const selected = selectCargoAt(state, cargo.row, cargo.channel);
    for (const side of [-1, 1]) {
      const changed = actOnLandCell(selected, cargo.row, WATER_COLS[cargo.channel] + side);
      if (changed.actions === state.actions - 1) yield changed;
    }
  }
}

function positionKey(state) {
  // Cooldowns reset at the horn. Cargo position and material are fixed for a given ID.
  return cells.map(([row, col]) => {
    const piece = state.board[row][col];
    if (!piece) return "_";
    return piece.kind === "machine" ? piece.machine + piece.tier : piece.material;
  }).join(",") + "#" + state.cargo.map(item => item.id).join(",");
}

// These are planner preferences, not stats from the game. Reward reach, an Arm against
// heavy hulls, support near artillery, and enough damage in each channel before stacking.
const strength = {
  catapult: [0, 1.3, 5, 17],
  siphon: [0, 0.85, 2.8, 8.2],
  arm: [0, 1.1, 3.4, 9],
  automaton: [0, 0.40, 1.8, 6],
};
function evaluate(state) {
  const total = [0, 0], damage = [0, 0], support = [0, 0], arms = [0, 0];
  let stores = 0, adjacency = 0;
  for (const [row, col] of cells) {
    const piece = state.board[row][col];
    if (!piece) continue;
    if (piece.kind === "material") {
      stores += 0.18;
      if (neighbors.some(([dy, dx]) => {
        const neighbor = state.board[row + dy]?.[col + dx];
        return neighbor?.kind === "material" && machineForMaterials(piece.material, neighbor.material);
      })) stores += 0.15;
      continue;
    }
    const channel = channelForLandCol(col);
    const middle = 1 - Math.abs(2.65 - row) * 0.07 / piece.tier;
    const output = strength[piece.machine][piece.tier] * middle;
    total[channel] += output;
    if (piece.machine === "arm") arms[channel] += output;
    else if (piece.machine === "automaton") {
      support[channel] += output;
      if (piece.tier === 3 && (col === 3 || col === 4)) {
        total[1 - channel] += 0.7 * output;
        support[1 - channel] += 0.7 * output;
      }
      for (const [dy, dx] of neighbors) {
        const neighbor = state.board[row + dy]?.[col + dx];
        if (neighbor?.kind === "machine" && neighbor.machine !== "automaton") adjacency += 0.12 * piece.tier;
      }
    } else damage[channel] += output;
  }
  const coverage = ([west, east]) => Math.log1p(west) + Math.log1p(east);
  const bossLane = bossChannelForTide(state.tide, state.runSeed);
  const bossDefense = bossLane === null ? 0 : 4 * Math.log1p(damage[bossLane]) +
    2 * Math.log1p(arms[bossLane]) + 2.5 * Math.log1p(support[bossLane]);
  return bossDefense + 5 * coverage(total) + 5.5 * coverage(damage) + 1.6 * coverage(arms) +
    1.5 * coverage(support) + 0.3 * (total[0] + total[1]) + Math.min(adjacency, 3) + 0.6 * stores;
}

function choosePosition(state, width) {
  let best = state, bestScore = evaluate(state), frontier = [state];
  const scores = new Map();
  for (let depth = 0; depth < state.actions; depth++) {
    const candidates = new Map();
    for (const candidate of frontier) {
      for (const next of legalMoves(candidate)) {
        const key = positionKey(next);
        if (candidates.has(key)) continue;
        const score = scores.get(key) ?? evaluate(next);
        scores.set(key, score);
        candidates.set(key, { next, score });
      }
    }
    const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
    if (!ranked.length) break;
    const leading = ranked[0];
    if (leading.score > bestScore + 0.000001) {
      best = leading.next;
      bestScore = leading.score;
    } else if (width === 1) break; // Greedy player only spends immediately useful moves.
    frontier = ranked.slice(0, width).map(item => item.next);
  }
  return best;
}

function play(seed, width) {
  let state = createInitialGame(seed), turns = 0, firstLanding = null, firstTideHealth = null;
  let composition = {};
  while (state.phase === "planning" && state.tide <= Number(maxTide)) {
    assert.equal(state.actions, 5);
    assert(state.harbor > 0);
    turns++;
    state = choosePosition(state, width);
    composition = {};
    for (const piece of state.board.flat()) {
      if (piece?.kind === "machine") {
        const key = piece.machine + "-" + piece.tier;
        composition[key] = (composition[key] ?? 0) + 1;
      }
    }
    const tide = state.tide;
    state = startBattle(state);
    let steps = 0;
    while (state.phase === "battle") {
      assert(++steps <= 10800, "Battle did not terminate within six simulated minutes");
      state = stepBattle(state, 1 / 30);
      assert(Number.isFinite(state.harbor) && state.harbor >= 0 && state.harbor <= state.maxHarbor);
      assert(state.ships.every(ship => Number.isFinite(ship.y) && Number.isFinite(ship.hp)),
        "An enemy has invalid position or health");
      if (!firstLanding && state.landingsThisBattle) firstLanding = tide;
    }
    if (tide === 1) firstTideHealth = state.harbor;
    assert(state.phase === "gameover" || (state.phase === "planning" && state.tide === tide + 1));
  }
  assert.equal(firstTideHealth, 6, "This policy must be able to defend the opening tide flawlessly");
  return { seed, turns, terminal: state.phase, harbor: state.harbor, firstTideHealth, firstLanding, composition };
}

for (const current of policy === "both" ? ["greedy", "planner"] : [policy]) {
  for (let seed = 1; seed <= Number(seedCount); seed++) {
    console.log(JSON.stringify({ policy: current, ...play(seed, current === "greedy" ? 1 : 12) }));
  }
}
