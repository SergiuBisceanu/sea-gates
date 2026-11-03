import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());
const { createInitialGame, actOnLandCell, selectCargoAt, startBattle, stepBattle } =
  await vite.ssrLoadModule("/app/game-engine.ts");
const route = JSON.parse(await readFile(new URL("./fixtures/tide-50-seed-1.json", import.meta.url)));

test("a fresh seed-1 campaign can survive forty-nine tides with legal moves", () => {
  let state = createInitialGame(route.seed);
  assert.equal(route.rounds.length, 49);
  for (const [index, moves] of route.rounds.entries()) {
    const tide = index + 1;
    assert.equal(state.phase, "planning", `Gate fell before Tide ${tide}`);
    assert.equal(state.tide, tide);
    assert.equal(state.actions, 5);
    for (const move of moves) {
      const before = state.actions;
      // Land gestures are [fromRow, fromCol, toRow, toCol].
      // Salvage gestures are ["cargo", row, channel, landingCol].
      if (move[0] === "cargo") {
        const [, row, channel, landingCol] = move;
        state = selectCargoAt(state, row, channel);
        state = actOnLandCell(state, row, landingCol);
      } else {
        const [fromRow, fromCol, toRow, toCol] = move;
        assert.equal(Math.abs(fromRow - toRow) + Math.abs(fromCol - toCol), 1);
        state = actOnLandCell(state, fromRow, fromCol);
        state = actOnLandCell(state, toRow, toCol);
      }
      assert.equal(state.actions, before - 1, `Invalid move on Tide ${tide}: ${move}`);
    }
    state = startBattle(state);
    let ticks = 0;
    while (state.phase === "battle") {
      assert(++ticks <= 10800, `Tide ${tide} ran for more than six simulated minutes`);
      state = stepBattle(state, 1 / 30);
    }
  }
  assert.equal(state.phase, "planning");
  assert.equal(state.tide, 50);
  assert.ok(state.harbor > 0);
});
