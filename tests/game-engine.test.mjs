import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false, ws: false },
});

after(async () => {
  await vite.close();
});

const engine = await vite.ssrLoadModule("/app/game-engine.ts");
const controls = await vite.ssrLoadModule("/app/game-controls.ts");
const history = await vite.ssrLoadModule("/app/game-history.ts");

test("a full bank redirects its forecast delivery without overwriting any piece", () => {
  const board = engine.createEmptyBoard();
  for (let row = 0; row < engine.BOARD_ROWS; row++) {
    for (const col of [0, 1]) board[row][col] = {
      kind: "machine", machine: "catapult", tier: 1, cooldown: 0,
    };
  }
  assert.equal(engine.addDawnSupply(board, 2), 3);
  assert.deepEqual(board.flat().filter((piece) => piece?.kind === "material")
    .map((piece) => piece.material).sort(), ["bronze", "stone", "timber"]);
  assert.equal(board.flat().filter((piece) => piece?.kind === "machine").length, 12);
  assert.ok(board.every((row) => engine.WATER_COLS.every((col) => row[col] === null)));
});

test("spending the final move still lets the player inspect a machine's range", () => {
  const game = engine.createInitialGame(173);
  game.actions = 0;
  game.board[3][1] = { kind: "machine", machine: "catapult", tier: 1, cooldown: 0 };
  const selected = engine.actOnLandCell(game, 3, 1);
  assert.deepEqual(selected.selection, { kind: "land", row: 3, col: 1 });
  assert.match(selected.message, /reach/);
  const attemptedMove = engine.actOnLandCell(selected, 2, 1);
  assert.deepEqual(attemptedMove.board, game.board);
  assert.equal(attemptedMove.actions, 0);
});

test("overlapping impacts keep a wreck visible through the final projectile", () => {
  const current = armBattle({ ships: [{ hp: 1, shield: 0 }] });
  current.board[3][1] = { kind: "machine", machine: "catapult", tier: 1, cooldown: 0 };
  const targetId = current.ships[0].id;
  current.effects = [{ id: 900, kind: "impact", targetId, ttl: 0.2, total: 0.73, delay: 0.45 }];
  let next = engine.stepBattle(current, 0.1);
  const hit = engine.shipActionEffect(next.ships[0], next.effects);
  assert.ok(hit.id > 900, "the lethal hit must replace the older fading impact");
  assert.equal(hit.ttl, 0.73);
  const finalId = hit.id;
  next = engine.stepBattle(next, 0.1);
  assert.equal(engine.shipActionEffect(next.ships[0], next.effects).id, finalId);
});

test("a boss's fall waits for its grapple while following hulls pass through", () => {
  const current = bossArmBattle(1);
  const boss = current.ships[0];
  boss.hp = 1;
  boss.plates = 0;
  boss.grappled = 0.9;
  current.board[3][boss.channel === 0 ? 1 : 6] = {
    kind: "machine", machine: "catapult", tier: 1, cooldown: 0,
  };
  current.effects = [{
    id: 900, kind: "claw", targetId: boss.id, ttl: 0.9, total: 1.05,
    grabY: boss.y, haulY: boss.y, channel: boss.channel,
  }];
  const follower = {
    ...boss, id: boss.id + 10, name: "Follower", boss: false, creature: undefined,
    hp: 100, maxHp: 100, plates: undefined, maxPlates: undefined, grappled: 0,
    speed: 0.4, mass: 1, shield: 0,
  };
  follower.y = boss.y + 0.1;
  current.ships.push(follower);
  let next = engine.stepBattle(current, 0.1);
  const fall = next.effects.find((effect) => effect.kind === "monsterFall");
  assert.ok(Math.abs(fall.delay - 0.8) < 1e-9);
  for (let tick = 0; tick < 10; tick++) next = engine.stepBattle(next, 0.1);
  assert.ok(next.effects.some((effect) => effect.kind === "monsterFall"));
  assert.ok(next.ships[1].y < next.ships[0].y, "a falling boss must not block its escort");
});

test("undo restores construction and salvage without duplicating moves or cargo", () => {
  let game = engine.createInitialGame(173);
  game.cargo = [{ id: 900, material: "wine", channel: 0, row: 2 }];
  const initial = structuredClone(game);
  let undo = [];
  let before = engine.actOnLandCell(game, 3, 0);
  game = engine.actOnLandCell(before, 3, 1);
  undo = history.rememberPlanningMove(undo, before, game);
  before = engine.selectCargoAt(game, 2, 0);
  game = engine.actOnLandCell(before, 2, 1);
  undo = history.rememberPlanningMove(undo, before, game);
  assert.equal(game.actions, 3);
  assert.equal(game.cargo.length, 0);
  for (let count = 0; count < 2; count++) {
    const restored = history.undoPlanningMove(game, undo);
    assert.ok(restored);
    game = restored.game;
    undo = restored.history;
  }
  assert.deepEqual(game.board, initial.board);
  assert.deepEqual(game.cargo, initial.cargo);
  assert.equal(game.actions, 5);
  assert.equal(history.undoPlanningMove(game, undo), null);
  assert.equal(history.undoPlanningMove(engine.startBattle(game), [initial]), null);
});

function battleAt(tide, runSeed = 173) {
  return engine.startBattle({
    ...engine.createInitialGame(runSeed),
    tide,
  });
}

function armBattle({ row = 3, col = 1, tier = 1, ships = [{}] } = {}) {
  const planning = engine.createInitialGame(173);
  planning.tide = 8;
  planning.board = engine.createEmptyBoard();
  planning.board[row][col] = {
    kind: "machine",
    machine: "arm",
    tier,
    cooldown: 0,
  };
  planning.harbor = 20;
  planning.maxHarbor = 20;

  const channel = engine.channelForLandCol(col);
  assert.notEqual(channel, null, "an Arm fixture must occupy land");

  const current = engine.startBattle(planning);
  current.board[row][col].cooldown = 0;
  current.effects = [];
  current.battleTime = 0.5;
  current.nextId = 20_000;
  const baseShip = current.ships.find((ship) => !ship.boss) ?? current.ships[0];
  current.ships = ships.map((overrides, index) => ({
    ...baseShip,
    id: 10_000 + index,
    name: `Test Hull ${index + 1}`,
    channel,
    y: row,
    hp: 30,
    maxHp: 30,
    speed: 0.5,
    mass: 1,
    shield: 0,
    landing: 1,
    crew: "raiders",
    cargo: undefined,
    spawnAt: 0,
    awe: 0,
    resolved: false,
    outcome: undefined,
    command: false,
    boss: false,
    creature: undefined,
    bossRank: undefined,
    plates: undefined,
    maxPlates: undefined,
    grappled: 0,
    overturned: false,
    ...overrides,
  }));
  return current;
}

function bossArmBattle(tier, { awe = 0, hpFraction = 1, tide = 5 } = {}) {
  const current = battleAt(tide, 173);
  const boss = current.ships.find((ship) => ship.boss);
  assert.ok(boss, "the Tide 5 fixture must contain a boss");
  const row = 3;
  const col = boss.channel === 0 ? 1 : 6;
  current.board = engine.createEmptyBoard();
  current.board[row][col] = {
    kind: "machine",
    machine: "arm",
    tier,
    cooldown: 0,
  };
  current.effects = [];
  current.battleTime = 0.5;
  current.ships = [{
    ...boss,
    y: row,
    hp: boss.maxHp * hpFraction,
    spawnAt: 0,
    awe,
    grappled: 0,
    resolved: false,
    outcome: undefined,
    overturned: false,
  }];
  return current;
}

test("alternates Skolopendra and Sciron's Turtle every fifth Tide", () => {
  const expected = new Map([
    [5, "skolopendra"],
    [10, "sciron-turtle"],
    [15, "skolopendra"],
    [20, "sciron-turtle"],
  ]);

  for (const [tide, creature] of expected) {
    const bosses = battleAt(tide).ships.filter((ship) => ship.boss);
    assert.equal(bosses.length, 1);
    assert.equal(bosses[0].creature, creature);
    assert.match(engine.wavePreview(tide, 173), /BOSS/);
  }
});

test("ordinary forecasts expose both channel counts and the next bank supplies", () => {
  assert.match(engine.wavePreview(1, 173), /^W 1 · E 0/);
  assert.match(engine.wavePreview(8, 173), /^W 3 · E 3/);
  assert.deepEqual(engine.dawnSupplyPreview(1), ["stone", "timber", "bronze"]);
  assert.deepEqual(engine.dawnSupplyPreview(2), ["timber", "bronze", "wine"]);
});

test("the post-boss opening introduces progressively larger reinforcement groups", () => {
  const ordinaryCount = (tide) => battleAt(tide, 173).ships.filter(
    (ship) => ship.creature !== "karkinos",
  ).length;
  assert.equal(ordinaryCount(6), 4);
  assert.equal(ordinaryCount(7), 5);
  assert.equal(ordinaryCount(8), 6);
  assert.equal(ordinaryCount(9), 8);
});

test("never adds more than one Karkinos to a Tide", () => {
  let sightings = 0;
  for (let tide = 1; tide <= 80; tide++) {
    const crabs = battleAt(tide, 99173).ships.filter(
      (ship) => ship.creature === "karkinos",
    );
    assert.ok(crabs.length <= 1);
    sightings += crabs.length;
  }
  assert.ok(sightings > 0);
});

test("Karkinos cannot create an early-game difficulty spike", () => {
  for (let runSeed = 1; runSeed <= 300; runSeed++) {
    for (let tide = 1; tide <= 5; tide++) {
      assert.equal(
        battleAt(tide, runSeed).ships.some((ship) => ship.creature === "karkinos"),
        false,
      );
    }
  }
});

test("generated fleet size rises gradually after the first Turtle", () => {
  const expected = new Map([
    [11, 8], [12, 9], [13, 9], [14, 10], [16, 11], [17, 12],
    [18, 13], [19, 13], [21, 15], [22, 15], [23, 16], [24, 17],
  ]);
  for (const [tide, count] of expected) {
    const ordinaryThreats = battleAt(tide, 173).ships.filter(
      (ship) => ship.creature !== "karkinos",
    );
    assert.equal(ordinaryThreats.length, count, `unexpected fleet size at Tide ${tide}`);
    if (tide < 20) {
      assert.ok(
        ordinaryThreats.filter((ship) => ship.command).length <= 1,
        `too many command ships at Tide ${tide}`,
      );
    }
  }
});

test("Ketos keeps an ordinary boat's combat stat line", () => {
  const ordinaryStats = new Set([
    "6|0.55|1|0|1",
    "10|0.46|1|0|2",
    "14|0.39|2|2|2",
    "16|0.35|2|1|1",
  ]);
  let ketos;

  for (let runSeed = 1; runSeed < 500 && !ketos; runSeed++) {
    for (let tide = 1; tide <= 30 && !ketos; tide++) {
      ketos = battleAt(tide, runSeed).ships.find(
        (ship) => ship.creature === "ketos",
      );
    }
  }

  assert.ok(ketos, "expected a seeded Ketos appearance");
  assert.equal(ketos.crew, undefined, "a sea creature must not inherit a deck crew");
  assert.ok(
    ordinaryStats.has(
      `${ketos.maxHp}|${ketos.speed}|${ketos.mass}|${ketos.shield}|${ketos.landing}`,
    ),
  );
});

test("the first tutorial Tide is always an ordinary skiff", () => {
  for (let runSeed = 1; runSeed <= 500; runSeed++) {
    const ships = battleAt(1, runSeed).ships;
    assert.equal(ships.length, 1);
    assert.equal(ships[0].name, "Black Skiff");
    assert.equal(ships[0].creature, undefined);
  }
});

test("light hulls carry raiders while strong hulls carry Bronze Spartoi", () => {
  const firstNamedShip = (tide, name) => {
    for (let runSeed = 1; runSeed < 500; runSeed++) {
      const ship = battleAt(tide, runSeed).ships.find(
        (candidate) => candidate.name === name,
      );
      if (ship) return ship;
    }
    assert.fail(`expected to find ${name} on Tide ${tide}`);
  };

  assert.equal(firstNamedShip(1, "Black Skiff").crew, "raiders");
  assert.equal(firstNamedShip(6, "Laden Galley").crew, "raiders");
  assert.equal(firstNamedShip(4, "Shield Ship").crew, "spartoi");
  assert.equal(firstNamedShip(8, "Command Ship").crew, "spartoi");
  assert.match(engine.wavePreview(8, 1), /Spartoi/);
});

test("a strong ship landing identifies its Spartoi assault", () => {
  let current;
  for (let runSeed = 1; runSeed < 500 && !current; runSeed++) {
    const candidate = battleAt(4, runSeed);
    if (candidate.ships.some((ship) => ship.crew === "spartoi")) {
      current = candidate;
    }
  }

  assert.ok(current, "expected a Shield Ship with a Spartoi crew");
  current.ships = current.ships.map((ship) => ({ ...ship, y: -0.05 }));
  const landed = engine.stepBattle(current, 0.1);
  const landing = landed.effects.find((effect) => effect.kind === "landing");

  assert.equal(landing?.crew, "spartoi");
  assert.match(landed.message, /Spartoi disembark/);
});

test("a landing damages its own channel instead of stealing from the opposite shore", () => {
  const current = battleAt(1, 173);
  current.board = engine.createEmptyBoard();
  current.board[0][0] = { kind: "material", material: "wine" };
  current.board[1][6] = { kind: "material", material: "bronze" };
  current.ships = [{
    ...current.ships[0],
    channel: 1,
    y: -0.05,
    spawnAt: 0,
    resolved: false,
  }];

  const landed = engine.stepBattle(current, 0.1);
  assert.equal(landed.board[0][0]?.kind, "material");
  assert.equal(landed.board[1][6], null);
  assert.match(landed.message, /Bronze stolen/);
});

test("the first Skolopendra can be beaten by the three-machine system", () => {
  const state = engine.createInitialGame(173);
  state.tide = 5;
  state.board = engine.createEmptyBoard();
  state.board[4][1] = { kind: "machine", machine: "catapult", tier: 1, cooldown: 0 };
  state.board[3][3] = { kind: "machine", machine: "catapult", tier: 1, cooldown: 0 };
  state.board[2][1] = { kind: "machine", machine: "automaton", tier: 1, cooldown: 0 };
  state.board[0][1] = { kind: "machine", machine: "arm", tier: 1, cooldown: 0 };
  state.board[0][3] = { kind: "machine", machine: "arm", tier: 1, cooldown: 0 };

  let current = engine.startBattle(state);
  for (let tick = 0; tick < 1200 && current.phase === "battle"; tick++) {
    current = engine.stepBattle(current, 0.1);
  }

  assert.equal(current.phase, "planning");
  assert.equal(current.tide, 6);
  assert.ok(current.harbor > 0);
});

test("Automata awe the armored threat that Catapults will prioritize", () => {
  const state = battleAt(8, 173);
  state.board = engine.createEmptyBoard();
  state.board[4][6] = { kind: "machine", machine: "automaton", tier: 1, cooldown: 0 };
  const shield = state.ships.find((ship) => ship.name === "Shield Ship");
  const raider = state.ships.find((ship) => ship.name === "Raider Boat");
  assert.ok(shield && raider);
  state.ships = [
    { ...shield, channel: 1, y: 3, spawnAt: 0 },
    { ...raider, channel: 1, y: 4.4, spawnAt: 0 },
  ];

  const next = engine.stepBattle(state, 0.1);
  assert.ok(next.ships.find((ship) => ship.name === "Shield Ship").awe > 0);
  assert.equal(next.ships.find((ship) => ship.name === "Raider Boat").awe, 0);
  const awe = next.effects.find((effect) => effect.kind === "awe");
  assert.deepEqual(
    { row: awe?.fromRow, col: awe?.fromCol, targetId: awe?.targetId },
    { row: 4, col: 6, targetId: shield.id },
  );
});

test("both artillery upgrades and wine support improve survival against the Tide 8 reinforcements", () => {
  const runLayout = (pieces) => {
    const planning = engine.createInitialGame(173);
    planning.tide = 8;
    planning.board = engine.createEmptyBoard();
    planning.harbor = 20;
    planning.maxHarbor = 20;
    for (const [row, col, machine, tier] of pieces) {
      planning.board[row][col] = { kind: "machine", machine, tier, cooldown: 0 };
    }
    let current = engine.startBattle(planning);
    for (let tick = 0; tick < 1600 && current.phase === "battle"; tick++) {
      current = engine.stepBattle(current, 0.1);
    }
    return 20 - current.harbor;
  };

  const basicArtilleryLosses = runLayout([
    [3, 1, "catapult", 1], [3, 6, "catapult", 1],
  ]);
  const mergedArtilleryLosses = runLayout([
    [3, 1, "catapult", 2], [3, 6, "catapult", 2],
  ]);
  const mixedDefenseLosses = runLayout([
    [3, 1, "catapult", 1], [3, 6, "catapult", 1],
    [2, 1, "automaton", 1], [2, 6, "automaton", 1],
  ]);
  assert.ok(mixedDefenseLosses < basicArtilleryLosses);
  assert.ok(mergedArtilleryLosses < basicArtilleryLosses);
});

test("multiple Automata spread awe across different threats", () => {
  const current = armBattle({
    ships: [
      { id: 10_001, name: "Shield One", mass: 2, shield: 2, y: 3 },
      { id: 10_002, name: "Shield Two", mass: 2, shield: 2, y: 4.4 },
    ],
  });
  current.board = engine.createEmptyBoard();
  current.board[3][1] = {
    kind: "machine", machine: "automaton", tier: 1, cooldown: 0,
  };
  current.board[4][1] = {
    kind: "machine", machine: "automaton", tier: 1, cooldown: 0,
  };

  const next = engine.stepBattle(current, 0.1);
  const awed = next.ships.filter((ship) => ship.awe > 0);
  const targets = next.effects
    .filter((effect) => effect.kind === "awe")
    .map((effect) => effect.targetId);
  assert.equal(awed.length, 2);
  assert.equal(new Set(targets).size, 2);
});

test("an Automaton-only defense slows but cannot freeze a fleet forever", () => {
  const planning = engine.createInitialGame(173);
  planning.board = engine.createEmptyBoard();
  planning.board[3][1] = {
    kind: "machine", machine: "automaton", tier: 3, cooldown: 0,
  };
  let current = engine.startBattle(planning);
  let ticks = 0;
  for (; ticks < 600 && current.phase === "battle"; ticks++) {
    current = engine.stepBattle(current, 0.1);
  }
  assert.notEqual(current.phase, "battle");
  assert.ok(ticks < 350);
  assert.ok(current.harbor < current.maxHarbor);
});

test("the final defeated ship remains on screen until its hit animation resolves", () => {
  const planning = engine.createInitialGame(173);
  planning.board = engine.createEmptyBoard();
  planning.board[3][1] = {
    kind: "machine",
    machine: "catapult",
    tier: 3,
    cooldown: 0,
  };

  let current = engine.startBattle(planning);
  current.board[3][1].cooldown = 0;
  current.ships = [
    {
      ...current.ships[0],
      channel: 0,
      y: 3,
      spawnAt: 0,
      hp: 1,
      maxHp: 1,
      shield: 0,
    },
  ];

  current = engine.stepBattle(current, 0.1);
  assert.equal(current.ships[0].resolved, true);
  assert.equal(current.phase, "battle");
  const stone = current.effects.find((effect) => effect.kind === "stone");
  assert.deepEqual(
    { row: stone?.fromRow, col: stone?.fromCol, targetId: stone?.targetId },
    { row: 3, col: 1, targetId: current.ships[0].id },
  );

  for (let tick = 0; tick < 30 && current.phase === "battle"; tick++) {
    current = engine.stepBattle(current, 0.1);
  }
  assert.equal(current.phase, "planning");
  assert.equal(current.tide, 2);
});

test("a defeated Skolopendra stays through its complete animated fall", () => {
  const planning = engine.createInitialGame(173);
  planning.tide = 5;
  planning.board = engine.createEmptyBoard();
  let current = engine.startBattle(planning);
  const boss = current.ships.find((ship) => ship.creature === "skolopendra");
  assert.ok(boss);

  const catapultCol = boss.channel === 0 ? 1 : 6;
  current.board[3][catapultCol] = {
    kind: "machine",
    machine: "catapult",
    tier: 3,
    cooldown: 0,
  };
  current.ships = [{
    ...boss,
    y: 3,
    spawnAt: 0,
    hp: 1,
    shield: 0,
    plates: 0,
    maxPlates: 0,
  }];

  current = engine.stepBattle(current, 0.1);
  const fall = current.effects.find((effect) => effect.kind === "monsterFall");
  assert.equal(current.ships[0].resolved, true);
  assert.equal(current.phase, "battle");
  assert.ok(fall);
  assert.equal(fall?.creature, "skolopendra");
  assert.equal(fall?.targetId, boss.id);
  assert.equal(fall?.delay, 0.45);
  assert.ok(Math.abs(fall.total - 1.6) < 1e-9);

  for (let tick = 0; tick < 5; tick++) current = engine.stepBattle(current, 0.1);
  assert.equal(current.phase, "battle");
  assert.ok(current.effects.some((effect) => effect.kind === "monsterFall"));

  for (let tick = 0; tick < 20 && current.phase === "battle"; tick++) {
    current = engine.stepBattle(current, 0.1);
  }
  assert.equal(current.phase, "planning");
  assert.equal(current.tide, 6);
});

test("a single Arm works from every land row and column in its assigned channel", () => {
  const landCols = [0, 1, 3, 4, 6, 7];

  for (let row = 0; row < engine.BOARD_ROWS; row++) {
    for (const col of landCols) {
      const current = armBattle({ row, col });
      const next = engine.stepBattle(current, 0.1);
      const claw = next.effects.find((effect) => effect.kind === "claw");

      assert.equal(next.ships[0].resolved, true, `Arm at ${row},${col} stayed inert`);
      assert.equal(next.ships[0].outcome, "captured");
      assert.deepEqual(
        { row: claw?.fromRow, col: claw?.fromCol, channel: claw?.channel },
        { row, col, channel: engine.channelForLandCol(col) },
      );
    }
  }
});

test("Arm tier is independent lifting capacity and capture rewards resolve once", () => {
  for (const tier of [1, 2, 3]) {
    const current = armBattle({
      row: 2,
      col: 1,
      tier,
      ships: [{ mass: tier, cargo: "bronze" }],
    });
    const next = engine.stepBattle(current, 0.1);
    const claw = next.effects.find((effect) => effect.kind === "claw");
    const bronzeCount = next.board
      .flat()
      .filter((piece) => piece?.kind === "material" && piece.material === "bronze")
      .length;

    assert.equal(next.ships[0].outcome, "captured");
    assert.equal(next.captures, 1);
    assert.equal(next.kleos, 20 + tier * 10);
    assert.equal(bronzeCount, 1);
    assert.equal(claw?.armOutcome, "capture");
    assert.equal(claw?.grabY, 2);
    assert.ok(Number.isFinite(claw?.haulY));
    assert.equal(Object.hasOwn(claw, "secondaryFromCol"), false);

    const afterAnimationTick = engine.stepBattle(next, 0.1);
    const bronzeCountAgain = afterAnimationTick.board
      .flat()
      .filter((piece) => piece?.kind === "material" && piece.material === "bronze")
      .length;
    assert.equal(afterAnimationTick.captures, 1);
    assert.equal(afterAnimationTick.kleos, 20 + tier * 10);
    assert.equal(bronzeCountAgain, 1);
  }
});

test("an Arm prefers a capturable hull over a heavier hull in the same reach window", () => {
  const current = armBattle({
    row: 3,
    col: 1,
    tier: 1,
    ships: [
      { id: 10_001, name: "Heavy Hull", mass: 3, y: 2.4, hp: 40, maxHp: 40 },
      { id: 10_002, name: "Light Hull", mass: 1, y: 3.7, hp: 12, maxHp: 12 },
    ],
  });
  const next = engine.stepBattle(current, 0.1);
  const heavy = next.ships.find((ship) => ship.name === "Heavy Hull");
  const light = next.ships.find((ship) => ship.name === "Light Hull");
  const claw = next.effects.find((effect) => effect.kind === "claw");

  assert.equal(light?.outcome, "captured");
  assert.equal(heavy?.resolved, false);
  assert.equal(heavy?.hp, 40, "the Arm should not waste its action wrenching the heavy hull");
  assert.equal(claw?.targetId, light?.id);
  assert.equal(claw?.armOutcome, "capture");
});

test("an under-strength Arm wrenches a heavy hull instead of silently doing nothing", () => {
  const current = armBattle({
    row: 3,
    col: 1,
    tier: 1,
    ships: [{ name: "Heavy Hull", mass: 3, y: 3, hp: 40, maxHp: 40 }],
  });
  const next = engine.stepBattle(current, 0.1);
  const target = next.ships[0];
  const claw = next.effects.find((effect) => effect.kind === "claw");

  assert.equal(target.resolved, false);
  assert.ok(target.hp < 40, "a failed lift should still tear the hull");
  assert.ok(target.y > 3, "the wrench should push the hull seaward");
  assert.ok(target.grappled > 0);
  assert.equal(claw?.armOutcome, "wrench");
  assert.equal(claw?.grabY, 3);
  assert.equal(claw?.haulY, target.y);
  assert.equal(Object.hasOwn(claw, "secondaryFromCol"), false);
});

test("wrenching a lead hull moves only its victim, even into another hull", () => {
  const current = armBattle({
    row: 3,
    col: 1,
    tier: 1,
    ships: [
      { id: 10_001, name: "Lead Hull", mass: 3, y: 3 },
      { id: 10_002, name: "Middle Hull", mass: 3, y: 4.3 },
      { id: 10_003, name: "Rear Hull", mass: 3, y: 5.6 },
    ],
  });
  const beforeFollowers = current.ships.slice(1).map((ship) => ship.y);
  const next = engine.stepBattle(current, 0.1);
  const lead = next.ships.find((ship) => ship.id === 10_001);
  const followers = next.ships.filter((ship) => ship.id !== 10_001);

  assert.ok(Math.abs((lead?.y ?? Number.NaN) - 3.28) < 1e-8);
  assert.ok(
    followers.every((ship, index) => ship.y <= beforeFollowers[index] + 1e-8),
  );
  assert.ok(followers.every((ship) => ship.y <= engine.CHANNEL_ENTRY_Y + 1e-8));
});

test("a resolving Catapult wreck neither blocks an Arm pull nor following ships", () => {
  const current = armBattle({
    row: 3,
    col: 1,
    tier: 1,
    ships: [
      { id: 10_001, name: "Lead Hull", mass: 3, y: 3, hp: 30, maxHp: 30 },
      { id: 10_002, name: "Splash Hull", mass: 1, y: 4.3, hp: 2, maxHp: 2 },
      { id: 10_003, name: "Rear Hull", mass: 3, y: 5.6, hp: 30, maxHp: 30 },
    ],
  });
  current.board[3][0] = {
    kind: "machine",
    machine: "catapult",
    tier: 3,
    cooldown: 0,
  };

  const next = engine.stepBattle(current, 0.1);
  const lead = next.ships.find((ship) => ship.id === 10_001);
  const wreck = next.ships.find((ship) => ship.id === 10_002);
  const rear = next.ships.find((ship) => ship.id === 10_003);

  assert.equal(wreck?.hp, 0);
  assert.ok(next.effects.some(
    (effect) => effect.kind === "impact" && effect.targetId === wreck?.id,
  ));
  assert.ok(Math.abs((lead?.y ?? Number.NaN) - 3.28) < 1e-8);
  assert.ok((wreck?.y ?? Number.POSITIVE_INFINITY) <= 4.3 + 1e-8);
  assert.ok((rear?.y ?? Number.POSITIVE_INFINITY) <= 5.6 + 1e-8);
  assert.ok((rear?.y ?? Number.POSITIVE_INFINITY) <= engine.CHANNEL_ENTRY_Y);
});

test("the first Arm tears a tier-scaled share from a boss without killing it", () => {
  const expectedFractions = [0.18, 0.27, 0.36];
  for (const tide of [5, 10, 45, 50]) {
    for (const tier of [1, 2, 3]) {
      const struck = engine.stepBattle(bossArmBattle(tier, { tide }), 0.1);
      const boss = struck.ships[0];
      const expectedDamage = Math.ceil(boss.maxHp * expectedFractions[tier - 1]);
      assert.equal(boss.hp, boss.maxHp - expectedDamage);
      assert.equal(boss.resolved, false);
      assert.ok(boss.hp > 0);
      assert.equal(boss.bossWrenched, true);
      if (tier === 3) assert.ok(boss.plates < boss.maxPlates);
    }
  }

  const wrenched = engine.stepBattle(bossArmBattle(1), 0.1);
  const wrenchedBoss = wrenched.ships[0];
  const wrench = wrenched.effects.find((effect) => effect.kind === "claw");
  assert.ok(wrenchedBoss.hp < wrenchedBoss.maxHp);
  assert.ok(wrenchedBoss.y > 3);
  assert.equal(wrenchedBoss.overturned, false);
  assert.equal(wrench?.armOutcome, "wrench");
  assert.equal(wrench?.grabY, 3);
  assert.equal(wrench?.haulY, wrenchedBoss.y);
  assert.equal(Object.hasOwn(wrench, "secondaryFromCol"), false);

  for (const tide of [5, 10, 45, 50]) {
    for (const tier of [1, 2, 3]) {
      const setup = bossArmBattle(tier, { hpFraction: 0.05, tide });
      const startingHp = setup.ships[0].hp;
      const expectedHp = Math.max(
        1,
        startingHp - Math.ceil(startingHp * expectedFractions[tier - 1]),
      );
      const nearlyDead = engine.stepBattle(setup, 0.1);
      assert.equal(nearlyDead.ships[0].hp, expectedHp);
      assert.equal(nearlyDead.ships[0].resolved, false);
    }
  }
});

test("wine cannot turn a weakened boss into a one-HP execution", () => {
  for (const tide of [5, 10, 45, 50]) {
    const current = bossArmBattle(3, { tide, awe: 1, hpFraction: 0.3 });
    const hp = current.ships[0].hp;
    const struck = engine.stepBattle(current, 0.1);
    assert.equal(struck.ships[0].hp, Math.max(1, hp - Math.ceil(hp * 0.36)));
    assert.equal(struck.ships[0].overturned, false);
    assert.equal(struck.ships[0].resolved, false);
    assert.equal(struck.effects.find(effect => effect.kind === "claw").armOutcome, "wrench");
  }
});

test("a boss permits one pull across all Arms, reloads, and wine pulses", () => {
  for (const tide of [5, 10, 45, 50]) {
    let current = bossArmBattle(3, { tide, awe: 10 });
    const channel = current.ships[0].channel;
    for (let row = 0; row < 6; row++) {
      for (const col of channel === 0 ? [0, 1, 3] : [4, 6, 7]) {
        current.board[row][col] = { kind: "machine", machine: "arm", tier: 3, cooldown: 0 };
      }
    }
    const first = engine.stepBattle(current, 0.1);
    const expectedHp = first.ships[0].hp;
    const claws = new Set(first.effects.filter(effect => effect.kind === "claw").map(effect => effect.id));
    let boss = first.ships[0];
    current = first;
    for (let tick = 0; tick < 200 && current.phase === "battle"; tick++) {
      current = engine.stepBattle(current, 0.1);
      for (const effect of current.effects) if (effect.kind === "claw") claws.add(effect.id);
      if (current.phase === "planning") {
        assert.equal(boss.outcome, "landed", "a surviving gate clears the fleet at dawn");
        break;
      }
      boss = current.ships[0];
      assert.equal(boss.hp, expectedHp, "another Arm damaged the immune boss");
    }
    assert.equal(claws.size, 1);
    assert.equal(boss.bossWrenched, true);
    assert.ok(boss.y < first.ships[0].y, "boss must advance after that single pull");
  }
});

test("Arms ignore a chain-broken boss and capture its passing escort", () => {
  const current = armBattle({ tier: 3, ships: [
    { boss: true, mass: 4, bossWrenched: true, y: 3 },
    { mass: 2, y: 3.05 },
  ] });
  const next = engine.stepBattle(current, 0.1);
  assert.equal(next.ships[0].hp, current.ships[0].hp);
  assert.equal(next.ships[1].outcome, "captured");
  assert.equal(next.effects.find(effect => effect.kind === "claw").targetId, next.ships[1].id);
});

test("Catapults can fire on enemies already at the gate", () => {
  const current = armBattle({ ships: [{ hp: 12, maxHp: 12, y: 0.5 }] });
  current.board = engine.createEmptyBoard();
  current.board[1][1] = {
    kind: "machine", machine: "catapult", tier: 1, cooldown: 0,
  };
  const fired = engine.stepBattle(current, 0.1);
  assert.ok(fired.ships[0].hp < 12);
  assert.ok(fired.effects.some((effect) => effect.kind === "stone"));
});

test("a sinking wreck stays visible while its follower advances through it", () => {
  const current = armBattle({
    ships: [
      { id: 10_001, name: "Front Hull", hp: 1, maxHp: 1, mass: 3, y: 3 },
      { id: 10_002, name: "Following Hull", hp: 12, maxHp: 12, mass: 1, y: 3.2 },
    ],
  });
  current.board = engine.createEmptyBoard();
  current.board[3][1] = {
    kind: "machine", machine: "catapult", tier: 3, cooldown: 0,
  };
  const next = engine.stepBattle(current, 0.1);
  const front = next.ships.find((ship) => ship.id === 10_001);
  const follower = next.ships.find((ship) => ship.id === 10_002);
  assert.equal(front?.resolved, true);
  assert.ok(front && follower);
  assert.ok(Math.abs(follower.y - 3.15) < 1e-8);
  assert.ok(engine.shipActionEffect(front, next.effects), "the wreck still needs its impact animation");
});

test("Tier III Catapult splash gives its secondary victim an impact animation", () => {
  const current = armBattle({
    ships: [
      { id: 10_001, name: "Primary Hull", hp: 30, maxHp: 30, mass: 3, y: 3 },
      { id: 10_002, name: "Nearby Hull", hp: 10, maxHp: 10, mass: 1, y: 3.2 },
    ],
  });
  current.board = engine.createEmptyBoard();
  current.board[3][1] = {
    kind: "machine", machine: "catapult", tier: 3, cooldown: 0,
  };
  const next = engine.stepBattle(current, 0.1);
  const secondary = next.ships.find((ship) => ship.id === 10_002);
  assert.equal(secondary?.hp, 8);
  assert.ok(
    next.effects.some(
      (effect) => effect.kind === "impact" && effect.targetId === secondary?.id,
    ),
  );
});

test("a grappled target stays fixed until the Arm releases it", () => {
  const current = armBattle({
    ships: [{ y: 3, speed: 1, grappled: 0.5 }],
  });
  current.board = engine.createEmptyBoard();

  const held = engine.stepBattle(current, 0.1);
  assert.equal(held.ships[0].y, 3);
  assert.ok(held.ships[0].grappled > 0);

  const released = {
    ...held,
    ships: held.ships.map((ship) => ({ ...ship, grappled: 0 })),
  };
  const advancing = engine.stepBattle(released, 0.1);
  assert.ok(advancing.ships[0].y < 3);
});

test("starts with a complete recipe and a future ingredient in each land bank", () => {
  const state = engine.createInitialGame(173);
  const banks = [[0, 1], [3, 4], [6, 7]];
  const materialsByBank = banks.map((cols) =>
    state.board
      .flatMap((row) => cols.map((col) => row[col]))
      .filter((piece) => piece?.kind === "material")
      .map((piece) => piece.material),
  );

  assert.deepEqual(materialsByBank[0].sort(), ["bronze", "stone", "timber"]);
  assert.deepEqual(materialsByBank[1].sort(), ["bronze", "stone", "timber"]);
  assert.deepEqual(materialsByBank[2].sort(), ["bronze", "timber", "wine"]);
});

test("dead-end planning gestures do not consume moves or lose selected cargo", () => {
  const identical = engine.createInitialGame(173);
  identical.board = engine.createEmptyBoard();
  identical.board[2][0] = { kind: "material", material: "stone" };
  identical.board[2][1] = { kind: "material", material: "stone" };
  const selectedStone = engine.actOnLandCell(identical, 2, 0);
  const rejectedMerge = engine.actOnLandCell(selectedStone, 2, 1);
  assert.equal(rejectedMerge.actions, identical.actions);
  assert.deepEqual(rejectedMerge.board, identical.board);

  const salvage = engine.createInitialGame(173);
  salvage.board = engine.createEmptyBoard();
  salvage.cargo = [{ id: 900, material: "bronze", channel: 0, row: 2 }];
  salvage.board[2][1] = { kind: "material", material: "wine" };
  const selectedCargo = engine.selectCargoAt(salvage, 2, 0);
  const occupiedShore = engine.actOnLandCell(selectedCargo, 2, 1);
  assert.deepEqual(occupiedShore.selection, { kind: "cargo", id: 900 });
  assert.equal(occupiedShore.actions, salvage.actions);
  const emptyWater = engine.selectCargoAt(occupiedShore, 5, 1);
  assert.deepEqual(emptyWater.selection, { kind: "cargo", id: 900 });
});

test("swipes resolve to one adjacent cell and reject noise or board edges", () => {
  assert.equal(controls.SWIPE_THRESHOLD, 14);
  assert.deepEqual(controls.resolveSwipeTarget(3, 3, 30, 4), { row: 3, col: 4 });
  assert.deepEqual(controls.resolveSwipeTarget(3, 3, -4, -30), { row: 2, col: 3 });
  assert.equal(controls.resolveSwipeTarget(3, 3, 8, 7), null);
  assert.equal(controls.resolveSwipeTarget(0, 0, -30, 0), null);
  assert.equal(controls.resolveSwipeTarget(2, 1, 30, 0), null);
});

test("ordinary fleets keep gaining veteran durability after their size cap", () => {
  const durability = (tide) => battleAt(tide, 173).ships
    .filter((ship) => !ship.creature)
    .reduce((total, ship) => total + ship.maxHp, 0);
  assert.ok(durability(46) > durability(34));
  assert.ok(durability(58) > durability(46));
  assert.match(engine.wavePreview(46, 173), /veteran/);
  assert.ok(battleAt(99, 173).ships.some((ship) => !ship.boss && ship.mass === 4));
  assert.ok(battleAt(139, 173).ships.filter((ship) => !ship.boss).every((ship) => ship.mass === 4));
});

test("a fixed six-machine defense is overwhelmed well before Tide 50", () => {
  const planning = engine.createInitialGame(173);
  planning.tide = 40;
  planning.board = engine.createEmptyBoard();
  for (const [row, col, machine] of [
    [3, 1, "catapult"], [3, 6, "catapult"],
    [2, 1, "arm"], [2, 6, "arm"],
    [4, 1, "automaton"], [4, 6, "automaton"],
  ]) {
    planning.board[row][col] = { kind: "machine", machine, tier: 3, cooldown: 0 };
  }
  let current = engine.startBattle(planning);
  for (let tick = 0; tick < 3_000 && current.phase === "battle"; tick++) {
    current = engine.stepBattle(current, 1 / 30);
  }
  assert.equal(current.phase, "gameover");
  assert.equal(current.harbor, 0);
});

test("randomized fleets keep a rising difficulty envelope and bounded enemy counts", () => {
  for (const seed of [1, 173, 99173]) {
    const hpByTide = new Map();
    let previousCount = 0;
    for (let tide = 11; tide <= 100; tide++) {
      if (tide % 5 === 0) continue;
      const fleet = battleAt(tide, seed).ships.filter(ship => ship.creature !== "karkinos");
      const hp = fleet.reduce((total, ship) => total + ship.maxHp, 0);
      const earlierHp = hpByTide.get(tide - 10);
      if (earlierHp) assert.ok(hp > earlierHp, `fleet durability failed to rise over ten Tides at ${tide}`);
      assert.ok(fleet.length >= previousCount, `fleet size fell at Tide ${tide}`);
      assert.ok(fleet.length <= 52, "endless difficulty must not create unbounded enemy counts");
      assert.ok(Math.abs(fleet.filter(ship => ship.channel === 0).length - fleet.filter(ship => ship.channel === 1).length) <= 1);
      hpByTide.set(tide, hp);
      previousCount = fleet.length;
    }
  }
  assert.ok(battleAt(49).ships.length >= 33);
  const lateFleet = battleAt(49).ships;
  assert.ok(lateFleet.some(ship => ship.mass === 4), "late fleets must challenge capture-only defenses");
  assert.ok(lateFleet.some(ship => ship.mass <= 3), "late Arms must retain capturable targets");
});

test("fleet rolls vary hulls and order while keeping forecasts repeatable and avoiding extreme rolls", () => {
  for (const tide of [11, 19, 29, 49, 75]) {
    const compositions = new Set();
    const orders = new Set();
    const durability = [];
    for (let seed = 1; seed <= 100; seed++) {
      const battle = battleAt(tide, seed);
      assert.deepEqual(battle.ships, battleAt(tide, seed).ships, "opening a forecast cannot reroll the fleet");
      const ships = battle.ships.filter(ship => ship.creature !== "karkinos");
      const hull = ship => `${ship.maxHp}/${ship.speed}/${ship.mass}/${ship.shield}`;
      compositions.add(ships.map(hull).sort().join("|"));
      orders.add(ships.map(ship => `${ship.channel}:${hull(ship)}`).join("|"));
      durability.push(ships.reduce((sum, ship) => sum + ship.maxHp, 0));
      if (tide < 20) assert.ok(ships.filter(ship => ship.command).length <= 1);
      const west = battle.ships.filter(ship => ship.channel === 0).length;
      if (tide % 5 !== 0) assert.ok(engine.wavePreview(tide, seed).startsWith(`W ${west} · E ${battle.ships.length - west}`));
      if (tide % 5 !== 0) assert.equal(ships.filter(ship => ship.cargo).length, 1);
    }
    assert.ok(compositions.size >= 3, `Tide ${tide} needs meaningful hull variety`);
    assert.ok(orders.size >= 20, `Tide ${tide} needs varied sailing order`);
    assert.ok(Math.max(...durability) / Math.min(...durability) < 1.35, `Tide ${tide} has an extreme random health swing`);
  }
  const bossChannels = new Set(Array.from({ length: 40 }, (_, seed) => battleAt(25, seed).ships.find(ship => ship.boss).channel));
  assert.equal(bossChannels.size, 2);
});

test("shuffled Dawn bags match the forecast and supply every material to every bank", () => {
  const patterns = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    for (let firstTide = 6; firstTide <= 46; firstTide += 4) {
      const banks = [[], [], []];
      for (let tide = firstTide; tide < firstTide + 4; tide++) {
        const forecast = engine.dawnSupplyPreview(tide - 1, seed);
        assert.equal(new Set(forecast).size, 3, "each Dawn should offer three different materials");
        const board = engine.createEmptyBoard();
        assert.equal(engine.addDawnSupply(board, tide, seed), 3);
        for (const [bank, cols] of [[0, [0, 1]], [1, [3, 4]], [2, [6, 7]]]) {
          const delivered = board.flatMap(row => cols.map(col => row[col])).find(Boolean);
          assert.equal(delivered.material, forecast[bank]);
          banks[bank].push(delivered.material);
        }
      }
      for (const bank of banks) assert.deepEqual([...bank].sort(), ["bronze", "stone", "timber", "wine"]);
      if (firstTide === 6) patterns.add(banks.flat().join("|"));
    }
  }
  assert.ok(patterns.size > 12, "different runs should receive different supply sequences");
});

test("later bosses bring stronger monsters, growing escorts, and a vanguard in their own lane", () => {
  let previousEscorts = 0;
  const lastBoss = new Map();
  for (let tide = 5; tide <= 60; tide += 5) {
    const ships = battleAt(tide).ships;
    const boss = ships.find(ship => ship.boss);
    const previous = lastBoss.get(boss.creature);
    if (previous) {
      assert.ok(boss.maxHp > previous.maxHp);
      assert.ok(boss.speed >= previous.speed);
      assert.ok(boss.maxPlates >= previous.maxPlates);
    }
    const escorts = ships.filter(ship => !ship.boss);
    assert.ok(escorts.length >= previousEscorts);
    if (tide >= 25) {
      assert.ok(escorts.some(ship => ship.channel === boss.channel && ship.spawnAt < boss.spawnAt));
      assert.ok(escorts.some(ship => ship.channel !== boss.channel));
    }
    lastBoss.set(boss.creature, boss);
    previousEscorts = escorts.length;
  }
  const hp = tide => battleAt(tide).ships.reduce((sum, ship) => sum + ship.maxHp, 0);
  assert.ok(hp(50) > hp(49), "the Tide 50 boss must not be a low-pressure break");
});

function developedDefense(size) {
  const board = engine.createEmptyBoard();
  for (const [outer, shore, inner] of [[0, 1, 3], [7, 6, 4]]) {
    const pieces = [
      [3, shore, "catapult"], [2, shore, "arm"], [4, shore, "automaton"],
      [3, outer, "catapult"], [4, outer, "catapult"], [5, shore, "arm"],
    ];
    if (size >= 18) pieces.push([2, outer, "catapult"], [1, shore, "arm"], [1, inner, "automaton"]);
    if (size >= 24) pieces.push([0, outer, "catapult"], [0, shore, "catapult"], [5, outer, "catapult"]);
    for (const [row, col, machine] of pieces) {
      board[row][col] = { kind: "machine", machine, tier: 3, cooldown: 0 };
    }
  }
  return board;
}

function fightWithDefense(tide, size, seed) {
  const planning = { ...engine.createInitialGame(seed), tide, board: developedDefense(size) };
  let current = engine.startBattle(planning);
  for (let tick = 0; tick < 3000 && current.phase === "battle"; tick++) {
    current = engine.stepBattle(current, 1 / 30);
  }
  assert.notEqual(current.phase, "battle", `Tide ${tide} did not resolve within 100 seconds`);
  return current;
}

test("Tide 50 defeats settled boards and requires an exceptional expanded defense", () => {
  for (const seed of [1, 173, 99173]) {
    assert.equal(fightWithDefense(30, 12, seed).phase, "planning");
    assert.equal(fightWithDefense(40, 12, seed).phase, "planning");
    assert.equal(fightWithDefense(45, 12, seed).phase, "gameover");
    assert.equal(fightWithDefense(45, 18, seed).phase, "planning");
    assert.equal(fightWithDefense(50, 18, seed).phase, "gameover");
    assert.equal(fightWithDefense(49, 24, seed).phase, "planning");
    assert.equal(fightWithDefense(60, 24, seed).phase, "gameover");
  }
  const finalists = Array.from({ length: 16 }, (_, index) => fightWithDefense(50, 24, index + 1));
  const wins = finalists.filter(game => game.phase === "planning");
  assert.ok(wins.length > 0, "Tide 50 must remain beatable");
  assert.ok(wins.length < finalists.length / 2, "even this expensive defense should usually fail Tide 50");
});

test("Dawn supply is plentiful and even across all three land banks", () => {
  const board = engine.createEmptyBoard();
  const banks = [[0, 1], [3, 4], [6, 7]];

  for (let tide = 2; tide <= 5; tide++) {
    assert.equal(engine.addDawnSupply(board, tide), 3);
    for (const cols of banks) {
      const pieces = board
        .flatMap((row) => cols.map((col) => row[col]))
        .filter((piece) => piece?.kind === "material");
      assert.equal(pieces.length, tide - 1);
    }
  }

  for (const cols of banks) {
    const materials = board
      .flatMap((row) => cols.map((col) => row[col]))
      .filter((piece) => piece?.kind === "material")
      .map((piece) => piece.material)
      .sort();
    assert.deepEqual(materials, ["bronze", "stone", "timber", "wine"]);
  }

  const fullCycleBoard = engine.createEmptyBoard();
  for (let tide = 2; tide <= 13; tide++) {
    assert.equal(engine.addDawnSupply(fullCycleBoard, tide), 3);
  }
  for (const cols of banks) {
    for (let row = 0; row < engine.BOARD_ROWS; row++) {
      assert.ok(cols.every((col) => fullCycleBoard[row][col]?.kind === "material"));
    }
  }
});

test("Dawn arrivals prefer a recipe partner without changing the forecast", () => {
  const board = engine.createEmptyBoard();
  board[2][0] = { kind: "material", material: "timber" };
  const forecast = engine.dawnSupplyPreview(1);
  engine.addDawnSupply(board, 2);
  const stone = board.flatMap((row, rowIndex) => row.map((piece, col) =>
    piece?.kind === "material" && piece.material === forecast[0] && col < 2
      ? { row: rowIndex, col } : null,
  )).find(Boolean);
  assert.ok(stone);
  assert.equal(Math.abs(stone.row - 2) + stone.col, 1);
  assert.equal(board[2][0].material, "timber", "existing pieces are never overwritten");
});

test("Catapults protect an imminent breach before targeting a distant heavy hull", () => {
  const current = armBattle({ row: 3, col: 1, ships: [
    { y: 0.15, hp: 4, maxHp: 4, mass: 1 },
    { y: 4, hp: 100, maxHp: 100, mass: 3, shield: 3 },
  ] });
  current.board[3][1] = { kind: "machine", machine: "catapult", tier: 3, cooldown: 0 };
  const next = engine.stepBattle(current, 1 / 30);
  assert.equal(next.effects.find((effect) => effect.kind === "stone")?.targetId, current.ships[0].id);
  assert.equal(next.ships[0].outcome, "sunk");
  assert.equal(next.harbor, current.harbor);
});

test("floating cargo never stacks and prefers an accessible shore", () => {
  const current = armBattle({ ships: [
    { y: 2, hp: 0, cargo: "bronze" },
    { y: 2, hp: 0, cargo: "wine" },
  ] });
  current.board = engine.createEmptyBoard();
  current.board[2][1] = { kind: "material", material: "stone" };
  current.board[2][3] = { kind: "material", material: "stone" };
  const next = engine.stepBattle(current, 1 / 30);
  assert.equal(next.cargo.length, 2);
  assert.equal(new Set(next.cargo.map((cargo) => `${cargo.channel}:${cargo.row}`)).size, 2);
  assert.ok(next.cargo.every((cargo) => cargo.row !== 2));
  assert.deepEqual(next.cargo.map((cargo) => cargo.material).sort(), ["bronze", "wine"]);
});

test("invalid simulation deltas do not corrupt or advance a run", () => {
  const current = battleAt(5);
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(engine.stepBattle(current, dt), current);
  }
});

test("machine coverage describes the same channel and tier rules as combat", () => {
  assert.deepEqual(engine.machineCoverage({ kind: "machine", machine: "automaton", tier: 3, cooldown: 0 }, 3), { channels: [0, 1], range: 2.65 });
  assert.deepEqual(engine.machineCoverage({ kind: "machine", machine: "arm", tier: 1, cooldown: 0 }, 7), { channels: [1], range: 0.72 });
  assert.deepEqual(engine.machineCoverage({ kind: "machine", machine: "catapult", tier: 3, cooldown: 0 }, 1), { channels: [0], range: 6.5 });
});

test("faster hulls overtake live, awed, grappled, and sinking enemies without displacement", () => {
  for (const front of [{ speed: 0.1 }, { speed: 0.6, awe: 10 }, { grappled: 10 }, { resolved: true, outcome: "sunk" }]) {
    let current = armBattle({ ships: [
      { id: 10001, y: 3, ...front },
      { id: 10002, y: 3.1, speed: 1 },
    ] });
    current.board = engine.createEmptyBoard();
    current.effects = [{ id: 30000, kind: "impact", targetId: 10001, ttl: 2, total: 2 }];
    for (let tick = 1; tick <= 10; tick++) {
      current = engine.stepBattle(current, 0.1);
      assert.ok(Math.abs(current.ships[1].y - (3.1 - tick * 0.1)) < 1e-8);
    }
    assert.ok(current.ships[1].y < current.ships[0].y);
    assert.ok(current.effects.some(effect => effect.targetId === 10001));
  }
});

test("late waves sustain multiple assaults with fixed departures despite blocked leaders", () => {
  for (const tide of [11, 19, 29, 40, 49, 50]) {
    const initial = battleAt(tide, 173);
    const departures = initial.ships.map(ship => ship.spawnAt);
    const last = Math.max(...departures);
    assert.ok(last >= (tide >= 40 ? 36 : tide >= 20 ? 27 : 9));
    assert.ok(new Set(departures.map(time => Math.floor(time / 9))).size >= 3);
    initial.board = engine.createEmptyBoard();
    initial.ships[0].grappled = 100;
    initial.ships[0].speed = 0.001;
    const next = engine.stepBattle(initial, 0.1);
    assert.deepEqual(next.ships.map(ship => ship.spawnAt), departures);
  }
});

test("clearing a vanguard cannot end the wave before its reinforcements", () => {
  let current = battleAt(49);
  current.ships = current.ships.map(ship => ({ ...ship, resolved: ship.spawnAt < 9 }));
  current.battleTime = 5;
  current.effects = [];
  current.board = engine.createEmptyBoard();
  const next = engine.stepBattle(current, 0.1);
  assert.equal(next.phase, "battle");
  assert.equal(next.tide, 49);
  assert.ok(next.ships.some(ship => !ship.resolved && ship.spawnAt > next.battleTime));
});

test("the Fire Siphon builds in either direction and upgrades on the destination tile", () => {
  for (const [a, b] of [["wine", "stone"], ["stone", "wine"]]) {
    let state = engine.createInitialGame(11);
    state.board = engine.createEmptyBoard();
    state.board[2][0] = { kind: "material", material: a };
    state.board[2][1] = { kind: "material", material: b };
    state = engine.actOnLandCell(engine.actOnLandCell(state, 2, 0), 2, 1);
    assert.equal(state.board[2][1].machine, "siphon");
    assert.equal(state.board[2][0], null);
    state.board[3][1] = { kind: "machine", machine: "siphon", tier: 1, cooldown: 0 };
    state = engine.actOnLandCell(engine.actOnLandCell(state, 2, 1), 3, 1);
    assert.equal(state.board[3][1].tier, 2);
    assert.equal(state.actions, 3);
    assert.deepEqual(engine.machineCoverage(state.board[3][1], 1), { channels: [0], range: 1.4 });
  }
});

test("Siphons choose a packed formation, respect their tier cap, and bypass armor", () => {
  for (const tier of [1, 2, 3]) {
    const ships = [
      { y: 1.85 }, // isolated target closer to the gate
      { y: 3.0 }, { y: 3.1 }, { y: 3.2 }, { y: 3.35 }, { y: 3.4 },
      { y: 3, channel: 1 }, { y: 3, spawnAt: 8 },
    ].map(ship => ({ ...ship, shield: 8 }));
    const current = armBattle({ ships });
    current.board[3][1] = { kind: "machine", machine: "siphon", tier, cooldown: 0 };
    const next = engine.stepBattle(current, 0.1);
    const hit = next.ships.filter(ship => ship.hp < 30);
    assert.deepEqual(hit.map(ship => ship.id), current.ships.slice(1, tier + 2).map(ship => ship.id));
    assert.ok(hit.every(ship => ship.hp === 30 - [2, 3, 5][tier - 1]));
    for (const ship of hit) {
      assert.equal(next.effects.filter(effect => effect.targetId === ship.id && effect.kind === "fire").length, 1);
      assert.equal(next.effects.filter(effect => effect.targetId === ship.id && effect.kind === "impact").length, 1);
    }
  }
});

test("a Siphon cannot acquire a ship beyond its highlighted range", () => {
  for (const [tier, range] of [[1, 1.2], [2, 1.4], [3, 1.6]]) {
    const current = armBattle({ ships: [{ y: 3 + range + 0.02 }, { y: 3 + range - 0.02 }] });
    current.board[3][1] = { kind: "machine", machine: "siphon", tier, cooldown: 0 };
    const next = engine.stepBattle(current, 0.1);
    assert.equal(next.ships[0].hp, 30);
    assert.ok(next.ships[1].hp < 30);
  }
});

test("Tide 12 introduces one screening galley in the forecast channel without inflating the fleet", () => {
  for (let seed = 1; seed <= 50; seed++) {
    assert.ok(!battleAt(11, seed).ships.some(ship => ship.screening));
    const fleet = battleAt(12, seed).ships;
    assert.equal(fleet.filter(ship => ship.creature !== "karkinos").length, 9);
    const escorts = fleet.filter(ship => ship.screening);
    assert.equal(escorts.length, 1);
    assert.equal(escorts[0].name, "Aegis Galley");
    assert.match(engine.wavePreview(12, seed), new RegExp(`AEGIS ${escorts[0].channel === 0 ? "W" : "E"}`));
  }
});

test("Aegis protection is local, cannot protect its source or a boss, and falls when disrupted", () => {
  const fixture = armBattle({ ships: [{ y: 0.1 }, { screening: true, y: 1.2 }] });
  const [target, escort] = fixture.ships;
  assert.equal(engine.isShipScreened(target, [escort], 0.5), true);
  assert.equal(engine.isShipScreened(escort, [escort], 0.5), false);
  assert.equal(engine.isShipScreened({ ...target, boss: true }, [escort], 0.5), false);
  for (const impossible of [{ y: 1.4 }, { channel: 1 }, { spawnAt: 1 }, { grappled: 0.1 }, { awe: 0.1 },
    { hp: 0 }, { resolved: true }]) {
    assert.equal(engine.isShipScreened(target, [{ ...escort, ...impossible }], 0.5), false);
  }
  const hit = (count, disrupted) => {
    const state = armBattle({ ships: [{ y: 0.1, speed: 0.4 },
      ...Array.from({ length: count }, () => ({ screening: true, y: 1.2, awe: disrupted ? 2 : 0 }))] });
    state.board = engine.createEmptyBoard();
    state.board[0][1] = { kind: "machine", machine: "catapult", tier: 1, cooldown: 0 };
    return engine.stepBattle(state, 0.1).ships[0].hp;
  };
  assert.equal(hit(0, false), 26);
  assert.equal(hit(1, false), 28);
  assert.equal(hit(2, false), 28);
  assert.equal(hit(1, true), 26);
});

test("a Siphon kill at the gate scores once and cannot also count as a landing", () => {
  let state = armBattle({ ships: [{ y: 0.005, hp: 1, shield: 9, speed: 1.5 }] });
  state.board = engine.createEmptyBoard();
  state.board[0][1] = { kind: "machine", machine: "siphon", tier: 1, cooldown: 0 };
  const gate = state.harbor;
  state = engine.stepBattle(state, 0.1);
  assert.equal(state.ships[0].hp, 0);
  assert.equal(state.ships[0].outcome, "sunk");
  assert.equal(state.harbor, gate);
  assert.equal(state.kleos, 15);
  assert.equal(engine.shipActionEffect(state.ships[0], state.effects)?.kind, "impact");
  const settled = engine.stepBattle(state, 0.1);
  assert.equal(settled.kleos, 15);
  assert.equal(settled.landingsThisBattle, 0);
});

test("a ship entering simultaneous command range gets the same pace regardless of array order", () => {
  const state = armBattle({ ships: [{ id: 10001, y: 3, speed: 0.4, command: true },
    { id: 10002, y: 5.199, speed: 0.6 }] });
  state.board = engine.createEmptyBoard();
  const forward = engine.stepBattle(state, 0.1);
  const reversed = engine.stepBattle({ ...state, ships: [...state.ships].reverse() }, 0.1);
  for (const ship of forward.ships) assert.equal(ship.y, reversed.ships.find(other => other.id === ship.id).y);
  assert.ok(Math.abs(forward.ships[1].y - (5.199 - 0.6 * 1.18 * 0.1)) < 1e-9);
});

test("the boss pennant predicts every launch and a healthy gate survives one pre-50 boss breach", () => {
  for (let seed = 0; seed < 15; seed++) {
    for (let tide = 1; tide <= 55; tide++) {
      const boss = battleAt(tide, seed).ships.find(ship => ship.boss);
      assert.equal(engine.bossChannelForTide(tide, seed), boss?.channel ?? null);
      if (boss) assert.ok(tide < 50 ? boss.landing <= 5 : boss.landing === 6);
    }
  }
});

test("malformed coordinates cannot select a nonexistent board tile", () => {
  const initial = engine.createInitialGame(173);
  for (const [row, col] of [[NaN, 1], [1.5, 0], [1, 1.5], [Infinity, 3]]) {
    assert.equal(engine.actOnLandCell(initial, row, col), initial);
  }
});

test("ordinary hulls never lose health as the middle-game pressure rises back to full strength", () => {
  const lastHealth = new Map();
  for (let tide = 1; tide <= 120; tide++) {
    const fleet = battleAt(tide, 1).ships;
    for (const ship of fleet) {
      if (ship.boss || ship.creature) continue; // Ketos inherits different host hulls.
      assert.ok(ship.maxHp >= (lastHealth.get(ship.name) ?? 0), `${ship.name} lost health on Tide ${tide}.`);
      lastHealth.set(ship.name, ship.maxHp);
    }
  }
  assert.ok(lastHealth.size >= 6);
  // The taper expires at Tide 50. Later bosses and an ordinary veteran
  // retain the same unsoftened durability as the original endless curve.
  assert.equal(battleAt(50, 1).ships.find(ship => ship.boss).maxHp, 1009);
  assert.equal(battleAt(55, 1).ships.find(ship => ship.boss).maxHp, 1078);
  const raider = battleAt(51, 1).ships.find(ship => ship.name === "Raider Boat");
  assert.equal(raider.maxHp, 69);
});
