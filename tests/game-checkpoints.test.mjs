import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ appType: "custom", configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
after(() => vite.close());
const { openRunCheckpoints } = await vite.ssrLoadModule("/app/game-checkpoints.ts");
const { createInitialGame, actOnLandCell } = await vite.ssrLoadModule("/app/game-engine.ts");
const { RUN_BACKUP_STORAGE_KEY, RUN_STORAGE_KEY, createRunKey } = await vite.ssrLoadModule("/app/game-session.ts");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("backgrounding or restarting an older tab preserves newer progress", () => {
  const storage = memoryStorage();
  const key = createRunKey();
  const game = createInitialGame(12);
  const first = openRunCheckpoints(storage);
  assert.equal(first.save(game, key, []), "saved");
  const second = openRunCheckpoints(storage);
  const progressed = actOnLandCell(actOnLandCell(game, 3, 0), 3, 1);
  assert.equal(second.save(progressed, key, []), "saved");
  assert.equal(first.save(game, key, []), "other-tab");
  first.beginNew();
  assert.equal(first.save(createInitialGame(13), createRunKey(), []), "other-tab");
  assert.equal(openRunCheckpoints(storage).saved.game.actions, 4);
});

test("restarting after a quota failure retains the old checkpoints until a successful save", () => {
  const storage = memoryStorage();
  const key = createRunKey();
  const game = createInitialGame(12);
  const tab = openRunCheckpoints(storage);
  tab.save(game, key, []);
  tab.save(game, key, []);
  const backup = storage.getItem(RUN_BACKUP_STORAGE_KEY);
  assert.ok(backup);
  const oldPrimary = storage.getItem(RUN_STORAGE_KEY);
  tab.beginNew();
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error("Quota"); };
  assert.equal(tab.save(createInitialGame(13), createRunKey(), []), "unavailable");
  assert.equal(storage.getItem(RUN_STORAGE_KEY), oldPrimary);
  assert.equal(storage.getItem(RUN_BACKUP_STORAGE_KEY), backup);
  storage.setItem = setItem;
  assert.equal(tab.save(createInitialGame(13), createRunKey(), []), "saved");
  assert.equal(storage.getItem(RUN_BACKUP_STORAGE_KEY), null);
});

test("closing a second idle tab leaves the first tab's checkpoint usable", () => {
  const storage = memoryStorage();
  const key = createRunKey();
  const first = openRunCheckpoints(storage);
  const game = createInitialGame(19);
  first.save(game, key, []);
  const idle = openRunCheckpoints(storage);
  const before = storage.getItem(RUN_STORAGE_KEY);
  assert.equal(idle.save(idle.saved.game, key, idle.saved.undoHistory), "saved");
  assert.equal(storage.getItem(RUN_STORAGE_KEY), before);
  assert.equal(first.save(actOnLandCell(game, 3, 0), key, []), "saved");
});
