/**
 * The Sea Gates · Daily Watch.
 * Pure, deterministic rules shared by the browser and the reward validator.
 * No clock, network, DOM, mutable random source, or unlock affects a run.
 */
export const VERSION = 1;
export const COLS = 8;
export const ROWS = 6;
export const WATER = Object.freeze([2, 5]);
export const DAILY_TIDES = 7;
export const MAX_TIDES = 150;
export const ORDERS_PER_TIDE = 5;
export const KINDS = Object.freeze({
  timber: { name: 'Timber', label: 'Timber', color: '#b17d48', type: 'resource', machine: 'ballista', description: 'Join three timber bundles to build a Ballista.' },
  stone: { name: 'Limestone', label: 'Stone', color: '#d5c7a7', type: 'resource', machine: 'catapult', description: 'Join three limestone blocks to build a Catapult.' },
  bronze: { name: 'Bronze', label: 'Bronze', color: '#b28544', type: 'resource', machine: 'claw', description: 'Join three bronze ingots to build an Archimedean Claw.' },
  wine: { name: 'Wine', label: 'Wine', color: '#9b5363', type: 'resource', machine: 'siphon', description: 'Join three wine jars to build a Fire Siphon.' },
  ballista: { name: 'Ballista', label: 'Ballista', color: '#dbbd83', type: 'machine', description: 'Long-range, quick single-target fire. Excellent against light hulls. Armor reduces its damage.' },
  catapult: { name: 'Catapult', label: 'Catapult', color: '#b6bcaf', type: 'machine', description: 'Long-range crushing shots splash nearby ships and pierce one armor. Slow reload.' },
  claw: { name: 'Archimedean Claw', label: 'Claw', color: '#d7a958', type: 'machine', description: 'Short range. Captures ships up to its tier in mass. A boss can be wrenched only once, non-lethally, across all Claws.' },
  siphon: { name: 'Fire Siphon', label: 'Siphon', color: '#e79b59', type: 'machine', description: 'Short-range fire hits a cluster and bypasses armor. Especially useful against escorted ships.' },
});

const RESOURCES = ['timber', 'stone', 'bronze', 'wine'];
const MAX_REPLAY_BYTES = 64_000;
const DIRECTIONS = [-COLS, 1, COLS, -1];
const forecastCache = new WeakMap();
const SHIPS = Object.freeze({
  skiff: { name: 'Boarding skiff', hp: 6, armor: 0, mass: 1, speed: .155, breach: 1, points: 30 },
  raider: { name: 'Raiding galley', hp: 11, armor: 0, mass: 2, speed: .124, breach: 2, points: 50 },
  armored: { name: 'Bronze trireme', hp: 16, armor: 2, mass: 3, speed: .105, breach: 2, points: 80 },
  wardship: { name: 'Aegis escort', hp: 14, armor: 1, mass: 3, speed: .113, breach: 2, points: 100 },
  boss: { name: 'The Iron Ketos', hp: 78, armor: 2, mass: 99, speed: .095, breach: 4, points: 300 },
});

function mix(seed, salt) {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let x = Math.imul(value ^ (value >>> 15), value | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedForDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError('Use a calendar date in YYYY-MM-DD format.');
  const [year, month, date] = day.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 2020 || month < 1 || month > 12 || date < 1 || date > lengths[month - 1]) throw new RangeError('Invalid challenge date.');
  return year * 10000 + month * 100 + date;
}

export function isLand(index) {
  return Number.isInteger(index) && index >= 0 && index < COLS * ROWS && !WATER.includes(index % COLS);
}

function neighbors(index) {
  return DIRECTIONS.map(delta => index + delta).filter(other => isLand(other) && Math.abs(other % COLS - index % COLS) + Math.abs(Math.floor(other / COLS) - Math.floor(index / COLS)) === 1);
}

function same(a, b) {
  return a != null && b != null && a.kind === b.kind && a.tier === b.tier;
}

function cloneBoard(board) {
  return board.map(piece => piece && { ...piece });
}

function replenish(board, seed, tide, mode = 'daily') {
  const result = cloneBoard(board);
  const next = random(mix(seed, 1000 + tide));
  for (let index = 0; index < result.length; index++) {
    const choice = RESOURCES[Math.floor(next() * RESOURCES.length)];
    if (isLand(index) && !result[index]) result[index] = { kind: choice, tier: 0 };
  }
  // Refresh spare supplies to prevent common deadlocks in disconnected banks.
  // Only a bank with no possible resource match or machine upgrade is refreshed.
  // Machines stay where the player put them. Ordinary refreshes change at most
  // two supplies; a crowded voyage bank may renew its last three together.
  for (const columns of [[0, 1], [3, 4], [6, 7]]) {
    const cells = Array.from({ length: ROWS }, (_, row) => columns.map(col => row * COLS + col)).flat();
    const counts = new Map();
    for (const index of cells) {
      const piece = result[index];
      if (piece && piece.tier < 3) {
        const key = `${piece.kind}:${piece.tier}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const supplies = cells.filter(index => result[index]?.tier === 0);
    if (mode === 'voyage' && supplies.length === 3 && ![...counts].some(([key, count]) => !key.endsWith(':0') && count >= 3)) {
      // A long voyage can otherwise strand its last two supplies permanently.
      // Supply an existing machine pair before the final resource match is spent,
      // so the next construction opens an upgrade and returns room to the bank.
      const partner = RESOURCES.find(kind => (counts.get(`${KINDS[kind].machine}:1`) || 0) === 2);
      if (partner) {
        for (const index of supplies) result[index] = { kind: partner, tier: 0 };
        continue;
      }
    }
    if ([...counts.values()].some(count => count >= 3)) continue;
    if (supplies.length < 3) continue;
    const priority = [...RESOURCES].sort((a, b) => (counts.get(`${b}:0`) || 0) - (counts.get(`${a}:0`) || 0));
    const kind = priority[0];
    let needed = 3 - (counts.get(`${kind}:0`) || 0);
    const offset = Math.floor(next() * supplies.length);
    for (let step = 0; step < supplies.length && needed > 0; step++) {
      const index = supplies[(offset + step) % supplies.length];
      if (result[index].kind !== kind) { result[index] = { kind, tier: 0 }; needed--; }
    }
  }
  return result;
}

export function createGame(seed = 2718, mode = 'daily') {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be an unsigned 32-bit integer.');
  if (mode !== 'daily' && mode !== 'voyage') throw new TypeError('Unknown voyage mode.');
  const board = replenish(Array(COLS * ROWS).fill(null), seed, 1, mode);
  // A visible first match. Moving 9 → 1 joins the three timber pieces at 1, 0, 8.
  for (const index of [0, 8, 9]) board[index] = { kind: 'timber', tier: 0 };
  board[1] = { kind: 'stone', tier: 0 };
  board[25] = { kind: 'ballista', tier: 1 };
  board[30] = { kind: 'catapult', tier: 1 };
  board[43] = { kind: 'bronze', tier: 0 };
  board[44] = { kind: 'siphon', tier: 1 };
  return { version: VERSION, seed, mode, tide: 1, hull: 12, maxHull: 12, orders: ORDERS_PER_TIDE, board, phase: 'planning', score: 0, movesUsed: 0, lastBattle: null, history: [], _undo: [], _turns: [], lastAction: null };
}

function groupAt(board, index) {
  const piece = board[index];
  if (!piece || piece.tier >= 3) return [];
  const found = [index];
  for (let cursor = 0; cursor < found.length; cursor++) {
    for (const neighbor of neighbors(found[cursor])) {
      if (!found.includes(neighbor) && same(piece, board[neighbor])) found.push(neighbor);
    }
  }
  return found;
}

function mergeAt(board, index, merges) {
  for (let depth = 0; depth < 3; depth++) {
    const group = groupAt(board, index);
    if (group.length < 3) return;
    const old = board[index];
    const consumed = group.slice(0, 3);
    for (const cell of consumed) board[cell] = null;
    board[index] = { kind: old.tier === 0 ? KINDS[old.kind].machine : old.kind, tier: old.tier + 1 };
    merges.push({ at: index, consumed, kind: board[index].kind, tier: board[index].tier });
  }
}

export function swap(state, from, to) {
  if (!state || state.phase !== 'planning' || state.orders <= 0 || !isLand(from) || !isLand(to) || !neighbors(from).includes(to)) return state;
  if ((!state.board[from] && !state.board[to]) || same(state.board[from], state.board[to])) return state;
  const board = cloneBoard(state.board);
  [board[from], board[to]] = [board[to], board[from]];
  const merges = [];
  mergeAt(board, to, merges);
  mergeAt(board, from, merges);
  return { ...state, board, orders: state.orders - 1, movesUsed: state.movesUsed + 1,
    history: [...state.history, [from, to]],
    _undo: [...state._undo, { board: state.board, lastAction: state.lastAction }],
    lastAction: { from, to, merges } };
}

export function undo(state) {
  if (!state || state.phase !== 'planning' || !state._undo.length) return state;
  const previous = state._undo[state._undo.length - 1];
  return { ...state, board: previous.board, orders: state.orders + 1, movesUsed: state.movesUsed - 1,
    history: state.history.slice(0, -1), _undo: state._undo.slice(0, -1), lastAction: previous.lastAction };
}

export function waveFor(state) {
  const { seed, tide, mode } = state;
  const next = random(mix(seed, tide * 79));
  const theme = seed % 7;
  const isBoss = mode === 'daily' ? tide === DAILY_TIDES : tide % 5 === 0;
  const count = Math.min(16, tide + 1);
  const age = Math.max(0, tide - 7);
  const dailyPressure = mode === 'daily' ? 1 + Math.max(0, tide - 3) * .2 : 1;
  const escalation = dailyPressure * (1 + age * .052 + age * age * .0017);
  const bossLane = WATER[(Math.floor(seed / 7) + Math.floor(tide / 5)) % 2];
  const ships = [];
  for (let number = 0; number < count; number++) {
    let kind = 'skiff';
    const roll = next();
    if (tide >= 2 && roll > .38) kind = 'raider';
    if (tide >= 3 && roll > .72) kind = 'armored';
    if (tide >= 4 && roll > .9) kind = 'wardship';
    if (theme === 1 && number % 2 === 0) kind = 'skiff';
    if (theme === 2 && tide >= 3 && number % 2 === 0) kind = 'armored';
    if (theme === 5 && tide >= 3 && number === 1) kind = 'wardship';
    if (theme === 6 && tide >= 2 && kind === 'skiff') kind = 'raider';
    if (isBoss && number === count - 1) kind = 'boss';
    const base = SHIPS[kind];
    let lane = WATER[Math.floor(next() * 2)];
    if (theme === 4) lane = WATER[number % 2];
    if (kind === 'boss') lane = bossLane;
    const hp = Math.ceil((base.hp + (kind === 'boss' ? Math.max(0, tide - 7) * 2 : Math.min(tide - 1, 8) * .8)) * escalation);
    ships.push({ id: `t${tide}s${number}`, kind, name: base.name, lane, x: lane, y: -.7, hp, maxHp: hp,
      armor: base.armor + (tide > 25 && kind === 'armored' ? Math.floor((tide - 25) / 20) + 1 : 0),
      mass: base.mass, speed: base.speed * (theme === 1 ? 1.14 : 1) * (1 + Math.min(.24, age * .003)),
      spawn: number * (theme === 3 ? 2 : 5), breach: kind === 'boss' && tide >= 50 ? 6 : base.breach,
      boss: kind === 'boss', points: base.points, wrenched: false, sunk: false, breached: false, slowUntil: -1 });
  }
  return ships;
}

function weapon(piece) {
  const tier = piece.tier;
  const power = [0, 1, 2.2, 4.8][tier];
  if (piece.kind === 'ballista') return { range: 3.05 + tier * .15, damage: 2.8 * power, cooldown: 6, targets: 1 };
  if (piece.kind === 'catapult') return { range: 3.55 + tier * .2, damage: 4.2 * power, cooldown: 11, targets: 2 + tier };
  if (piece.kind === 'siphon') return { range: 1.8 + tier * .2, damage: 2.7 * power, cooldown: 7, targets: 1 + tier };
  return { range: 1.4 + tier * .18, damage: 2 * power, cooldown: 13 - tier, targets: 1 };
}

export function weaponRange(piece) {
  return piece && KINDS[piece.kind]?.type === 'machine' && Number.isInteger(piece.tier) && piece.tier >= 1 && piece.tier <= 3 ? weapon(piece).range : null;
}

function simulate(state, collectEvents) {
  const enemies = waveFor(state);
  const events = [];
  const emit = event => { if (collectEvents) events.push(event); };
  const towers = state.board.flatMap((piece, index) => piece && piece.tier > 0 ? [{ ...piece, x: index % COLS, y: Math.floor(index / COLS), index, nextFire: 0, ...weapon(piece) }] : []);
  let damage = 0;
  let score = 0;
  let tick = 0;
  const alive = ship => !ship.sunk && !ship.breached && ship.spawn <= tick;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const activeCount = () => enemies.filter(ship => !ship.sunk && !ship.breached).length;
  function sink(ship, reason) {
    ship.hp = 0;
    ship.sunk = true;
    score += ship.points;
    emit({ tick, type: 'sink', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, reason });
  }
  for (; tick < 240 && activeCount(); tick++) {
    for (const ship of enemies) {
      if (!alive(ship)) continue;
      if (ship.spawn === tick) emit({ tick, type: 'spawn', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, hp: ship.hp });
      ship.y += ship.speed * (tick < ship.slowUntil ? .55 : 1);
      if (tick % 2 === 0) emit({ tick, type: 'move', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, hp: ship.hp });
    }
    for (const tower of towers) {
      if (tower.nextFire > tick) continue;
      const targets = enemies.filter(ship => alive(ship) && distance(tower, ship) <= tower.range + 1e-8 && !(tower.kind === 'claw' && ship.boss && ship.wrenched))
        .sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : 1));
      if (!targets.length) continue;
      const target = targets[0];
      tower.nextFire = tick + tower.cooldown;
      const from = { x: tower.x, y: tower.y };
      if (tower.kind === 'claw') {
        if (!target.boss && target.mass <= tower.tier) {
          emit({ tick, type: 'capture', shipId: target.id, kind: tower.kind, from, to: { x: target.x, y: target.y }, damage: target.hp, hp: 0 });
          sink(target, 'capture');
        } else {
          // The flag is on the ship. No other Claw may wrench this boss again.
          const hit = target.boss ? Math.min(target.hp - 1, Math.ceil(target.hp * [.0, .18, .27, .36][tower.tier])) : tower.damage;
          target.hp = Math.max(target.boss ? 1 : 0, target.hp - hit);
          target.slowUntil = Math.max(target.slowUntil, tick + 8 + tower.tier * 2);
          if (target.boss) target.wrenched = true;
          emit({ tick, type: 'wrench', shipId: target.id, kind: tower.kind, from, to: { x: target.x, y: target.y }, damage: hit, hp: target.hp, boss: target.boss });
          if (target.hp <= 0) sink(target, 'wrench');
        }
        continue;
      }
      const victims = tower.kind === 'ballista' ? [target] : [target, ...enemies.filter(ship => ship !== target && alive(ship) && distance(ship, target) <= (tower.kind === 'siphon' ? 1.3 : .85)).sort((a, b) => distance(a, target) - distance(b, target))].slice(0, tower.targets);
      for (const victim of victims) {
        const screened = !victim.boss && enemies.some(escort => escort !== victim && escort.kind === 'wardship' && alive(escort) && tick >= escort.slowUntil && distance(escort, victim) <= 1.5);
        const armor = victim.armor + (screened ? 2 : 0);
        const hit = tower.kind === 'siphon' ? tower.damage : Math.max(.5, tower.damage - Math.max(0, armor - (tower.kind === 'catapult' ? 1 : 0)));
        victim.hp = Math.max(0, Math.round((victim.hp - hit) * 1000) / 1000);
        emit({ tick, type: 'shot', shipId: victim.id, kind: tower.kind, from, to: { x: victim.x, y: victim.y }, damage: hit, hp: victim.hp, screened });
        if (victim.hp <= 0) sink(victim, tower.kind);
      }
    }
    for (const ship of enemies) {
      if (alive(ship) && ship.y >= 6.2) {
        ship.breached = true;
        damage += ship.breach;
        emit({ tick, type: 'breach', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, damage: ship.breach, hp: ship.hp });
      }
    }
  }
  // A bounded fail-safe also makes malicious or later altered rules finite.
  for (const ship of enemies) if (!ship.sunk && !ship.breached) {
    ship.breached = true;
    damage += ship.breach;
    emit({ tick: tick - 1, type: 'breach', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, damage: ship.breach, hp: ship.hp });
  }
  return { enemies, events, ticks: Math.max(1, tick), damage, sunk: enemies.filter(ship => ship.sunk).length, total: enemies.length, remainingHull: Math.max(0, state.hull - damage), score, bossLane: enemies.find(ship => ship.boss)?.lane ?? null };
}

export function forecast(state) {
  if (!forecastCache.has(state)) forecastCache.set(state, simulate(state, true));
  return forecastCache.get(state);
}

export function defend(state) {
  if (!state || state.phase !== 'planning') return state;
  const result = forecast(state);
  const hull = Math.max(0, state.hull - result.damage);
  const finished = state.mode === 'daily' ? state.tide >= DAILY_TIDES : state.tide >= MAX_TIDES;
  const phase = hull <= 0 ? 'defeat' : finished ? 'victory' : 'planning';
  const nextTide = phase === 'planning' ? state.tide + 1 : state.tide;
  return { ...state, hull, phase, tide: nextTide, orders: phase === 'planning' ? ORDERS_PER_TIDE : 0,
    board: phase === 'planning' ? replenish(state.board, state.seed, nextTide, state.mode) : state.board,
    score: state.score + result.score + (hull > 0 ? 100 : 0),
    lastBattle: { ...result, tide: state.tide, hullBefore: state.hull, hullAfter: hull },
    _turns: [...state._turns, { swaps: state.history.map(pair => [...pair]), defended: true }],
    history: [], _undo: [], lastAction: null };
}

function boardValue(board) {
  let value = 0;
  for (let index = 0; index < board.length; index++) {
    const piece = board[index];
    if (!piece) continue;
    if (piece.tier > 0) {
      const shore = Math.min(...WATER.map(col => Math.abs(index % COLS - col)));
      const rangeFactor = (piece.kind === 'claw' || piece.kind === 'siphon') && shore > 1 ? .48 : 1;
      value += [0, 10, 33, 109][piece.tier] * rangeFactor;
    } else {
      value += .13;
      for (const neighbor of neighbors(index)) if (neighbor > index && same(piece, board[neighbor])) value += .28;
    }
  }
  return value;
}

export function hint(state) {
  if (!state || state.phase !== 'planning' || state.orders <= 0) return null;
  const candidates = [];
  const baseline = simulate(state, false);
  const currentValue = boardValue(state.board);
  for (let from = 0; from < state.board.length; from++) {
    if (!isLand(from)) continue;
    for (const to of neighbors(from)) {
      const next = swap(state, from, to);
      if (next === state) continue;
      candidates.push({ from, to, state: next, value: boardValue(next.board), merges: next.lastAction.merges });
    }
  }
  candidates.sort((a, b) => b.value - a.value || a.from - b.from || a.to - b.to);
  // Resolve exact combat for the strongest constructions and positional moves.
  const shortlist = candidates.slice(0, 14);
  for (const candidate of candidates) {
    const piece = state.board[candidate.from];
    if (piece?.tier > 0 && !shortlist.includes(candidate)) shortlist.push(candidate);
  }
  let best = null;
  for (const candidate of shortlist) {
    const prediction = simulate(candidate.state, false);
    const rating = (baseline.damage - prediction.damage) * 22 + (prediction.sunk - baseline.sunk) * 4 + candidate.value - currentValue;
    if (!best || rating > best.rating + 1e-8) best = { ...candidate, prediction, rating };
  }
  // Once immediate builds run out, consider a bounded two-move construction.
  // This prevents advice from stalling before a useful upgrade that needs setup.
  // Combat is evaluated only for the best construction from each first move.
  if (state.orders >= 2 && (!best || best.rating < 2)) {
    const setups = [];
    for (const first of candidates) {
      let nextBest = null;
      let nextValue = currentValue + 1;
      for (let from = 0; from < state.board.length; from++) {
        if (!isLand(from)) continue;
        for (const to of neighbors(from)) {
          if (from === first.to && to === first.from) continue;
          const second = swap(first.state, from, to);
          if (second === first.state || !second.lastAction.merges.length) continue;
          const value = boardValue(second.board);
          if (value > nextValue) { nextBest = second; nextValue = value; }
        }
      }
      if (nextBest) setups.push({ ...first, future: nextBest, futureValue: nextValue });
    }
    setups.sort((a, b) => b.futureValue - a.futureValue || a.from - b.from || a.to - b.to);
    for (const setup of setups.slice(0, 8)) {
      const prediction = simulate(setup.future, false);
      const rating = ((baseline.damage - prediction.damage) * 22 + (prediction.sunk - baseline.sunk) * 4 + setup.futureValue - currentValue) * .55;
      if (!best || rating > best.rating + 1e-8) best = { ...setup, prediction, rating, setup: true };
    }
  }
  if (!best || best.rating <= .01) return null;
  const merge = best.merges.at(-1);
  const reason = best.setup ? 'Set up a match with two orders. This move brings the pieces together.' : merge ? `Join three to ${merge.tier === 1 ? 'build' : 'upgrade'} ${KINDS[merge.kind].name}.` : best.prediction.damage < baseline.damage ? 'Move this defense into the threatened channel.' : 'Bring matching supplies together for a later build.';
  return { from: best.from, to: best.to, reason, expectedDamage: best.setup ? simulate(best.state, false).damage : best.prediction.damage };
}

export function serializeGame(state) {
  const turns = state._turns.map(turn => ({ swaps: turn.swaps.map(pair => [...pair]), defended: true }));
  if (state.phase === 'planning') turns.push({ swaps: state.history.map(pair => [...pair]), defended: false });
  return { version: VERSION, seed: state.seed, mode: state.mode, turns };
}

function decodeReplay(input) {
  if (typeof input === 'string') {
    if (input.length > MAX_REPLAY_BYTES) throw new RangeError('Replay is too large.');
    input = JSON.parse(input);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid replay.');
  const allowed = ['version', 'seed', 'mode', 'turns'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError('Unexpected replay fields.');
  if (input.version !== VERSION) throw new TypeError('Unsupported replay version.');
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) throw new RangeError('Invalid replay seed.');
  if (input.mode !== 'daily' && input.mode !== 'voyage') throw new TypeError('Invalid replay mode.');
  if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > MAX_TIDES) throw new RangeError('Invalid turn count.');
  if (input.mode === 'daily' && input.turns.length > DAILY_TIDES) throw new RangeError('A daily watch has seven tides.');
  let state = createGame(input.seed, input.mode);
  for (let turnIndex = 0; turnIndex < input.turns.length; turnIndex++) {
    const turn = input.turns[turnIndex];
    if (!turn || typeof turn !== 'object' || Array.isArray(turn) || Object.keys(turn).some(key => key !== 'swaps' && key !== 'defended')) throw new TypeError('Invalid turn.');
    if (typeof turn.defended !== 'boolean' || (!turn.defended && turnIndex !== input.turns.length - 1)) throw new TypeError('Only the last turn may be unfinished.');
    if (!Array.isArray(turn.swaps) || turn.swaps.length > ORDERS_PER_TIDE || state.phase !== 'planning') throw new RangeError('Illegal turn.');
    for (const pair of turn.swaps) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isInteger)) throw new TypeError('Invalid swap.');
      const next = swap(state, pair[0], pair[1]);
      if (next === state) throw new RangeError('Replay contains an illegal swap.');
      state = next;
    }
    if (turn.defended) state = defend(state);
  }
  return state;
}

export function restoreGame(data) {
  try { return decodeReplay(data); } catch { return null; }
}

export function replayRun(payload) {
  try {
    const state = decodeReplay(payload);
    const completed = state.phase !== 'planning';
    const result = { version: VERSION, seed: state.seed, mode: state.mode, phase: state.phase, completed,
      victory: state.phase === 'victory', mastery: state.phase === 'victory' && state.hull === state.maxHull,
      tide: state.tide, tidesCompleted: state._turns.length, hull: state.hull, maxHull: state.maxHull, score: state.score, movesUsed: state.movesUsed };
    return { valid: true, state, result, error: null };
  } catch (error) {
    return { valid: false, state: null, result: null, error: error instanceof Error ? error.message : 'Invalid replay.' };
  }
}
