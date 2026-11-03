import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false, ws: false },
});

after(async () => {
  await vite.close();
});

const engine = await vite.ssrLoadModule("/app/game-engine.ts");
const session = await vite.ssrLoadModule("/app/game-session.ts");
const history = await vite.ssrLoadModule("/app/game-history.ts");
const scores = await vite.ssrLoadModule("/app/game-scores.ts");
const RUN_KEYS = {
  interrupted: "19730000-0000-4000-8000-000000000001",
  malformed: "19730000-0000-4000-8000-000000000002",
  water: "19730000-0000-4000-8000-000000000003",
  gameover: "19730000-0000-4000-8000-000000000004",
};

test("guest play survives a browser that blocks access to localStorage itself", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.defineProperty({}, "localStorage", { get() { throw new Error("Blocked storage"); } }),
  });
  try {
    assert.equal(session.browserStorage(), null);
    assert.equal(session.loadStoredRun(null), null);
    assert.equal(session.readBattleSpeed(null), 1);
    assert.equal(session.readBooleanPreference(null, "muted", true), true);
    assert.equal(session.saveStoredRun(null, engine.createInitialGame(), RUN_KEYS.interrupted), false);
    assert.doesNotThrow(() => session.clearStoredRun(null));
    assert.doesNotThrow(() => session.writeBattleSpeed(null, 2));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("planning undo survives a reload while damaged history leaves the run intact", () => {
  const storage = memoryStorage();
  const initial = engine.createInitialGame(173);
  const selected = engine.actOnLandCell(initial, 3, 0);
  const game = engine.actOnLandCell(selected, 3, 1);
  const undo = history.rememberPlanningMove([], selected, game);
  session.saveStoredRun(storage, game, RUN_KEYS.interrupted, undo);
  const restored = session.loadStoredRun(storage);
  assert.equal(restored.undoHistory.length, 1);
  const undone = history.undoPlanningMove(restored.game, restored.undoHistory);
  assert.deepEqual(undone.game.board, initial.board);
  assert.equal(undone.game.actions, initial.actions);
  const damaged = JSON.parse(storage.getItem(session.RUN_STORAGE_KEY));
  damaged.undoHistory[0].board = null;
  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify(damaged));
  assert.ok(session.loadStoredRun(storage));
  assert.deepEqual(session.loadStoredRun(storage).undoHistory, []);
  session.saveStoredRun(storage, engine.startBattle(game), RUN_KEYS.interrupted, undo);
  assert.deepEqual(session.loadStoredRun(storage).undoHistory, []);
});

test("failed scores survive a new run and reload, and cannot cross player accounts", async () => {
  const storage = memoryStorage();
  const score = { runKey: RUN_KEYS.gameover, tide: 12, kleos: 1440, captures: 7 };
  let outbox = scores.createScoreOutbox(storage, "player-one");
  outbox.enqueue(score);
  outbox.enqueue(score);
  assert.equal(outbox.size, 1);
  assert.equal(await outbox.flush(async () => { throw new Error("offline"); }), false);
  session.clearStoredRun(storage);
  session.saveStoredRun(storage, engine.createInitialGame(99), RUN_KEYS.interrupted);
  assert.equal(scores.createScoreOutbox(storage, "player-two").size, 0);
  outbox = scores.createScoreOutbox(storage, "player-one");
  assert.equal(outbox.size, 1);
  const delivered = [];
  assert.equal(await outbox.flush(async (item) => { delivered.push(item); return true; }), true);
  assert.deepEqual(delivered, [score]);
  assert.equal(scores.createScoreOutbox(storage, "player-one").size, 0);
});

test("concurrent score retries share one request and include a newly completed run", async () => {
  const outbox = scores.createScoreOutbox(memoryStorage(), "one");
  outbox.enqueue({ runKey: RUN_KEYS.gameover, tide: 12, kleos: 1440, captures: 7 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const send = async (score) => { sent.push(score.runKey); await gate; return true; };
  const first = outbox.flush(send);
  const second = outbox.flush(send);
  outbox.enqueue({ runKey: RUN_KEYS.interrupted, tide: 3, kleos: 100, captures: 1 });
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(sent, [RUN_KEYS.gameover, RUN_KEYS.interrupted]);
  assert.equal(outbox.size, 0);
});

test("saves and restores an interrupted run without a half-finished selection", () => {
  const storage = memoryStorage();
  const game = engine.createInitialGame(1973);
  const selected = engine.actOnLandCell(game, 3, 0);

  assert.equal(session.saveStoredRun(storage, selected, RUN_KEYS.interrupted), true);
  const restored = session.loadStoredRun(storage);

  assert.equal(restored?.runKey, RUN_KEYS.interrupted);
  assert.equal(restored?.game.runSeed, 1973);
  assert.equal(restored?.game.tide, 1);
  assert.equal(restored?.game.selection, null);
});

test("a corrupt primary restores the previous checkpoint with the same fleet and supply rolls", () => {
  const storage = memoryStorage();
  const game = { ...engine.createInitialGame(1973), tide: 29 };
  session.saveStoredRun(storage, game, RUN_KEYS.interrupted);
  session.saveStoredRun(storage, { ...game, actions: 4 }, RUN_KEYS.interrupted);
  storage.setItem(session.RUN_STORAGE_KEY, "truncated checkpoint");
  const recovered = session.loadStoredRun(storage);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.game.actions, 5);
  assert.equal(recovered.runKey, RUN_KEYS.interrupted);
  assert.deepEqual(engine.startBattle(recovered.game).ships, engine.startBattle(game).ships);
  assert.deepEqual(engine.dawnSupplyPreview(recovered.game.tide, recovered.game.runSeed), engine.dawnSupplyPreview(game.tide, game.runSeed));
  session.clearStoredRun(storage);
  assert.equal(session.loadStoredRun(storage), null, "a discarded run must not return from the backup");
});

test("a failed backup write cannot invalidate the newly saved primary", () => {
  const memory = memoryStorage();
  const storage = {
    getItem: memory.getItem,
    setItem(key, value) {
      if (key === session.RUN_BACKUP_STORAGE_KEY) throw new Error("Quota exceeded");
      memory.setItem(key, value);
    },
  };
  const game = engine.createInitialGame(1973);
  assert.equal(session.saveStoredRun(storage, game, RUN_KEYS.interrupted), true);
  assert.equal(session.saveStoredRun(storage, { ...game, actions: 4 }, RUN_KEYS.interrupted), true);
  assert.equal(session.loadStoredRun(storage).game.actions, 4);
});

test("ignores corrupt and incompatible session data", () => {
  const storage = memoryStorage();
  storage.setItem(session.RUN_STORAGE_KEY, "not json");
  assert.equal(session.loadStoredRun(storage), null);

  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify({ version: 99 }));
  assert.equal(session.loadStoredRun(storage), null);
});

test("rejects malformed nested run data and occupied water channels", () => {
  const storage = memoryStorage();
  const battle = engine.startBattle(engine.createInitialGame(173));
  session.saveStoredRun(storage, battle, RUN_KEYS.malformed);

  const malformedShip = JSON.parse(storage.getItem(session.RUN_STORAGE_KEY));
  malformedShip.game.ships[0].hp = "unlimited";
  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify(malformedShip));
  assert.equal(session.loadStoredRun(storage), null);

  session.saveStoredRun(storage, engine.createInitialGame(173), RUN_KEYS.water);
  const occupiedWater = JSON.parse(storage.getItem(session.RUN_STORAGE_KEY));
  occupiedWater.game.board[0][2] = { kind: "material", material: "bronze" };
  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify(occupiedWater));
  assert.equal(session.loadStoredRun(storage), null);
});

test("restores a completed run without stale combat effects", () => {
  const storage = memoryStorage();
  const gameover = {
    ...engine.createInitialGame(173),
    phase: "gameover",
    effects: [{ id: 900, kind: "impact", ttl: 0.5, total: 0.5 }],
  };
  session.saveStoredRun(storage, gameover, RUN_KEYS.gameover);
  const restored = session.loadStoredRun(storage);
  assert.ok(restored);
  assert.deepEqual(restored.game.effects, []);
});

test("normalizes an old long-battle machine cooldown instead of discarding the run", () => {
  const storage = memoryStorage();
  const battle = engine.startBattle(engine.createInitialGame(173));
  battle.board[3][1] = {
    kind: "machine", machine: "catapult", tier: 1, cooldown: -100.2,
  };
  session.saveStoredRun(storage, battle, "19730000-0000-4000-8000-000000000005");
  const restored = session.loadStoredRun(storage);
  assert.ok(restored);
  assert.equal(restored.game.board[3][1].cooldown, -1);
});

test("storage failures never block guest play", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(session.loadStoredRun(blocked), null);
  assert.equal(
    session.saveStoredRun(blocked, engine.createInitialGame(), "run-key-blocked"),
    false,
  );
  assert.doesNotThrow(() => session.clearStoredRun(blocked));
});


test("a boss keeps its spent Arm pull and moving hit anchors through save and resume", () => {
  const storage = memoryStorage();
  let battle = engine.startBattle({ ...engine.createInitialGame(173), tide: 50 });
  const boss = battle.ships.find(ship => ship.boss);
  battle.board = engine.createEmptyBoard();
  const col = boss.channel === 0 ? 1 : 6;
  battle.board[3][col] = { kind: "machine", machine: "arm", tier: 3, cooldown: 0 };
  battle.ships = [{ ...boss, y: 3, spawnAt: 0 }];
  battle.battleTime = 1;
  battle = engine.stepBattle(battle, 0.1);
  const hp = battle.ships[0].hp;
  assert.equal(battle.ships[0].bossWrenched, true);
  battle.effects.push({ id: battle.nextId++, kind: "stone", ttl: 0.3, total: 0.45,
    targetId: boss.id, channel: boss.channel, toY: 4, targetOffsetY: 0.6, fromRow: 4, fromCol: col });
  assert.equal(session.saveStoredRun(storage, battle, RUN_KEYS.interrupted), true);
  const restored = session.loadStoredRun(storage).game;
  assert.equal(restored.ships[0].bossWrenched, true);
  assert.equal(restored.effects.find(effect => effect.kind === "stone").targetOffsetY, 0.6);
  restored.effects = [];
  restored.ships[0].grappled = 0;
  restored.board[3][col].cooldown = 0;
  const next = engine.stepBattle(restored, 0.1);
  assert.equal(next.ships[0].hp, hp);
  assert.ok(!next.effects.some(effect => effect.kind === "claw"));
  const corrupted = JSON.parse(storage.getItem(session.RUN_STORAGE_KEY));
  corrupted.game.ships[0].bossWrenched = "yes";
  storage.removeItem(session.RUN_BACKUP_STORAGE_KEY);
  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify(corrupted));
  assert.equal(session.loadStoredRun(storage), null);
});

test("Fire Siphons, their volleys and the Aegis screen survive a checkpoint", () => {
  const storage = memoryStorage();
  const game = engine.startBattle({ ...engine.createInitialGame(317), tide: 12 });
  assert.ok(game.ships.some(ship => ship.screening));
  game.board[2][1] = { kind: "machine", machine: "siphon", tier: 2, cooldown: 1.25 };
  game.effects.push({ id: game.nextId++, kind: "fire", total: 0.36, ttl: 0.25,
    fromRow: 2, fromCol: 1, channel: 0, toY: 2.5 });
  assert.ok(session.saveStoredRun(storage, game, RUN_KEYS.interrupted));
  assert.deepEqual(session.loadStoredRun(storage).game, JSON.parse(JSON.stringify(game)));

  const corrupt = JSON.parse(storage.getItem(session.RUN_STORAGE_KEY));
  corrupt.game.ships[0].screening = "yes";
  storage.setItem(session.RUN_STORAGE_KEY, JSON.stringify(corrupt));
  assert.equal(session.loadStoredRun(storage), null);
});

test("a browser on plain HTTP can create a valid distinct run key without randomUUID", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues } });
  try {
    const first = session.createRunKey();
    assert.notEqual(session.createRunKey(), first);
    const storage = memoryStorage();
    session.saveStoredRun(storage, engine.createInitialGame(17), first);
    assert.equal(session.loadStoredRun(storage)?.runKey, first);
  } finally {
    Object.defineProperty(globalThis, "crypto", previous);
  }
});

test("a dense Fire Siphon volley can be saved and resumed", () => {
  const storage = memoryStorage();
  const game = engine.startBattle({ ...engine.createInitialGame(33), tide: 50 });
  for (let row = 0; row < engine.BOARD_ROWS; row++) {
    for (let col = 0; col < engine.BOARD_COLS; col++) {
      if (!engine.isWaterCol(col)) game.board[row][col] = { kind: "machine", machine: "siphon", tier: 3, cooldown: 0 };
    }
  }
  const ship = game.ships.find(ship => !ship.boss);
  game.ships = Array.from({ length: 48 }, (_, index) => ({
    ...ship, id: game.nextId++, channel: index % 2, y: Math.floor(index / 8) + 0.5,
    hp: 800, maxHp: 800, speed: 0, spawnAt: 0,
  }));
  const firing = engine.stepBattle(game, 1 / 30);
  assert.equal(firing.effects.filter(effect => effect.kind === "fire").length, 144);
  assert.ok(firing.effects.length >= 288);
  session.saveStoredRun(storage, firing, RUN_KEYS.interrupted);
  const resumed = session.loadStoredRun(storage);
  assert.ok(resumed);
  assert.deepEqual(engine.stepBattle(resumed.game, 1 / 30),
    JSON.parse(JSON.stringify(engine.stepBattle(firing, 1 / 30))));
});
