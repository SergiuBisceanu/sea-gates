import { createGame, defend, hint, isLand, swap, serializeGame, replayRun, seedForDay } from '../public/watch/engine.mjs';

const count = Number(process.argv[2] || 100);
const calendarStart = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[3] || '') ? process.argv[3] : null;
const first = calendarStart ? seedForDay(calendarStart) : Number(process.argv[3] || 1);
const mode = process.argv[4] || 'daily';
const seeds = Array.from({ length: count }, (_, index) => {
  if (!calendarStart) return first + index;
  const date = new Date(`${calendarStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return seedForDay(date.toISOString().slice(0, 10));
});
const results = [];

function materialValue(board) {
  return board.reduce((sum, piece) => sum + (piece ? [0, 10, 33, 109][piece.tier] : 0), 0);
}

function greedy(state) {
  let best = null;
  let value = materialValue(state.board);
  for (let from = 0; from < state.board.length; from++) if (isLand(from)) {
    for (const to of [from - 8, from + 1, from + 8, from - 1]) {
      const after = swap(state, from, to);
      if (after === state) continue;
      const candidate = materialValue(after.board);
      if (candidate > value) { best = { from, to }; value = candidate; }
    }
  }
  return best;
}

for (const policy of ['none', 'material', 'hint']) {
  const records = [];
  const started = performance.now();
  for (const seed of seeds) {
    let state = createGame(seed, mode);
    while (state.phase === 'planning') {
      if (policy !== 'none') for (let order = 0; order < 5; order++) {
        const move = policy === 'hint' ? hint(state) : greedy(state);
        if (!move) break;
        state = swap(state, move.from, move.to);
      }
      state = defend(state);
    }
    const validation = replayRun(serializeGame(state));
    if (!validation.valid || validation.result.score !== state.score || validation.result.hull !== state.hull) throw new Error(`Replay mismatch for ${policy}, seed ${seed}`);
    records.push({ seed, phase: state.phase, tide: state.tide, hull: state.hull, moves: state.movesUsed });
  }
  results.push({ policy, runs: count, wins: records.filter(record => record.phase === 'victory').length,
    mastery: records.filter(record => record.hull === 12).length,
    meanHull: +(records.reduce((sum, record) => sum + record.hull, 0) / count).toFixed(2),
    meanTide: +(records.reduce((sum, record) => sum + record.tide, 0) / count).toFixed(2),
    bestTide: Math.max(...records.map(record => record.tide)),
    meanMoves: +(records.reduce((sum, record) => sum + record.moves, 0) / count).toFixed(2),
    milliseconds: Math.round(performance.now() - started),
    losses: records.filter(record => record.phase !== 'victory').map(record => record.seed),
    records: process.env.WATCH_BALANCE_DETAILS ? records : undefined });
}
console.log(JSON.stringify({ mode, first, calendarStart, count, results }, null, 2));
