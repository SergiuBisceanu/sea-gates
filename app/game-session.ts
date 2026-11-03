import {
  BOARD_COLS,
  BOARD_ROWS,
  isWaterCol,
  type GameState,
  type CrewKind,
  type CreatureKind,
  type Effect,
  type FloatingCargo,
  type MaterialKind,
  type MachineKind,
  type Phase,
  type Selection,
  type Ship,
} from "./game-engine";

export const RUN_STORAGE_KEY = "cyclopean-harbor.run.v1";
export const RUN_BACKUP_STORAGE_KEY = "cyclopean-harbor.run-backup.v1";
export const AUDIO_STORAGE_KEY = "cyclopean-harbor.audio-muted.v1";
export const SPEED_STORAGE_KEY = "cyclopean-harbor.battle-speed.v1";

const SESSION_VERSION = 1;
const PHASES = new Set<Phase>(["planning", "battle", "gameover"]);
const MATERIALS = new Set<MaterialKind>(["stone", "timber", "bronze", "wine"]);
const MACHINES = new Set<MachineKind>(["catapult", "arm", "automaton", "siphon"]);
const CREWS = new Set<CrewKind>(["raiders", "spartoi"]);
const CREATURES = new Set<CreatureKind>([
  "skolopendra",
  "sciron-turtle",
  "karkinos",
  "ketos",
]);
const EFFECTS = new Set<Effect["kind"]>([
  "stone",
  "fire",
  "impact",
  "awe",
  "claw",
  "landing",
  "salvage",
  "monsterFall",
]);
const OUTCOMES = new Set<NonNullable<Ship["outcome"]>>(["sunk", "captured", "landed"]);
const ARM_OUTCOMES = new Set<NonNullable<Effect["armOutcome"]>>([
  "capture",
  "wrench",
  "overturn",
]);
const RUN_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem"> & Partial<StorageReader>;
type StorageRemover = Pick<Storage, "removeItem">;

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some embedded/private browsers throw while accessing the property itself.
    return null;
  }
}

// randomUUID requires HTTPS in browsers. getRandomValues also works when a
// player serves the game on a phone over their local network.
export function createRunKey(): string {
  if (typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export interface StoredRun {
  game: GameState;
  runKey: string;
  undoHistory: GameState[];
  recovered?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function hasValidPiece(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "material") return MATERIALS.has(value.material as MaterialKind);
  return value.kind === "machine" &&
    MACHINES.has(value.machine as MachineKind) &&
    isIntegerInRange(value.tier, 1, 3) &&
    isFiniteNumber(value.cooldown) &&
    value.cooldown <= 100;
}

function hasValidShip(value: unknown): value is Ship {
  if (!isRecord(value)) return false;
  return isIntegerInRange(value.id, 0, 1_000_000_000) &&
    typeof value.name === "string" && value.name.length <= 120 &&
    (value.channel === 0 || value.channel === 1) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.hp) &&
    isFiniteNumber(value.maxHp) && value.maxHp > 0 &&
    isFiniteNumber(value.speed) && value.speed >= 0 &&
    isIntegerInRange(value.mass, 1, 4) &&
    isFiniteNumber(value.shield) && value.shield >= 0 &&
    isFiniteNumber(value.landing) && value.landing >= 0 &&
    isFiniteNumber(value.spawnAt) && value.spawnAt >= 0 &&
    isFiniteNumber(value.awe) && value.awe >= 0 &&
    typeof value.resolved === "boolean" &&
    (value.outcome === undefined || OUTCOMES.has(value.outcome as NonNullable<Ship["outcome"]>)) &&
    (value.crew === undefined || CREWS.has(value.crew as CrewKind)) &&
    (value.creature === undefined || CREATURES.has(value.creature as CreatureKind)) &&
    (value.cargo === undefined || MATERIALS.has(value.cargo as MaterialKind)) &&
    isOptionalBoolean(value.screening) &&
    isOptionalBoolean(value.command) &&
    isOptionalBoolean(value.boss) &&
    isOptionalBoolean(value.bossWrenched) &&
    isOptionalBoolean(value.overturned) &&
    isOptionalFiniteNumber(value.bossRank) &&
    (value.veteranRank === undefined || isIntegerInRange(value.veteranRank, 0, 10_000)) &&
    isOptionalFiniteNumber(value.plates) &&
    isOptionalFiniteNumber(value.maxPlates) &&
    isOptionalFiniteNumber(value.grappled);
}

function hasValidCargo(value: unknown): value is FloatingCargo {
  if (!isRecord(value)) return false;
  return isIntegerInRange(value.id, 0, 1_000_000_000) &&
    MATERIALS.has(value.material as MaterialKind) &&
    (value.channel === 0 || value.channel === 1) &&
    isIntegerInRange(value.row, 0, BOARD_ROWS - 1);
}

function hasValidEffect(value: unknown): value is Effect {
  if (!isRecord(value)) return false;
  const numericKeys = [
    "delay",
    "targetId",
    "fromRow",
    "fromCol",
    "toY",
    "grabY",
    "haulY",
    "contactY",
    "targetOffsetY",
    "armTier",
  ];
  if (numericKeys.some((key) => !isOptionalFiniteNumber(value[key]))) return false;
  return isIntegerInRange(value.id, 0, 1_000_000_000) &&
    EFFECTS.has(value.kind as Effect["kind"]) &&
    isFiniteNumber(value.ttl) && value.ttl >= 0 &&
    isFiniteNumber(value.total) && value.total > 0 &&
    (value.channel === undefined || value.channel === 0 || value.channel === 1) &&
    (value.label === undefined || (typeof value.label === "string" && value.label.length <= 120)) &&
    (value.creature === undefined || CREATURES.has(value.creature as CreatureKind)) &&
    (value.crew === undefined || CREWS.has(value.crew as CrewKind)) &&
    (value.armOutcome === undefined || ARM_OUTCOMES.has(value.armOutcome as NonNullable<Effect["armOutcome"]>)) &&
    (value.armTier === undefined || isIntegerInRange(value.armTier, 1, 3)) &&
    isOptionalBoolean(value.armFacesRight);
}

function hasValidSelection(value: unknown): value is Selection {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "cargo") return isIntegerInRange(value.id, 0, 1_000_000_000);
  return value.kind === "land" &&
    isIntegerInRange(value.row, 0, BOARD_ROWS - 1) &&
    isIntegerInRange(value.col, 0, BOARD_COLS - 1) &&
    !([2, 5] as number[]).includes(value.col as number);
}

function hasValidGameState(value: unknown): value is GameState {
  if (!isRecord(value) || !Array.isArray(value.board)) return false;
  if (value.board.length !== BOARD_ROWS) return false;
  if (!value.board.every(
    (row) =>
      Array.isArray(row) &&
      row.length === BOARD_COLS &&
      row.every((piece, col) => isWaterCol(col) ? piece === null : hasValidPiece(piece)),
  )) return false;
  if (!PHASES.has(value.phase as Phase)) return false;
  if (!Array.isArray(value.ships) || value.ships.length > 64 || !value.ships.every(hasValidShip)) return false;
  if (!Array.isArray(value.cargo) || value.cargo.length > 12 || !value.cargo.every(hasValidCargo)) return false;
  // All 36 land cells can fire on the same frame. Each tier III Siphon
  // can produce a jet and impact on four hulls before older effects expire.
  if (!Array.isArray(value.effects) || value.effects.length > 2048 || !value.effects.every(hasValidEffect)) return false;
  if (!hasValidSelection(value.selection)) return false;
  return isIntegerInRange(value.tide, 1, 100_000) &&
    isIntegerInRange(value.actions, 0, 20) &&
    isIntegerInRange(value.harbor, 0, 20) &&
    isIntegerInRange(value.maxHarbor, 1, 20) && value.harbor <= value.maxHarbor &&
    isFiniteNumber(value.kleos) && value.kleos >= 0 &&
    isFiniteNumber(value.battleTime) && value.battleTime >= 0 &&
    isIntegerInRange(value.nextId, 1, 1_000_000_000) &&
    isIntegerInRange(value.runSeed, 0, 0x7fffffff) &&
    isIntegerInRange(value.unusedAtHorn, 0, 20) &&
    isIntegerInRange(value.landingsThisBattle, 0, 100) &&
    isIntegerInRange(value.captures, 0, 1_000_000) &&
    typeof value.message === "string" && value.message.length <= 500;
}

function decodeStoredRun(raw: string | null | undefined): StoredRun | null {
  try {
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || saved.version !== SESSION_VERSION) return null;
    if (typeof saved.runKey !== "string" || !RUN_KEY_PATTERN.test(saved.runKey)) return null;
    if (!hasValidGameState(saved.game)) return null;
    // Older runs have no history. A damaged history must not discard the run.
    const undoHistory: GameState[] = [];
    if (saved.game.phase === "planning" && Array.isArray(saved.undoHistory)) {
      let expectedActions = saved.game.actions + 1;
      for (const snapshot of saved.undoHistory.slice(-5).reverse()) {
        if (!hasValidGameState(snapshot) || snapshot.phase !== "planning" ||
          snapshot.runSeed !== saved.game.runSeed || snapshot.tide !== saved.game.tide ||
          snapshot.actions !== expectedActions++) break;
        undoHistory.unshift({ ...snapshot, selection: null });
      }
    }
    return {
      undoHistory,
      game: {
        ...saved.game,
        board: saved.game.board.map((row) => row.map((piece) =>
          piece?.kind === "machine"
            ? { ...piece, cooldown: Math.max(-1, piece.cooldown) }
            : piece,
        )),
        effects: saved.game.phase === "gameover" ? [] : saved.game.effects,
        selection: null,
      },
      runKey: saved.runKey,
    };
  } catch {
    return null;
  }
}

export function loadStoredRun(storage: StorageReader | null): StoredRun | null {
  try {
    const primary = decodeStoredRun(storage?.getItem(RUN_STORAGE_KEY));
    if (primary) return primary;
    const backup = decodeStoredRun(storage?.getItem(RUN_BACKUP_STORAGE_KEY));
    return backup ? { ...backup, recovered: true } : null;
  } catch {
    return null;
  }
}

export function saveStoredRun(
  storage: StorageWriter | null,
  game: GameState,
  runKey: string,
  undoHistory: readonly GameState[] = [],
): boolean {
  if (!storage) return false;
  let previous: string | null | undefined;
  try { previous = storage.getItem?.(RUN_STORAGE_KEY); } catch { /* Saving can still work. */ }
  try {
    storage.setItem(RUN_STORAGE_KEY, JSON.stringify({
      version: SESSION_VERSION,
      savedAt: Date.now(),
      game: { ...game, selection: null },
      runKey,
      undoHistory: game.phase === "planning" ? undoHistory.slice(-5) : [],
    }));
  } catch {
    return false;
  }
  // Keep the last valid checkpoint only after the new one is safe. A full
  // quota or a corrupt primary must never destroy the remaining good copy.
  const previousRun = decodeStoredRun(previous);
  if (previousRun?.runKey === runKey && previous) {
    try { storage.setItem(RUN_BACKUP_STORAGE_KEY, previous); } catch { /* The primary is saved. */ }
  }
  return true;
}

export function clearStoredRun(storage: StorageRemover | null): void {
  try {
    storage?.removeItem(RUN_BACKUP_STORAGE_KEY);
    storage?.removeItem(RUN_STORAGE_KEY);
  } catch {
    // Guest play must remain available when browser storage is blocked.
  }
}

export function readBooleanPreference(
  storage: StorageReader | null,
  key: string,
  fallback = false,
): boolean {
  try {
    const stored = storage?.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Use the supplied fallback when browser storage is blocked.
  }
  return fallback;
}

export function writeBooleanPreference(
  storage: StorageWriter | null,
  key: string,
  value: boolean,
): void {
  try {
    storage?.setItem(key, value ? "1" : "0");
  } catch {
    // Preferences are optional; gameplay must remain available.
  }
}

export function readBattleSpeed(storage: StorageReader | null): 1 | 2 {
  try {
    return storage?.getItem(SPEED_STORAGE_KEY) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}

export function writeBattleSpeed(storage: StorageWriter | null, speed: 1 | 2): void {
  try {
    storage?.setItem(SPEED_STORAGE_KEY, String(speed));
  } catch {
    // Speed preference is optional.
  }
}
