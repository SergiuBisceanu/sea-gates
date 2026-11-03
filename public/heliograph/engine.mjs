// All positions are zero-based. The sun enters from the west; port I is north.
export const COLS = 5;
export const ROWS = 4;
export const LAST_TIDE = 7;
export const LANES = ["I", "II", "III", "IV"];
const STARTING_HULL = 4;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const REFLECT = { "/": [3, 2, 1, 0], "\\": [1, 0, 3, 2] };
const VESSELS = {
  skiff: { name: "Scout Skiff", hp: 1, breach: 1 },
  raider: { name: "Oared Raider", hp: 2, breach: 1 },
  ironclad: { name: "Bronze Ironclad", hp: 3, breach: 2 },
  flagship: { name: "The Black Flagship", hp: 4, breach: 3 },
};
const TIDES = [
  { course: ["bend"], fleet: ["skiff"], turns: 1, budget: 2 },
  { course: ["bend", "bend"], fleet: ["ironclad"], turns: 2, budget: 3 },
  { course: ["fork"], fleet: ["skiff", "raider"], turns: 2, budget: 3 },
  { course: ["bend", "bend"], fleet: ["ironclad"], turns: 2, budget: 3, decoy: "splitter" },
  { course: ["bend", "fork"], fleet: ["raider", "raider"], turns: 3, budget: 4 },
  { course: ["fork", "bend"], fleet: ["raider", "raider"], turns: 3, budget: 4 },
  { course: ["bend", "bend", "bend"], fleet: ["flagship"], turns: 3, budget: 4, decoy: "splitter" },
];

function generator(seed, tide) {
  let s = (seed ^ Math.imul(tide, 0x9e3779b1)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), s | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 0x100000000;
  };
}

function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function inside(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) &&
    row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function toggle(board, row, col) {
  const rows = [...board];
  rows[row] = [...board[row]];
  const cell = board[row][col];
  rows[row][col] = { ...cell, tilt: cell.tilt === "/" ? "\\" : "/" };
  return rows;
}

/** Each traversal of a directed cell is drawn once per ray. A ray retracing
 * its own closed loop dissipates; two independent arrivals at a port add. */
export function traceLight({ board, sourceRow }) {
  const segments = [];
  const ports = Array(ROWS).fill(0);
  const rays = [{ x: -1, y: sourceRow, dir: 0, power: 4, seen: new Set() }];
  while (rays.length) {
    let { x, y, dir, power, seen } = rays.pop();
    for (;;) {
      const [dx, dy] = DIRECTIONS[dir];
      const nx = x + dx, ny = y + dy;
      segments.push({ x1: x, y1: y, x2: nx, y2: ny, power });
      if (!inside(ny, nx)) {
        if (nx === COLS && ny >= 0 && ny < ROWS) ports[ny] += power;
        break;
      }
      const key = (ny * COLS + nx) * 4 + dir;
      if (seen.has(key)) break;
      seen.add(key);
      x = nx;
      y = ny;
      const cell = board[y][x];
      if (!cell) continue;
      if (cell.kind === "splitter") {
        power /= 2;
        rays.push({ x, y, dir, power, seen: new Set(seen) });
      }
      dir = REFLECT[cell.tilt][dir];
    }
  }
  return { segments, ports };
}

function assess(ships, ports) {
  const hits = ships.map(ship => ({ ...ship, hit: ports[ship.row], sunk: ports[ship.row] >= ship.hp }));
  return {
    ships: hits,
    damage: hits.reduce((sum, ship) => sum + (ship.sunk ? 0 : ship.breach), 0),
    kills: hits.filter(ship => ship.sunk).length,
  };
}

function optics(board) {
  const cells = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) if (board[row][col]) cells.push({ row, col });
  }
  return cells;
}

// An optic has exactly two tilts. Turning one twice cannot improve a plan, so
// the bounded search only needs subsets, visited in ascending order of cost.
function bestPlan(state) {
  const cells = optics(state.board);
  let best;
  for (let depth = 0; depth <= Math.min(state.orders, cells.length); depth++) {
    function visit(board, start, moves) {
      if (moves.length === depth) {
        const { damage, kills } = assess(state.ships, traceLight({ ...state, board }).ports);
        if (!best || damage < best.damage || (damage === best.damage && kills > best.kills)) {
          best = { damage, kills, moves: [...moves] };
        }
        return damage === 0;
      }
      const end = cells.length - (depth - moves.length);
      for (let i = start; i <= end; i++) {
        const cell = cells[i];
        if (visit(toggle(board, cell.row, cell.col), i + 1, [...moves, cell])) return true;
      }
      return false;
    }
    if (visit(state.board, 0, [])) break;
  }
  return best;
}

export function oracle(state) {
  if (state.phase !== "planning") {
    return { move: null, moves: [], breaches: 0, sunk: 0, message: "The campaign is over." };
  }
  const best = bestPlan(state);
  const move = best.moves[0] ?? null;
  let message;
  if (move) message = `Turn the optic in row ${LANES[move.row]}, column ${move.col + 1}.`;
  else if (!best.damage) message = "Fire now. Every incoming ship is in the light.";
  else message = "Fire for the best remaining result, or undo orders to find a stronger line.";
  return { move, moves: best.moves, breaches: best.damage, sunk: best.kills, message };
}

function combinations(items, size, start = 0) {
  if (!size) return [[]];
  const all = [];
  for (let i = start; i <= items.length - size; i++) {
    for (const rest of combinations(items, size - 1, i + 1)) all.push([items[i], ...rest]);
  }
  return all;
}

function puzzle(seed, tide) {
  const rules = TIDES[tide - 1];
  const random = generator(seed, tide);
  const rows = shuffled([0, 1, 2, 3], random);
  const cols = shuffled([0, 1, 2, 3, 4], random).slice(0, rules.course.length).sort((a, b) => a - b);
  const solved = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const sourceRow = rows[0];
  let rayRow = sourceRow;
  const lanes = [];

  // The intended route bends at successively more easterly columns. A fork
  // leaves one beam in its current lane and the other continues the course.
  rules.course.forEach((leg, i) => {
    const nextRow = rows[i + 1], col = cols[i];
    const tilt = nextRow > rayRow ? "\\" : "/";
    solved[rayRow][col] = { kind: leg === "fork" ? "splitter" : "mirror", tilt };
    solved[nextRow][col] = { kind: "mirror", tilt };
    if (leg === "fork") lanes.push(rayRow);
    rayRow = nextRow;
  });
  lanes.push(rayRow);
  const routeCells = optics(solved);
  if (rules.decoy) {
    const path = traceLight({ board: solved, sourceRow }).segments;
    const dark = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!solved[row][col] && !path.some(s => s.x2 === col && s.y2 === row)) dark.push({ row, col });
      }
    }
    if (dark.length) {
      const chosen = dark[Math.floor(random() * dark.length)];
      solved[chosen.row][chosen.col] = { kind: rules.decoy, tilt: random() < 0.5 ? "/" : "\\" };
    }
  }
  const ships = lanes.map((row, i) => {
    const kind = rules.fleet[i];
    return { ...VESSELS[kind], kind, row, boss: kind === "flagship" };
  });
  const base = { sourceRow, ships, budget: rules.budget, orders: rules.budget };
  // Scramble useful mirrors, checking the visible puzzle has no cheaper
  // shortcut than the intended opening cost. The known solution is retained
  // even if different seed geometry permits a shorter alternate route.
  let fallback, bestDistance = -1;
  for (const group of shuffled(combinations(routeCells, rules.turns), random)) {
    const board = group.reduce((grid, cell) => toggle(grid, cell.row, cell.col), solved);
    const plan = bestPlan({ ...base, board, orders: rules.turns });
    const distance = plan.moves.length;
    if (distance > bestDistance) {
      bestDistance = distance;
      fallback = board;
    }
    if (distance === rules.turns) break;
  }
  return { ...base, board: fallback };
}

export function createGame(seed = Math.floor(Math.random() * 0x100000000)) {
  seed = Number(seed) >>> 0;
  return { seed, tide: 1, hull: STARTING_HULL, maxHull: STARTING_HULL, phase: "planning",
    ...puzzle(seed, 1), history: [], completed: [], lastResult: null };
}

export function rotate(state, row, col) {
  if (state.phase !== "planning" || state.orders <= 0 || !inside(row, col) || !state.board[row][col]) return state;
  return { ...state, board: toggle(state.board, row, col), orders: state.orders - 1, history: [...state.history, { row, col }] };
}

export function undo(state) {
  if (state.phase !== "planning" || state.history.length === 0) return state;
  const { row, col } = state.history.at(-1);
  return { ...state, board: toggle(state.board, row, col), orders: state.orders + 1, history: state.history.slice(0, -1) };
}

export function resetPlan(state) {
  let result = state;
  if (result.phase === "planning") while (result.history.length) result = undo(result);
  return result;
}

export function defend(state) {
  if (state.phase !== "planning") return state;
  const { ports } = traceLight(state);
  const { ships, damage } = assess(state.ships, ports);
  const lastResult = { tide: state.tide, ports, ships, damage };
  const hull = Math.max(0, state.hull - damage);
  const completed = [...state.completed, state.history];
  if (!hull || state.tide === LAST_TIDE) {
    return { ...state, hull, lastResult, completed, phase: hull ? "victory" : "defeat" };
  }
  const tide = state.tide + 1;
  return { ...state, ...puzzle(state.seed, tide), tide, hull, history: [], completed, lastResult };
}

export function serializeGame(state) {
  return { version: 1, seed: state.seed, completed: state.completed.map(turn => turn.map(cell => ({ ...cell }))),
    pending: state.phase === "planning" ? state.history.map(cell => ({ ...cell })) : [] };
}

export function restoreGame(raw) {
  try {
    if (typeof raw === "string") {
      if (!raw.length || raw.length > 16384) return null;
      raw = JSON.parse(raw);
    }
    if (!raw || raw.version !== 1 || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff ||
      !Array.isArray(raw.completed) || raw.completed.length > LAST_TIDE || !Array.isArray(raw.pending)) return null;
    let state = createGame(raw.seed);
    function replay(moves) {
      if (!Array.isArray(moves) || moves.length > state.orders) return false;
      for (const cell of moves) {
        if (!cell || !inside(cell.row, cell.col)) return false;
        const next = rotate(state, cell.row, cell.col);
        if (next === state) return false;
        state = next;
      }
      return true;
    }
    for (const moves of raw.completed) {
      if (state.phase !== "planning" || !replay(moves)) return null;
      state = defend(state);
    }
    return replay(raw.pending) ? state : null;
  } catch {
    return null;
  }
}
