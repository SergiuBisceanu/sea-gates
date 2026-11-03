export const BOARD_COLS = 8;
export const BOARD_ROWS = 6;
export const WATER_COLS = [2, 5] as const;
export const CHANNEL_ENTRY_Y = 5.72;

export type MaterialKind = "stone" | "timber" | "bronze" | "wine";
export type MachineKind = "catapult" | "arm" | "automaton" | "siphon";
export type CrewKind = "raiders" | "spartoi";
export type CreatureKind =
  | "skolopendra"
  | "sciron-turtle"
  | "karkinos"
  | "ketos";
export type Phase = "planning" | "battle" | "gameover";
export type Channel = 0 | 1;

export type Piece =
  | { kind: "material"; material: MaterialKind }
  | {
      kind: "machine";
      machine: MachineKind;
      tier: 1 | 2 | 3;
      cooldown: number;
    };

export type Board = Array<Array<Piece | null>>;

export interface Ship {
  id: number;
  name: string;
  channel: Channel;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  mass: 1 | 2 | 3 | 4;
  shield: number;
  landing: number;
  crew?: CrewKind;
  cargo?: MaterialKind;
  spawnAt: number;
  awe: number;
  resolved: boolean;
  outcome?: "sunk" | "captured" | "landed";
  command?: boolean;
  screening?: boolean;
  boss?: boolean;
  creature?: CreatureKind;
  bossRank?: number;
  veteranRank?: number;
  plates?: number;
  maxPlates?: number;
  grappled?: number;
  bossWrenched?: boolean;
  overturned?: boolean;
}

export interface FloatingCargo {
  id: number;
  material: MaterialKind;
  channel: Channel;
  row: number;
}

export interface Effect {
  id: number;
  kind:
    | "stone"
    | "fire"
    | "impact"
    | "awe"
    | "claw"
    | "landing"
    | "salvage"
    | "monsterFall";
  ttl: number;
  total: number;
  delay?: number;
  targetId?: number;
  fromRow?: number;
  fromCol?: number;
  toY?: number;
  grabY?: number;
  haulY?: number;
  contactY?: number;
  targetOffsetY?: number;
  armOutcome?: "capture" | "wrench" | "overturn";
  armTier?: 1 | 2 | 3;
  armFacesRight?: boolean;
  channel?: Channel;
  label?: string;
  creature?: CreatureKind;
  crew?: CrewKind;
}

export type Selection =
  | { kind: "land"; row: number; col: number }
  | { kind: "cargo"; id: number }
  | null;

export interface GameState {
  board: Board;
  phase: Phase;
  tide: number;
  actions: number;
  harbor: number;
  maxHarbor: number;
  kleos: number;
  ships: Ship[];
  cargo: FloatingCargo[];
  effects: Effect[];
  battleTime: number;
  selection: Selection;
  message: string;
  nextId: number;
  unusedAtHorn: number;
  landingsThisBattle: number;
  captures: number;
  runSeed: number;
}

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  stone: "Limestone",
  timber: "Timber",
  bronze: "Bronze",
  wine: "Wine",
};

export const MACHINE_LABELS: Record<MachineKind, string> = {
  catapult: "Stone Catapult",
  arm: "Archimedean Arm",
  automaton: "Dionysian Automaton",
  siphon: "Fire Siphon",
};

const MACHINE_RANGE: Record<MachineKind, readonly number[]> = {
  catapult: [2.1, 3.1, 6.5],
  arm: [0.72, 0.72, 0.72],
  automaton: [1.9, 2.25, 2.65],
  siphon: [1.2, 1.4, 1.6],
};

export function machineCoverage(piece: Extract<Piece, { kind: "machine" }>, col: number) {
  const channel = channelForLandCol(col);
  const channels: Channel[] = channel === null ? [] :
    piece.machine === "automaton" && piece.tier === 3 && (col === 3 || col === 4)
      ? [0, 1] : [channel];
  return { channels, range: MACHINE_RANGE[piece.machine][piece.tier - 1] };
}

const RECIPES: Array<{
  materials: [MaterialKind, MaterialKind];
  machine: MachineKind;
}> = [
  { materials: ["stone", "timber"], machine: "catapult" },
  { materials: ["timber", "bronze"], machine: "arm" },
  { materials: ["bronze", "wine"], machine: "automaton" },
  { materials: ["stone", "wine"], machine: "siphon" },
];

const MATERIAL_CYCLE: readonly MaterialKind[] = [
  "stone",
  "timber",
  "bronze",
  "wine",
];

const LAND_BANKS = [
  [0, 1],
  [3, 4],
  [6, 7],
] as const;

export function isWaterCol(col: number): boolean {
  return col === WATER_COLS[0] || col === WATER_COLS[1];
}

export function channelForWaterCol(col: number): Channel | null {
  if (col === WATER_COLS[0]) return 0;
  if (col === WATER_COLS[1]) return 1;
  return null;
}

export function channelForLandCol(col: number): Channel | null {
  if (isWaterCol(col)) return null;
  return col <= 3 ? 0 : 1;
}

export function isShoreFacingCol(col: number): boolean {
  return col === 1 || col === 3 || col === 4 || col === 6;
}

export function machineForMaterials(
  a: MaterialKind,
  b: MaterialKind,
): MachineKind | null {
  return (
    RECIPES.find(
      ({ materials }) =>
        (materials[0] === a && materials[1] === b) ||
        (materials[0] === b && materials[1] === a),
    )?.machine ?? null
  );
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => null),
  );
}

function material(material: MaterialKind): Piece {
  return { kind: "material", material };
}

export function createInitialGame(runSeed = Math.floor(Math.random() * 0x7fffffff)): GameState {
  const board = createEmptyBoard();

  // Every bank opens with a readable recipe pair plus one future ingredient.
  // The fuller board feels like a puzzle immediately, while only the catapult
  // is required by Tide I.
  board[3][0] = material("stone");
  board[3][1] = material("timber");
  board[5][0] = material("bronze");
  board[1][3] = material("timber");
  board[1][4] = material("bronze");
  board[4][3] = material("stone");
  board[4][6] = material("bronze");
  board[4][7] = material("wine");
  board[2][7] = material("timber");

  return {
    board,
    phase: "planning",
    tide: 1,
    actions: 5,
    harbor: 6,
    maxHarbor: 6,
    kleos: 0,
    ships: [],
    cargo: [],
    effects: [],
    battleTime: 0,
    selection: null,
    message: "Swipe the limestone right onto the timber in the west bank to build your first Catapult. Tap the Tide plaque for the menu.",
    nextId: 1,
    unusedAtHorn: 0,
    landingsThisBattle: 0,
    captures: 0,
    runSeed,
  };
}

function cloneBoard(board: Board): Board {
  return board.map((row) =>
    row.map((piece) => (piece ? { ...piece } : null)),
  );
}

function areAdjacent(aRow: number, aCol: number, bRow: number, bCol: number) {
  return Math.abs(aRow - bRow) + Math.abs(aCol - bCol) === 1;
}

export function actOnLandCell(
  state: GameState,
  row: number,
  col: number,
): GameState {
  if (
    state.phase !== "planning" ||
    !Number.isInteger(row) || !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_ROWS ||
    col < 0 ||
    col >= BOARD_COLS ||
    isWaterCol(col)
  ) {
    return state;
  }

  if (state.selection?.kind === "cargo") {
    if (state.actions <= 0) return state;
    const selectedCargoId = state.selection.id;
    const cargo = state.cargo.find((item) => item.id === selectedCargoId);
    if (!cargo) return { ...state, selection: null };

    const waterCol = WATER_COLS[cargo.channel];
    const besideCargo = row === cargo.row && Math.abs(col - waterCol) === 1;
    if (!besideCargo || state.board[row][col]) {
      return {
        ...state,
        selection: state.selection,
        message: "Cargo must be hauled into an empty square beside it.",
      };
    }

    const board = cloneBoard(state.board);
    board[row][col] = material(cargo.material);
    return {
      ...state,
      board,
      cargo: state.cargo.filter((item) => item.id !== cargo.id),
      actions: state.actions - 1,
      selection: null,
      message: `${MATERIAL_LABELS[cargo.material]} hauled ashore.`,
    };
  }

  if (!state.selection) {
    const piece = state.board[row][col];
    if (!piece) return state;
    const help: Record<MaterialKind, string> = {
      stone: "Limestone + timber builds a Catapult. Limestone + wine builds a Fire Siphon.",
      timber: "Timber + stone builds a Catapult. Timber + bronze builds an Arm.",
      bronze: "Bronze + timber builds an Arm. Bronze + wine builds an Automaton.",
      wine: "Wine + bronze builds an Automaton. Wine + limestone builds a Fire Siphon.",
    };
    return {
      ...state,
      selection: { kind: "land", row, col },
      message: piece.kind === "material" ? help[piece.material] :
        `${MACHINE_LABELS[piece.machine]} · Tier ${piece.tier}. Highlighted water shows its reach.`,
    };
  }

  const sourceRow = state.selection.row;
  const sourceCol = state.selection.col;
  if (sourceRow === row && sourceCol === col) {
    return { ...state, selection: null };
  }

  if (!areAdjacent(sourceRow, sourceCol, row, col)) {
    return state.board[row][col]
      ? actOnLandCell({ ...state, selection: null }, row, col)
      : { ...state, selection: null };
  }

  if (state.actions <= 0) {
    return state.board[row][col]
      ? actOnLandCell({ ...state, selection: null }, row, col)
      : { ...state, selection: null };
  }

  const board = cloneBoard(state.board);
  const source = board[sourceRow][sourceCol];
  const target = board[row][col];
  let message = "Pieces repositioned.";

  if (!source) {
    return { ...state, selection: null };
  }

  if (source.kind === "material" && target?.kind === "material") {
    const machine = machineForMaterials(source.material, target.material);
    if (machine) {
      board[sourceRow][sourceCol] = null;
      board[row][col] = { kind: "machine", machine, tier: 1, cooldown: 0.25 };
      message = `${MACHINE_LABELS[machine]} constructed.`;
    } else if (source.material === target.material) {
      return {
        ...state,
        selection: null,
        message: "Identical materials need a recipe partner; no move spent.",
      };
    } else {
      board[sourceRow][sourceCol] = target;
      board[row][col] = source;
    }
  } else if (
    source.kind === "machine" &&
    target?.kind === "machine" &&
    source.machine === target.machine &&
    source.tier === target.tier &&
    source.tier < 3
  ) {
    const tier = (source.tier + 1) as 2 | 3;
    board[sourceRow][sourceCol] = null;
    board[row][col] = {
      kind: "machine",
      machine: source.machine,
      tier,
      cooldown: 0.4,
    };
    message = `${MACHINE_LABELS[source.machine]} raised to Tier ${tier}.`;
  } else if (
    source.kind === "machine" &&
    target?.kind === "machine" &&
    source.machine === target.machine &&
    source.tier === 3 &&
    target.tier === 3
  ) {
    return {
      ...state,
      selection: null,
      message: "Tier III is the highest rank; no move spent.",
    };
  } else {
    board[sourceRow][sourceCol] = target;
    board[row][col] = source;
  }

  return {
    ...state,
    board,
    actions: state.actions - 1,
    selection: null,
    message,
  };
}

export function selectCargoAt(
  state: GameState,
  row: number,
  channel: Channel,
): GameState {
  if (state.phase !== "planning" || state.actions <= 0) return state;
  const cargo = state.cargo.find(
    (item) => item.row === row && item.channel === channel,
  );
  if (!cargo) return state;
  return {
    ...state,
    selection:
      state.selection?.kind === "cargo" && state.selection.id === cargo.id
        ? null
        : { kind: "cargo", id: cargo.id },
    message: `Choose an empty shore square for the ${MATERIAL_LABELS[cargo.material]}.`,
  };
}

interface ShipSpec {
  type:
    | "skiff"
    | "raider"
    | "shield"
    | "laden"
    | "command"
    | "sambuca"
    | "aegis"
    | "skolopendra"
    | "sciron-turtle"
    | "karkinos";
  channel: Channel;
  delay?: number;
  cargo?: MaterialKind;
  creature?: CreatureKind;
}

const SHIP_STATS: Record<ShipSpec["type"], Omit<Ship, "id" | "channel" | "y" | "spawnAt" | "awe" | "resolved" | "cargo">> = {
  skiff: {
    name: "Black Skiff",
    hp: 6,
    maxHp: 6,
    speed: 0.55,
    mass: 1,
    shield: 0,
    landing: 1,
    crew: "raiders",
  },
  raider: {
    name: "Raider Boat",
    hp: 10,
    maxHp: 10,
    speed: 0.46,
    mass: 1,
    shield: 0,
    landing: 2,
    crew: "raiders",
  },
  shield: {
    name: "Shield Ship",
    hp: 14,
    maxHp: 14,
    speed: 0.39,
    mass: 2,
    shield: 2,
    landing: 2,
    crew: "spartoi",
  },
  laden: {
    name: "Laden Galley",
    hp: 16,
    maxHp: 16,
    speed: 0.35,
    mass: 2,
    shield: 1,
    landing: 1,
    crew: "raiders",
  },
  aegis: {
    name: "Aegis Galley",
    hp: 14,
    maxHp: 14,
    speed: 0.39,
    mass: 2,
    shield: 2,
    landing: 2,
    screening: true,
    crew: "spartoi",
  },
  command: {
    name: "Command Ship",
    hp: 28,
    maxHp: 28,
    speed: 0.29,
    mass: 3,
    shield: 2,
    landing: 3,
    command: true,
    crew: "spartoi",
  },
  sambuca: {
    name: "The Sambuca",
    hp: 44,
    maxHp: 44,
    speed: 0.22,
    mass: 3,
    shield: 3,
    landing: 4,
    boss: true,
    crew: "spartoi",
  },
  skolopendra: {
    name: "The Red Skolopendra",
    hp: 36,
    maxHp: 36,
    speed: 0.18,
    mass: 4,
    shield: 2,
    landing: 4,
    boss: true,
    creature: "skolopendra",
    plates: 2,
    maxPlates: 2,
    grappled: 0,
  },
  "sciron-turtle": {
    name: "Sciron's Turtle",
    hp: 54,
    maxHp: 54,
    speed: 0.14,
    mass: 4,
    shield: 3,
    landing: 5,
    boss: true,
    creature: "sciron-turtle",
    plates: 3,
    maxPlates: 3,
    grappled: 0,
  },
  karkinos: {
    name: "Karkinos",
    hp: 12,
    maxHp: 12,
    speed: 0.34,
    mass: 2,
    shield: 1,
    landing: 1,
    creature: "karkinos",
  },
};

function enemyVisualExtents(ship: Ship) {
  if (ship.creature === "skolopendra") {
    return { towardHarbor: 0.55, towardSea: 2.55 };
  }
  if (ship.creature === "sciron-turtle") {
    return { towardHarbor: 0.55, towardSea: 1.95 };
  }
  if (ship.creature === "karkinos" || ship.creature === "ketos") {
    return { towardHarbor: 0.72, towardSea: 0.72 };
  }
  return { towardHarbor: 0.55, towardSea: 0.65 };
}

function enemySurfaceGap(first: Ship, second: Ship): number {
  const harborward = first.y <= second.y ? first : second;
  const seaward = harborward === first ? second : first;
  const harborwardExtent = enemyVisualExtents(harborward);
  const seawardExtent = enemyVisualExtents(seaward);
  return Math.max(
    0,
    seaward.y -
      harborward.y -
      harborwardExtent.towardSea -
      seawardExtent.towardHarbor,
  );
}

function shipHasEnteredChannel(ship: Ship): boolean {
  return ship.y <= CHANNEL_ENTRY_Y;
}

// A lethal shot can arrive while an earlier impact is still on screen. Use
// the effect that finishes last so the wreck never fades out and reappears.
export function shipActionEffect(ship: Ship, effects: readonly Effect[]): Effect | undefined {
  let chosen: Effect | undefined;
  for (const effect of effects) {
    if (effect.targetId !== ship.id || effect.ttl <= 0 ||
      (effect.kind !== "impact" && effect.kind !== "claw")) continue;
    if (!chosen || (ship.resolved
      ? effect.ttl > chosen.ttl || (effect.ttl === chosen.ttl && effect.id > chosen.id)
      : effect.kind === "claw" && chosen.kind !== "claw" ||
        effect.kind === chosen.kind && effect.id > chosen.id)) chosen = effect;
  }
  return chosen;
}

function skolopendraName(rank: number): string {
  if (rank === 1) return "The Red Skolopendra";
  if (rank === 2) return "The Ironback";
  if (rank === 3) return "The Brood-Mother";
  if (rank === 4) return "The Thousand-Oared";
  return `Elder Skolopendra ${rank - 3}`;
}

function skolopendraStats(tide: number) {
  const rank = Math.max(1, Math.floor((tide + 5) / 10));
  const pressure = wavePressure(tide);
  const maxHp = Math.ceil((48 + (rank - 1) * 18) * pressure.durability);
  const plates = Math.min(6, rank + 1);
  return {
    name: skolopendraName(rank),
    bossRank: rank,
    hp: maxHp,
    maxHp,
    speed: Math.min(0.38, (0.18 + (rank - 1) * 0.01) * pressure.pace),
    shield: plates,
    plates,
    maxPlates: plates,
    landing: Math.min(tide < 50 ? 5 : 6, 3 + rank),
  };
}

function scironTurtleName(rank: number): string {
  if (rank === 1) return "Sciron's Turtle";
  if (rank === 2) return "The Cliff-Eater";
  if (rank === 3) return "The Bronze-Shelled";
  return `Elder Turtle ${rank - 2}`;
}

function scironTurtleStats(tide: number) {
  const rank = Math.max(1, Math.floor(tide / 10));
  const pressure = wavePressure(tide);
  const maxHp = Math.ceil((72 + (rank - 1) * 20) * pressure.durability);
  const plates = Math.min(7, rank + 2);
  return {
    name: scironTurtleName(rank),
    bossRank: rank,
    hp: maxHp,
    maxHp,
    speed: Math.min(0.34, (0.14 + (rank - 1) * 0.01) * pressure.pace),
    shield: plates,
    plates,
    maxPlates: plates,
    landing: Math.min(tide < 50 ? 5 : 6, 4 + rank),
  };
}

export function bossChannelForTide(tide: number, runSeed: number): Channel | null {
  if (tide < 5 || tide % 5 !== 0) return null;
  return (tide <= 10 ? (tide / 5 + 1) % 2 : Math.floor(seededRoll(tide, runSeed, 0x424f5353) * 2)) as Channel;
}

function bossWave(tide: number, runSeed: number): ShipSpec[] {
  const bossRound = Math.max(1, Math.floor(tide / 5));
  const isSkolopendra = bossRound % 2 === 1;
  const channel = bossChannelForTide(tide, runSeed);
  if (channel === null) return [];
  // The first boss teaches the combination. Subsequent bosses sail with
  // several escort groups, including hulls that can overtake the monster.
  const escortCount = tide === 5 ? 0 : Math.min(48, 4 + (bossRound - 2) * 4);
  const escorts: ShipSpec[] = Array.from({ length: escortCount }, (_, index) => ({
    type: tide === 10 ? (index % 2 ? "raider" : "skiff") : fleetHull(tide, index),
    channel: (index % 2 ? channel : 1 - channel) as Channel,
    delay: tide === 10 ? 5 + Math.floor(index / 2) * 12 + index % 2 * 2 : assaultDelay(tide, runSeed, index),
  }));
  return [
    {
      type: isSkolopendra ? "skolopendra" : "sciron-turtle",
      channel,
      delay: tide >= 15 ? 7 : 0,
      cargo: isSkolopendra ? "bronze" : "stone",
    },
    ...randomizedFleet(escorts, tide, runSeed, true),
  ];
}

function seededRoll(tide: number, runSeed: number, salt: number): number {
  let value = (runSeed ^ Math.imul(tide + 1, 0x9e3779b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function seededShuffle<T>(items: readonly T[], tide: number, runSeed: number, salt: number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(seededRoll(tide, runSeed, salt + index * 101) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function hullThreat(type: ShipSpec["type"]): number {
  const ship = SHIP_STATS[type];
  return ship.maxHp * (0.75 + ship.speed) + ship.shield * 2 + ship.mass * 2 + (ship.command ? 5 : 0);
}

function randomizedFleet(specs: ShipSpec[], tide: number, runSeed: number, escort = false): ShipSpec[] {
  if (tide <= 10 || !specs.length) return specs;
  const nominal = specs.reduce((sum, ship) => sum + hullThreat(ship.type), 0);
  let budget = nominal;
  let commands = specs.filter(ship => ship.type === "command").length;
  const choices: ShipSpec["type"][] = tide < 20
    ? ["skiff", "raider", "shield", "laden", "command"]
    : tide < 35 ? ["raider", "shield", "laden", "command"]
      : ["raider", "shield", "shield", "laden", "command"];
  const varied = specs.map((spec, index) => {
    if (seededRoll(tide, runSeed, 0x56415259 + index * 37) > 0.65) return { ...spec };
    const type = choices[Math.floor(seededRoll(tide, runSeed, 0x48554c4c + index * 97) * choices.length)];
    const nextBudget = budget - hullThreat(spec.type) + hullThreat(type);
    const nextCommands = commands - Number(spec.type === "command") + Number(type === "command");
    // Vary real combat roles without allowing an unlucky all-command fleet.
    if (nextBudget < nominal * 0.97 || nextBudget > nominal * 1.1 ||
      nextCommands > (tide < 20 ? 1 : Math.ceil(specs.length / 4) + 1)) return { ...spec };
    budget = nextBudget;
    commands = nextCommands;
    return { ...spec, type };
  });
  const fleet = seededShuffle(varied, tide, runSeed, 0x4f524445);
  const laneCounts = [0, 0];
  const laneThreat = [0, 0];
  if (!escort) {
    // Deal heavy hulls first to keep either shore from receiving all the armor,
    // then sail in the shuffled order. Both composition and order vary by run.
    for (const { ship, index } of fleet.map((ship, index) => ({ ship, index }))
      .sort((a, b) => hullThreat(b.ship.type) - hullThreat(a.ship.type))) {
      let channel = Math.floor(seededRoll(tide, runSeed, 0x4c414e45 + index * 41) * 2) as Channel;
      if (laneCounts[channel] >= Math.ceil(fleet.length / 2) ||
        laneThreat[channel] > laneThreat[1 - channel] * 1.25) channel = (1 - channel) as Channel;
      if (laneCounts[channel] >= Math.ceil(fleet.length / 2)) channel = (1 - channel) as Channel;
      ship.channel = channel;
      laneCounts[channel]++;
      laneThreat[channel] += hullThreat(ship.type);
    }
  }
  // A screening escort takes an existing hull's berth. Prefer a shield ship
  // in a group with a nearby companion so its protection is visible on entry.
  if (tide >= 12 && (tide === 12 || seededRoll(tide, runSeed, 0x41454749) < 0.48)) {
    const lane = (index: number) => escort ? specs[index].channel : fleet[index].channel;
    const candidates = fleet.map((ship, index) => ({ ship, index })).filter(({ ship }) => !SHIP_STATS[ship.type].command);
    const accompanied = candidates.filter(({ index }) => fleet.some((_, other) =>
      index !== other && lane(index) === lane(other) &&
      Math.abs((specs[index].delay ?? 0) - (specs[other].delay ?? 0)) <= 3,
    ));
    const pool = accompanied.length ? accompanied : candidates;
    const pick = pool.find(({ ship }) => ship.type === "shield") ?? pool[0];
    if (pick) pick.ship.type = "aegis";
  }
  const cargoIndex = Math.floor(seededRoll(tide, runSeed, 0x43415247) * fleet.length);
  return fleet.map((ship, index) => ({
    ...ship,
    channel: escort ? specs[index].channel : ship.channel,
    delay: (specs[index].delay ?? 0) + seededRoll(tide, runSeed, 0x50414345 + index * 59) * 0.45,
    cargo: !escort && index === cargoIndex
      ? MATERIAL_CYCLE[Math.floor(seededRoll(tide, runSeed, 0x4c4f4f54) * 4)]
      : undefined,
  }));
}

function addCreatureVariants(
  specs: ShipSpec[],
  tide: number,
  runSeed: number,
): ShipSpec[] {
  let result = specs.map((spec) => ({ ...spec }));

  // A ketos replaces one ordinary hull without changing a single combat stat.
  const ketosCandidates = result
    .map((spec, index) => ({ spec, index }))
    .filter(({ spec }) =>
      ["skiff", "raider", "shield", "laden"].includes(spec.type),
    );
  if (
    tide >= 3 &&
    ketosCandidates.length &&
    seededRoll(tide, runSeed, 0x4b45544f) < 0.28
  ) {
    const chosen = ketosCandidates[
      Math.floor(seededRoll(tide, runSeed, 0x534541) * ketosCandidates.length)
    ];
    result[chosen.index] = { ...chosen.spec, creature: "ketos" };
  }

  // Karkinos is an occasional extra raider, with a hard cap of one per Tide.
  const karkinosChance = tide >= 11 ? 0.24 : tide >= 6 ? 0.12 : 0;
  if (
    karkinosChance > 0 &&
    tide % 5 !== 0 &&
    seededRoll(tide, runSeed, 0x43524142) < karkinosChance
  ) {
    const channel = (seededRoll(tide, runSeed, 0x434c4157) < 0.5 ? 0 : 1) as Channel;
    result = [
      ...result,
      {
        type: "karkinos",
        channel,
        delay: 0.7 + seededRoll(tide, runSeed, 0x53484f52) * 1.8,
      },
    ];
  }

  return result;
}

function veteranRank(tide: number): number {
  return Math.max(0, Math.floor((tide - 10) / 5));
}

function wavePressure(tide: number) {
  const age = Math.max(0, tide - 10);
  // Give a growing harbor time to field its top-tier machines. Hull health
  // still rises every Tide, reaching the full endless curve again at Tide 50.
  const middle = Math.max(0, Math.min(1, (tide - 20) / 10, (50 - tide) / 10));
  return {
    durability: (1 - 0.3 * middle) * (1 + age * 0.05 + age * age * 0.002) * (1 + Math.min(0.07, age * 0.007)),
    pace: (1 + Math.min(0.7, age * 0.016)) * (1 + Math.min(0.02, age * 0.002)),
  };
}

function fleetHull(tide: number, index: number): ShipSpec["type"] {
  // This rising formation supplies the budget for each randomized fleet.
  const formation: ShipSpec["type"][] = [
    "raider", "shield", "skiff", "command", "skiff", "raider", "shield", "skiff",
  ];
  let type = formation[index % formation.length];
  if (tide >= 20 && type === "skiff") type = "raider";
  if (tide >= 30 && type === "raider" && index % 3 === 0) type = "shield";
  if (tide >= 40 && type === "shield" && index % 4 === 1) type = "command";
  return type;
}

// Scheduled attack groups keep pressure coming even when the vanguard dies.
// Departure times never depend on the speed, stun, or death of another hull.
function assaultDelay(tide: number, runSeed: number, index: number): number {
  const groupSize = Math.min(7, 3 + Math.floor(tide / 15));
  const group = Math.floor(index / groupSize);
  const slot = index % groupSize;
  const spacing = Math.max(0.5, 0.95 - tide * 0.009);
  const surge = group === 0 ? 0 : seededRoll(tide, runSeed, 0x53555247 + group * 71) * 1.5;
  return group * 9 + surge + slot * spacing;
}

function waveSpecs(tide: number, runSeed = 0): ShipSpec[] {
  if (tide % 5 === 0) return addCreatureVariants(bossWave(tide, runSeed), tide, runSeed);

  const fixed: Record<number, ShipSpec[]> = {
    1: [{ type: "skiff", channel: 0 }],
    2: [{ type: "skiff", channel: 0, cargo: "bronze" }],
    3: [{ type: "raider", channel: 1 }, { type: "skiff", channel: 1, delay: 6 }],
    4: [{ type: "shield", channel: 0, cargo: "wine" }, { type: "skiff", channel: 0, delay: 7 }],
    6: [
      { type: "laden", channel: 1, cargo: "stone" },
      { type: "skiff", channel: 0, delay: 3.4 },
      { type: "raider", channel: 1, delay: 8 },
      { type: "skiff", channel: 0, delay: 11.4 },
    ],
    // Escorts now arrive in reinforcements instead of a single brief trickle.
    7: Array.from({ length: 5 }, (_, index) => ({
      type: index === 2 ? ("raider" as const) : ("skiff" as const),
      channel: ((index + 1) % 2) as Channel,
      delay: index * 2.8,
    })),
    8: [
      { type: "command", channel: 0, cargo: "bronze" },
      { type: "shield", channel: 1, delay: 1.4 },
      { type: "raider", channel: 1, delay: 3 },
      { type: "skiff", channel: 0, delay: 11 },
      { type: "raider", channel: 1, delay: 12.4 },
      { type: "shield", channel: 0, delay: 14 },
    ],
    9: [
      { type: "shield", channel: 0 },
      { type: "laden", channel: 1, cargo: "wine", delay: 0.4 },
      { type: "raider", channel: 0, delay: 1.5 },
      { type: "skiff", channel: 1, delay: 2.1 },
      { type: "skiff", channel: 0, delay: 12 },
      { type: "raider", channel: 1, delay: 13.4 },
      { type: "shield", channel: 0, delay: 14.8 },
      { type: "skiff", channel: 1, delay: 16.2 },
    ],
  };

  if (fixed[tide]) return addCreatureVariants(fixed[tide], tide, runSeed);

  // Add both numbers and durability: late Tides are sustained assaults,
  // with a bounded entity count for phones and unbounded veteran strength.
  const count = Math.min(52, 8 + Math.floor((tide - 10) * 0.65));
  let commandShips = 0;
  const generated = Array.from({ length: count }, (_, index) => {
    let type = fleetHull(tide, index);
    if (type === "command") {
      if (tide < 20 && commandShips >= 1) type = "shield";
      else commandShips++;
    }
    return {
      type,
      channel: ((tide + index) % 2) as Channel,
      delay: assaultDelay(tide, runSeed, index),
      cargo:
        index === count - 2
          ? MATERIAL_CYCLE[(tide + index) % MATERIAL_CYCLE.length]
          : undefined,
    };
  });
  return addCreatureVariants(randomizedFleet(generated, tide, runSeed), tide, runSeed);
}

export function waveTitle(tide: number): string {
  if (tide % 5 === 0) {
    const bossRound = Math.floor(tide / 5);
    return bossRound % 2 === 1
      ? skolopendraName(Math.floor((tide + 5) / 10))
      : scironTurtleName(Math.floor(tide / 10));
  }

  const titles: Record<number, string> = {
    1: "First Black Sail",
    2: "Bronze on the Water",
    3: "The Eastern Channel",
    4: "The Shielded Prow",
    6: "The Laden Galley",
    7: "Oars in the Dawn",
    8: "The Gilded Stern",
    9: "Moonless Approach",
  };
  return titles[tide] ?? `Freebooters of Tide ${tide}`;
}

// Planning redraws animate the sea while the seeded forecast stays fixed.
let lastForecast: { tide: number; runSeed: number; text: string } | undefined;

export function wavePreview(tide: number, runSeed = 0): string {
  if (lastForecast?.tide !== tide || lastForecast.runSeed !== runSeed) {
    lastForecast = { tide, runSeed, text: describeWave(tide, runSeed) };
  }
  return lastForecast.text;
}

function describeWave(tide: number, runSeed: number): string {
  const specs = waveSpecs(tide, runSeed);
  const west = specs.filter((ship) => ship.channel === 0).length;
  const east = specs.length - west;
  const spartoiShips = specs.filter(
    (ship) =>
      !ship.creature && ["shield", "aegis", "command", "sambuca"].includes(ship.type),
  ).length;
  const aegis = specs.find(ship => ship.type === "aegis");
  const screen = aegis ? ` · AEGIS ${aegis.channel === 0 ? "W" : "E"}` : "";
  const monster = specs.find(
    (ship) => ship.type === "skolopendra" || ship.type === "sciron-turtle",
  );
  if (monster) {
    const stats = monster.type === "skolopendra"
      ? skolopendraStats(tide)
      : scironTurtleStats(tide);
    const lane = monster.channel === 0 ? "WEST" : "EAST";
    const escorts = specs.length - 1;
    const armor = monster.type === "skolopendra" ? "PLATES" : "SHELL";
    return `BOSS · ${lane} CHANNEL · ${stats.plates} ${armor}${escorts ? ` · ${escorts} ESCORT${escorts === 1 ? "" : "S"}` : ""}${screen}${spartoiShips ? " · SPARTOI ABOARD" : ""}`;
  }
  const cargo = specs.filter((ship) => ship.cargo).length;
  const creatures = specs.filter((ship) => ship.creature || ship.type === "karkinos").length;
  const veterans = veteranRank(tide);
  return `W ${west} · E ${east}${screen}${cargo ? ` · ${cargo} laden` : ""}${creatures ? ` · ${creatures} sea-beast${creatures === 1 ? "" : "s"}` : ""}${spartoiShips ? ` · ${spartoiShips} Spartoi ship${spartoiShips === 1 ? "" : "s"}` : ""}${veterans ? ` · veteran ${veterans}` : ""}`;
}

export function dawnSupplyPreview(currentTide: number, runSeed = 0): MaterialKind[] {
  const nextTide = currentTide + 1;
  if (nextTide >= 6) {
    const block = Math.floor((nextTide - 6) / 4);
    const cycle = seededShuffle(MATERIAL_CYCLE, block, runSeed, 0x53555050);
    const offsets = seededShuffle([0, 1, 2], block, runSeed, 0x42414e4b);
    // Every bank gets all four materials in each bag. Each Dawn still offers
    // three distinct supplies, and the forecast is the exact committed roll.
    return offsets.map(offset => cycle[(nextTide - 6 + offset) % 4]);
  }
  return LAND_BANKS.map((_, bankIndex) =>
    MATERIAL_CYCLE[
      (Math.max(2, nextTide) - 2 + bankIndex) % MATERIAL_CYCLE.length
    ],
  );
}

export function startBattle(state: GameState): GameState {
  if (state.phase !== "planning") return state;

  let nextId = state.nextId;
  const pressure = wavePressure(state.tide);
  const ships = waveSpecs(state.tide, state.runSeed).map((spec) => {
    const stats = SHIP_STATS[spec.type];
    const veterans = stats.boss ? 0 : veteranRank(state.tide);
    const veteranMaxHp = Math.ceil(stats.maxHp * pressure.durability);
    const veteranStats = !stats.boss && state.tide > 10
      ? {
          hp: veteranMaxHp,
          maxHp: veteranMaxHp,
          speed: stats.speed * pressure.pace,
          // Veteran hulls are progressively reinforced, so endless play cannot
          // be solved forever by a fixed row of Tier III capture Arms.
          mass: Math.min(4, stats.mass + Math.floor(veterans / 3)) as Ship["mass"],
          veteranRank: veterans,
          shield: Math.min(5, stats.shield + Math.floor(veterans / 2)),
          landing: Math.min(6, stats.landing + Math.floor(veterans / 3)),
        }
      : {};
    const monsterStats: Partial<Ship> = spec.type === "skolopendra"
      ? skolopendraStats(state.tide)
      : spec.type === "sciron-turtle"
        ? scironTurtleStats(state.tide)
        : {};
    const creature = spec.creature ?? stats.creature;
    return {
      ...stats,
      ...veteranStats,
      ...monsterStats,
      creature,
      crew: creature ? undefined : stats.crew,
      name:
        creature === "ketos"
          ? "Ketos"
          : monsterStats.name ?? stats.name,
      id: nextId++,
      channel: spec.channel,
      y: CHANNEL_ENTRY_Y,
      cargo: spec.cargo,
      spawnAt: spec.delay ?? 0,
      awe: 0,
      grappled: 0,
      bossWrenched: false,
      resolved: false,
    } satisfies Ship;
  });

  const board = cloneBoard(state.board);
  for (const row of board) {
    for (const piece of row) {
      if (piece?.kind === "machine") piece.cooldown = 0.2;
    }
  }

  return {
    ...state,
    board,
    phase: "battle",
    ships,
    cargo: [],
    effects: [],
    battleTime: 0,
    selection: null,
    unusedAtHorn: state.actions,
    landingsThisBattle: 0,
    message: `${waveTitle(state.tide)} enters the channels.`,
    nextId,
  };
}

function addEffect(
  effects: Effect[],
  nextId: { value: number },
  effect: Omit<Effect, "id">,
) {
  effects.push({ ...effect, id: nextId.value++ });
}

function findAutoPlace(
  board: Board,
  channel: Channel,
  preferredRow: number,
): { row: number; col: number } | null {
  const shoreCols = channel === 0 ? [3, 1, 0] : [4, 6, 7];
  const rows = Array.from({ length: BOARD_ROWS }, (_, offset) => {
    const above = preferredRow - offset;
    const below = preferredRow + offset;
    return [above, below];
  })
    .flat()
    .filter((row, index, all) => row >= 0 && row < BOARD_ROWS && all.indexOf(row) === index);

  for (const row of rows) {
    for (const col of shoreCols) {
      if (!board[row][col]) return { row, col };
    }
  }
  return null;
}

function floatCargo(
  board: Board,
  floating: FloatingCargo[],
  item: MaterialKind,
  channel: Channel,
  preferredRow: number,
  nextId: { value: number },
) {
  const waterCol = WATER_COLS[channel];
  const rows = Array.from({ length: BOARD_ROWS }, (_, row) => row)
    .filter((row) => !floating.some((cargo) => cargo.channel === channel && cargo.row === row))
    .sort((a, b) => {
      const blocked = (row: number) => Number(Boolean(board[row][waterCol - 1] && board[row][waterCol + 1]));
      return blocked(a) - blocked(b) || Math.abs(a - preferredRow) - Math.abs(b - preferredRow) || a - b;
    });
  if (rows.length) {
    floating.push({ id: nextId.value++, material: item, channel, row: rows[0] });
    return;
  }
  const destination = findAutoPlace(board, channel, preferredRow);
  if (destination) board[destination.row][destination.col] = material(item);
}

function recoverCargo(
  board: Board,
  floating: FloatingCargo[],
  ship: Ship,
  captured: boolean,
  nextId: { value: number },
) {
  if (!ship.cargo) return;
  const row = Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(ship.y)));

  if (captured || ship.y <= 1.6) {
    const destination = findAutoPlace(board, ship.channel, row);
    if (destination) {
      board[destination.row][destination.col] = material(ship.cargo);
      return;
    }
  }

  if (captured || ship.y <= 3.9) {
    floatCargo(board, floating, ship.cargo, ship.channel, row, nextId);
  }
}

function stealFromBoard(board: Board, channel: Channel): string {
  const channelCols = channel === 0 ? [1, 3, 0] : [4, 6, 7];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (const col of channelCols) {
      const piece = board[row][col];
      if (piece?.kind === "material") {
        board[row][col] = null;
        return `${MATERIAL_LABELS[piece.material]} stolen`;
      }
    }
  }

  for (let row = 0; row < BOARD_ROWS; row++) {
    for (const col of channelCols) {
      const piece = board[row][col];
      if (piece?.kind === "machine") {
        if (piece.tier > 1) {
          piece.tier = (piece.tier - 1) as 1 | 2;
          return `${MACHINE_LABELS[piece.machine]} damaged`;
        }
        board[row][col] = null;
        return `${MACHINE_LABELS[piece.machine]} destroyed`;
      }
    }
  }
  return "the gate struck";
}

export function addDawnSupply(board: Board, tide: number, runSeed = 0): number {
  let placed = 0;
  const overflow: MaterialKind[] = [];
  const supplies = dawnSupplyPreview(tide - 1, runSeed);

  // Each Dawn offers one resource to each of the three disconnected land
  // banks. Use the exact forecast, preferring usable recipe partners and
  // breaking equally useful placement ties with the run's saved seed.
  for (let bankIndex = 0; bankIndex < LAND_BANKS.length; bankIndex++) {
    const bank = LAND_BANKS[bankIndex];
    const item = supplies[bankIndex];
    const preferredIndex = tide < 6
      ? (10 + (Math.max(2, tide) - 2) * 5 + bankIndex * 4) % 12
      : Math.floor(seededRoll(tide, runSeed, 0x504c4143 + bankIndex * 71) * 12);
    let destination: { row: number; col: number } | null = null;
    let bestScore = -Infinity;

    for (let attempt = 0; attempt < 12; attempt++) {
      const cellIndex = (preferredIndex + attempt * 5) % 12;
      const row = Math.floor(cellIndex / 2);
      const col = bank[cellIndex % 2];
      if (!board[row][col]) {
        let score = 0;
        for (const [dRow, dCol] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const neighbor = board[row + dRow]?.[col + dCol];
          if (neighbor?.kind === "material" && machineForMaterials(item, neighbor.material)) {
            score += 10;
          }
        }
        if (score > bestScore) {
          destination = { row, col };
          bestScore = score;
        }
      }
    }

    if (!destination) {
      overflow.push(item);
      continue;
    }
    board[destination.row][destination.col] = material(item);
    placed++;
  }
  // A crowded bank must not erase its forecast supply while another bank has
  // room. Give every bank its own delivery first, then redistribute overflow.
  for (const item of overflow) {
    const banks = LAND_BANKS.map((bank) => ({
      bank,
      occupied: board.reduce((count, row) => count + bank.filter((col) => row[col]).length, 0),
    })).sort((a, b) => a.occupied - b.occupied);
    let destination: { row: number; col: number } | undefined;
    for (const { bank } of banks) {
      let bestScore = -1;
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (const col of bank) {
          if (board[row][col]) continue;
          const score = [[-1, 0], [1, 0], [0, -1], [0, 1]].reduce((sum, [dr, dc]) => {
            const neighbor = board[row + dr]?.[col + dc];
            return sum + Number(neighbor?.kind === "material" && Boolean(machineForMaterials(item, neighbor.material)));
          }, 0);
          if (score > bestScore) {
            destination = { row, col };
            bestScore = score;
          }
        }
      }
      if (destination) break;
    }
    if (destination) {
      board[destination.row][destination.col] = material(item);
      placed++;
    }
  }
  return placed;
}

function targetDistanceFromRow(ship: Ship, row: number): number {
  const length = ship.creature === "skolopendra"
    ? 2.25
    : ship.creature === "sciron-turtle"
      ? 1.25
      : 0;
  if (!length) return Math.abs(ship.y - row);
  const tailY = ship.y + length;
  if (row < ship.y) return ship.y - row;
  if (row > tailY) return row - tailY;
  return 0;
}

function impactYForRow(ship: Ship, row: number): number {
  const length = ship.creature === "skolopendra"
    ? 2.25
    : ship.creature === "sciron-turtle"
      ? 1.25
      : 0;
  if (!length) return ship.y;
  return Math.max(ship.y, Math.min(ship.y + length, row));
}

function remainingPlates(ship: Ship): number {
  const maximum = ship.maxPlates ?? 0;
  if (!maximum || ship.hp <= 0) return 0;
  const band = Math.ceil((ship.hp / ship.maxHp) * (maximum + 1)) - 1;
  return Math.max(0, Math.min(maximum, band));
}

function damageHull(ship: Ship, damage: number) {
  ship.hp = Math.max(0, ship.hp - damage);
  if (ship.plates !== undefined) {
    ship.plates = remainingPlates(ship);
    ship.shield = ship.plates;
  }
}

export function isShipScreened(ship: Ship, escorts: readonly Ship[], battleTime: number): boolean {
  if (ship.boss || ship.resolved || ship.hp <= 0 || battleTime < ship.spawnAt || !shipHasEnteredChannel(ship)) return false;
  return escorts.some(escort => escort.screening && escort.id !== ship.id && escort.channel === ship.channel &&
    !escort.resolved && escort.hp > 0 && battleTime >= escort.spawnAt && shipHasEnteredChannel(escort) &&
    escort.awe <= 0 && (escort.grappled ?? 0) <= 0 && Math.abs(ship.y - escort.y) <= 1.25);
}

function machineThreatScore(ship: Ship): number {
  // A boss remains a priority after losing its plates. Otherwise artillery
  // abandons a nearly dead monster for a fresh armored escort until too late.
  return (ship.plates ?? ship.shield) * 8 + ship.mass * 3 + (ship.boss ? 18 : 0) + (ship.screening ? 12 : 0) - ship.y;
}

function addBossSpoil(
  board: Board,
  floating: FloatingCargo[],
  ship: Ship,
  captured: boolean,
  nextId: { value: number },
) {
  const row = Math.max(0, Math.min(BOARD_ROWS - 1, Math.round(ship.y)));
  const spoil: MaterialKind = ship.creature === "sciron-turtle" ? "stone" : "bronze";
  if (captured) {
    const destination = findAutoPlace(board, ship.channel, row);
    if (destination) {
      board[destination.row][destination.col] = material(spoil);
      return;
    }
  }
  floatCargo(board, floating, spoil, ship.channel, row, nextId);
}

export function stepBattle(state: GameState, deltaSeconds: number): GameState {
  if (state.phase !== "battle" || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;
  const dt = Math.min(0.12, Math.max(0, deltaSeconds));
  const battleTime = state.battleTime + dt;
  const board = cloneBoard(state.board);
  const ships = state.ships.map((ship) => ({ ...ship }));
  const cargo = state.cargo.map((item) => ({ ...item }));
  for (const ship of ships) {
    ship.grappled = Math.max(0, (ship.grappled ?? 0) - dt);
  }
  const effects = state.effects
    .map((effect) => ({ ...effect, ttl: effect.ttl - dt }))
    .filter((effect) => effect.ttl > 0);
  const nextId = { value: state.nextId };
  let harbor = state.harbor;
  let kleos = state.kleos;
  let captures = state.captures;
  let landings = state.landingsThisBattle;
  let message = state.message;

  for (const row of board) {
    for (const piece of row) {
      if (piece?.kind === "machine") piece.cooldown = Math.max(-1, piece.cooldown - dt);
    }
  }

  // Dionysian mechanisms act first. Awe is psychological control, while the
  // same timed signal advances the reload of nearby defender crews.
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = board[row][col];
      if (piece?.kind !== "machine" || piece.machine !== "automaton" || piece.cooldown > 0) continue;
      const homeChannel = channelForLandCol(col);
      if (homeChannel === null) continue;
      const channels: Channel[] = piece.tier === 3 && (col === 3 || col === 4) ? [0, 1] : [homeChannel];
      const radius = MACHINE_RANGE.automaton[piece.tier - 1];
      const candidates = ships
        .filter(
          (ship) =>
            !ship.resolved &&
            ship.hp > 0 &&
            battleTime >= ship.spawnAt &&
            shipHasEnteredChannel(ship) &&
            channels.includes(ship.channel) &&
            targetDistanceFromRow(ship, row) <= radius,
        )
        .sort(
          (a, b) =>
            Number(a.awe > 0.12) - Number(b.awe > 0.12) ||
            machineThreatScore(b) - machineThreatScore(a),
        );
      const affected = candidates.slice(0, piece.tier);
      if (!affected.length) continue;

      for (const ship of affected) {
        const duration = ship.creature === "skolopendra"
          ? 0.7 + piece.tier * 0.28
          : [2.4, 2.7, 3][piece.tier - 1];
        ship.awe = Math.max(ship.awe, duration);
      }
      piece.cooldown = [3.8, 3.4, 3][piece.tier - 1];
      for (const [dRow, dCol] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nearby = board[row + dRow]?.[col + dCol];
        if (nearby?.kind === "machine" && nearby.machine !== "automaton") {
          nearby.cooldown = Math.max(-1, nearby.cooldown - 0.55 * piece.tier);
        }
      }
      addEffect(effects, nextId, {
        kind: "awe",
        ttl: 0.7,
        total: 0.7,
        fromRow: row,
        fromCol: col,
        toY: impactYForRow(affected[0], row),
        targetOffsetY: impactYForRow(affected[0], row) - affected[0].y,
        channel: affected[0].channel,
        targetId: affected[0].id,
        label: "AWE",
      });
      message = affected.some((ship) => ship.creature === "skolopendra")
        ? "Wine floods the shell seams. The thousand oars lose their rhythm."
        : affected.some((ship) => ship.creature === "sciron-turtle")
          ? "Wine and bronze clamor force the giant turtle to expose its underside."
          : affected.some((ship) => ship.crew === "spartoi")
            ? "The Spartoi stagger, but their sealed bronze still holds."
            : "Thauma! The rowers falter and their shields fall.";
    }
  }

  // Stone catapults damage hulls and punish ordered formations at range.
  const catapultDamage = [4, 6, 9];
  const catapultReload = [2.2, 2, 1.8];
  const catapultRange = MACHINE_RANGE.catapult;
  const screens = ships.filter(ship => ship.screening);
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = board[row][col];
      if (piece?.kind !== "machine" || piece.machine !== "catapult" || piece.cooldown > 0) continue;
      const channel = channelForLandCol(col);
      if (channel === null) continue;
      const targets = ships
        .filter(
          (ship) =>
            !ship.resolved &&
            ship.hp > 0 &&
            battleTime >= ship.spawnAt &&
            shipHasEnteredChannel(ship) &&
            ship.channel === channel &&
            targetDistanceFromRow(ship, row) <= catapultRange[piece.tier - 1],
        )
        .sort((a, b) => {
          // Do not let a reinforced ship far offshore distract artillery from
          // a hull that will breach before the next reload.
          const timeToGate = (ship: Ship) =>
            (ship.y + 0.04) / Math.max(0.001, ship.speed) + (ship.grappled ?? 0);
          const deadline = catapultReload[piece.tier - 1] + 0.45;
          const urgentA = timeToGate(a) <= deadline;
          const urgentB = timeToGate(b) <= deadline;
          return Number(urgentB) - Number(urgentA) ||
            (urgentA && urgentB ? timeToGate(a) - timeToGate(b) : 0) ||
            machineThreatScore(b) - machineThreatScore(a);
        });
      const target = targets[0];
      if (!target) continue;
      const pierce = piece.tier - 1;
      const screened = isShipScreened(target, screens, battleTime);
      const armor = (target.plates ?? target.shield) + (screened ? 2 : 0);
      const effectiveArmor = Math.max(0, armor - pierce);
      const shield = target.awe > 0
        ? target.crew === "spartoi"
          ? Math.min(1, effectiveArmor)
          : 0
        : effectiveArmor;
      const damage = Math.max(1, catapultDamage[piece.tier - 1] - shield);
      const oldPlates = target.plates;
      damageHull(target, damage);
      piece.cooldown = catapultReload[piece.tier - 1];
      const impactY = impactYForRow(target, row);
      addEffect(effects, nextId, {
        kind: "stone",
        ttl: 0.45,
        total: 0.45,
        fromRow: row,
        fromCol: col,
        toY: impactY,
        targetOffsetY: impactY - target.y,
        channel,
        targetId: target.id,
      });
      addEffect(effects, nextId, {
        kind: "impact",
        ttl: 0.73,
        total: 0.73,
        delay: 0.45,
        toY: impactY,
        targetOffsetY: impactY - target.y,
        channel,
        targetId: target.id,
        label:
          oldPlates !== undefined && target.plates !== undefined && target.plates < oldPlates
            ? "PLATE BROKEN"
            : `-${damage}`,
      });

      if (piece.tier === 3) {
        const splash = ships.find(
          (ship) =>
            ship.id !== target.id &&
            !ship.resolved &&
            ship.hp > 0 &&
            battleTime >= ship.spawnAt &&
            shipHasEnteredChannel(ship) &&
            ship.channel === target.channel &&
            enemySurfaceGap(ship, target) < 0.8,
        );
        if (splash) {
          damageHull(splash, 2);
          addEffect(effects, nextId, {
            kind: "impact",
            ttl: 0.48,
            total: 0.48,
            toY: impactYForRow(splash, row),
            channel: splash.channel,
            targetId: splash.id,
          });
        }
      }
    }
  }

  // A Siphon trades reach and single-target damage for an armor-piercing
  // burst. Sweep the closest-packed formation; break ties toward the harbor.
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = board[row][col];
      if (piece?.kind !== "machine" || piece.machine !== "siphon" || piece.cooldown > 0) continue;
      const channel = channelForLandCol(col);
      if (channel === null) continue;
      const range = MACHINE_RANGE.siphon[piece.tier - 1];
      const candidates = ships.filter(ship => !ship.resolved && ship.hp > 0 && ship.channel === channel &&
        battleTime >= ship.spawnAt && shipHasEnteredChannel(ship) && targetDistanceFromRow(ship, row) <= range)
        .map(ship => ({ ship, y: impactYForRow(ship, row) }))
        .sort((a, b) => a.y - b.y || a.ship.id - b.ship.id);
      if (!candidates.length) continue;

      let first = 0;
      let count = 0;
      for (let i = 0, end = 0; i < candidates.length; i++) {
        while (end < candidates.length && end - i < piece.tier + 1 && candidates[end].y - candidates[i].y <= 0.9) end++;
        if (end - i > count) {
          first = i;
          count = end - i;
          if (count === piece.tier + 1) break;
        }
      }
      const damage = [2, 3, 5][piece.tier - 1];
      piece.cooldown = [2.1, 1.9, 1.8][piece.tier - 1];
      for (const { ship, y } of candidates.slice(first, first + count)) {
        damageHull(ship, damage);
        const hit = { toY: y, targetOffsetY: y - ship.y, channel, targetId: ship.id };
        addEffect(effects, nextId, { ...hit, kind: "fire", ttl: 0.36, total: 0.36, fromRow: row, fromCol: col });
        addEffect(effects, nextId, { ...hit, kind: "impact", ttl: 0.42, total: 0.42, delay: 0.12, label: `-${damage}` });
      }
    }
  }

  // Each Arm is a complete shore crane. It works from any land cell in its
  // assigned channel: Lift (its tier) captures a hull of equal or lower Mass;
  // anything heavier is still torn and pushed seaward instead of silently
  // disabling the machine. Bosses break the chain after their first wrench.
  const armDamage = [2, 4, 7];
  // A single tier-scaled wrench is useful at every Tide. Its immunity lasts
  // for the entire boss, across every Arm and across save/resume.
  const bossDamageFraction = [0.18, 0.27, 0.36] as const;
  const armPush = [0.28, 0.42, 0.58];
  const armReload = [7, 6, 5];
  const armActionTime = 1.05;
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = board[row][col];
      if (
        piece?.kind !== "machine" ||
        piece.machine !== "arm" ||
        piece.cooldown > 0
      ) continue;
      const channel = channelForLandCol(col);
      if (channel === null) continue;

      const targets = ships.filter(
        (ship) =>
          !ship.resolved &&
          ship.hp > (ship.boss ? 1 : 0) &&
          !(ship.boss && ship.bossWrenched) &&
          battleTime >= ship.spawnAt &&
          shipHasEnteredChannel(ship) &&
          ship.channel === channel &&
          (ship.grappled ?? 0) <= 0 &&
          targetDistanceFromRow(ship, row) <= MACHINE_RANGE.arm[piece.tier - 1],
      );
      if (!targets.length) continue;

      // A boss is the urgent target. Otherwise take the heaviest hull this Arm
      // can actually lift; only wrench an overweight hull when no capture is
      // possible, so a heavy galley can never mask a valid skiff.
      const target =
        targets
          .filter((ship) => ship.boss)
          .sort((a, b) => machineThreatScore(b) - machineThreatScore(a))[0] ??
        targets
          .filter((ship) => ship.mass <= piece.tier)
          .sort((a, b) => b.mass - a.mass || machineThreatScore(b) - machineThreatScore(a))[0] ??
        targets.sort((a, b) => machineThreatScore(b) - machineThreatScore(a))[0];
      if (!target) continue;

      const grabY = target.y;
      const contactY = impactYForRow(target, row);
      const canCapture = !target.boss && target.mass <= piece.tier;

      piece.cooldown = armReload[piece.tier - 1];
      target.grappled = armActionTime;
      if (target.boss) target.bossWrenched = true;

      if (canCapture) {
        target.resolved = true;
        target.outcome = "captured";
        recoverCargo(board, cargo, target, true, nextId);
        captures++;
        kleos += 20 + target.mass * 10;
        addEffect(effects, nextId, {
          kind: "claw",
          ttl: armActionTime,
          total: armActionTime,
          fromRow: row,
          fromCol: col,
          grabY,
          haulY: grabY,
          contactY,
          armOutcome: "capture",
          armTier: piece.tier,
          armFacesRight: col < 2 || col === 4,
          toY: grabY,
          channel,
          targetId: target.id,
          label: "SEIZED",
        });
        message = `${target.name} seized by the prow.${target.cargo ? " Its cargo is ours." : ""}`;
        continue;
      }

      const rawDamage = target.boss
        ? Math.ceil(target.hp * bossDamageFraction[piece.tier - 1])
        : armDamage[piece.tier - 1];
      const damage = target.boss
        ? Math.min(rawDamage, Math.max(0, target.hp - 1))
        : rawDamage;
      damageHull(target, damage);
      const haulY = Math.min(CHANNEL_ENTRY_Y, grabY + armPush[piece.tier - 1] * (
        target.boss ? 1 : Math.max(0.18, 1 - (target.veteranRank ?? 0) * 0.055)
      ));
      target.y = haulY;
      addEffect(effects, nextId, {
        kind: "claw",
        ttl: armActionTime,
        total: armActionTime,
        fromRow: row,
        fromCol: col,
        grabY,
        haulY,
        contactY,
        armOutcome: "wrench",
        armTier: piece.tier,
        armFacesRight: col < 2 || col === 4,
        toY: haulY,
        channel,
        targetId: target.id,
        label: target.boss ? `CHAIN BROKEN · -${damage}` : `WRENCHED · -${damage}`,
      });
      message = target.boss
        ? `${target.name} breaks the chain. No Arm can pull it again; finish it with Catapults.`
        : `${target.name} is too heavy to lift, but the claw tears its hull.`;
    }
  }

  // Resolve artillery kills before surviving ships advance.
  for (const ship of ships) {
    if (ship.resolved || battleTime < ship.spawnAt || ship.hp > 0) continue;
    ship.resolved = true;
    ship.outcome = "sunk";
    if (ship.boss && ship.creature) {
      const bossBonus = 80 + 20 * (ship.bossRank ?? 1) + (ship.overturned ? 50 : 0);
      const impactDelay = effects.reduce((delay, effect) =>
        effect.targetId === ship.id && effect.kind === "impact"
          ? Math.max(delay, (effect.delay ?? 0) - (effect.total - effect.ttl))
          : delay, 0);
      const grapple = effects.find(
        (effect) => effect.targetId === ship.id && effect.kind === "claw",
      );
      const fallDelay = Math.max(impactDelay, grapple?.ttl ?? 0);
      addBossSpoil(board, cargo, ship, Boolean(ship.overturned), nextId);
      harbor = Math.min(state.maxHarbor, harbor + 1);
      kleos += bossBonus;
      if (ship.overturned) captures++;
      addEffect(effects, nextId, {
        kind: "monsterFall",
        ttl: 1.15 + fallDelay,
        total: 1.15 + fallDelay,
        delay: fallDelay || undefined,
        targetId: ship.id,
        fromRow: grapple?.fromRow,
        fromCol: grapple?.fromCol,
        grabY: grapple?.grabY,
        haulY: grapple?.haulY,
        contactY: grapple?.contactY,
        armOutcome: ship.overturned ? "overturn" : undefined,
        armTier: grapple?.armTier,
        armFacesRight: grapple?.armFacesRight,
        toY: ship.y,
        channel: ship.channel,
        label: ship.overturned ? "OVERTHROWN" : `+${bossBonus}`,
        creature: ship.creature,
      });
      message = ship.overturned
        ? `${ship.name} is overturned. Its armor strengthens the gate.`
        : `${ship.name} sinks. Its armor strengthens the gate.`;
    } else {
      recoverCargo(board, cargo, ship, false, nextId);
      kleos += 10 + ship.mass * 5;
      message = ship.creature === "karkinos"
        ? "Karkinos is broken before its claws reach the mole."
        : ship.y > 3.9 && ship.cargo
          ? `${ship.name} sunk safely offshore; its cargo is lost.`
          : `${ship.name} broken in the channel.`;
    }
  }

  const sailing = ships.filter(ship => !ship.resolved && battleTime >= ship.spawnAt);
  for (const ship of sailing) ship.awe = Math.max(0, ship.awe - dt);
  // Read the whole formation before advancing any vessel: reversing the
  // fleet array must not change who receives a command ship's pace bonus.
  const leaders = sailing.filter(ship => ship.command && shipHasEnteredChannel(ship) &&
    ship.awe <= 0 && (ship.grappled ?? 0) <= 0);
  const boosted = new Set(sailing.filter(ship => shipHasEnteredChannel(ship) &&
    leaders.some(leader => leader.id !== ship.id && leader.channel === ship.channel &&
      enemySurfaceGap(leader, ship) <= 1)));
  for (const ship of sailing) {
    const disruption = (ship.grappled ?? 0) > 0
      ? 0
      : ship.awe > 0
      ? ship.boss && ship.creature
        ? Math.min(0.8, 0.62 + Math.max(0, (ship.bossRank ?? 1) - 1) * 0.025)
        : Math.min(0.85, 0.35 + (ship.veteranRank ?? 0) * 0.025)
      : 1;
    ship.y -= ship.speed * dt * (boosted.has(ship) ? 1.18 : 1) * disruption;
  }

  for (const ship of ships) {
    if (ship.resolved || battleTime < ship.spawnAt) continue;
    if (ship.y <= -0.04) {
      ship.resolved = true;
      ship.outcome = "landed";
      harbor = Math.max(0, harbor - ship.landing);
      landings++;
      const loss = stealFromBoard(board, ship.channel);
      message = ship.creature === "karkinos"
        ? `Karkinos climbs the mole: ${loss}.`
        : ship.creature === "ketos"
          ? `The Ketos breaches the sea gate: ${loss}.`
          : ship.crew === "spartoi"
            ? `The Spartoi disembark from ${ship.name}: ${loss}.`
            : `Raiders from ${ship.name} land: ${loss}.`;
      addEffect(effects, nextId, {
        kind: "landing",
        ttl: 0.9,
        total: 0.9,
        toY: 0,
        channel: ship.channel,
        label: `-${ship.landing}`,
        crew: ship.crew,
        creature: ship.creature,
        targetId: ship.id,
      });
    }
  }

  const lastSpawn = Math.max(0, ...ships.map((ship) => ship.spawnAt));
  const allResolved = ships.every((ship) => ship.resolved);
  const resolutionAnimationsActive = effects.some((effect) =>
    ["stone", "fire", "impact", "claw", "landing", "monsterFall"].includes(effect.kind),
  );
  if (harbor <= 0) {
    return {
      ...state,
      board,
      ships,
      cargo,
      effects,
      battleTime,
      harbor,
      kleos,
      captures,
      landingsThisBattle: landings,
      message: "The sea gates have fallen. Your deeds remain.",
      nextId: nextId.value,
      phase: "gameover",
      selection: null,
    };
  }

  if (allResolved && !resolutionAnimationsActive && battleTime > lastSpawn + 0.65) {
    const nextTide = state.tide + 1;
    const placed = addDawnSupply(board, nextTide, state.runSeed);
    const flawlessBonus = landings === 0 ? state.unusedAtHorn * 8 : 0;
    return {
      ...state,
      board,
      ships: [],
      cargo,
      effects: [],
      battleTime: 0,
      harbor,
      kleos: kleos + flawlessBonus,
      captures,
      landingsThisBattle: 0,
      message:
        landings === 0
          ? `The harbor holds. ${placed} supplies arrive${flawlessBonus ? `; +${flawlessBonus} boldness` : ""}.`
          : `${placed} supplies arrive under a wounded dawn.`,
      nextId: nextId.value,
      phase: "planning",
      tide: nextTide,
      actions: 5,
      selection: null,
    };
  }

  return {
    ...state,
    board,
    ships,
    cargo,
    effects,
    battleTime,
    harbor,
    kleos,
    captures,
    landingsThisBattle: landings,
    message,
    nextId: nextId.value,
  };
}

export function machineCount(state: GameState, kind: MachineKind): number {
  return state.board.reduce(
    (total, row) =>
      total +
      row.filter((piece) => piece?.kind === "machine" && piece.machine === kind).length,
    0,
  );
}
