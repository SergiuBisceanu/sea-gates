import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false, ws: false },
  plugins: [{ name: "inspect-renderers", enforce: "pre", transform(code, id) {
    if (id.endsWith("/sea-gates-game.tsx")) return code + "\nexport { drawShip, drawMachine, drawMaterial, drawCrewSprite, drawEffect, drawFloatingCargo, drawGame };";
  } }],
});
after(() => vite.close());
const renderer = await vite.ssrLoadModule("/app/sea-gates-game.tsx");
const engine = await vite.ssrLoadModule("/app/game-engine.ts");
const atlases = {};
for (const [key, file] of Object.entries({ machines: "machines-atlas", fleet: "fleet-atlas", resources: "resource-atlas-v2", crew: "crew-atlas", terrain: "terrain-atlas", water: "water-atlas", backdrop: "aegean-backdrop", gate: "cyclopean-gate-atlas", skolopendra: "skolopendra-atlas", creatures: "sea-creatures-atlas" })) {
  atlases[key] = await loadImage(`${root}public/assets/${file}.webp`);
}
const planning = engine.createInitialGame(173);
const samples = [1, 2, 173].flatMap(runSeed => [1, 3, 4, 6, 8, 9, 5, 10].flatMap(tide => engine.startBattle({ ...planning, runSeed, tide }).ships));
const hull = { ...samples[0], id: 17, channel: 0, y: 2.5 };

function renderShip(ship) {
  const context = createCanvas(414, 480).getContext("2d");
  context.imageSmoothingEnabled = false;
  renderer.drawShip(context, { ...ship, id: 17, channel: 0, y: 2.5 }, 0.6, atlases, 2.5);
  return context;
}

test("damage preserves the sail and hull identity of every armored ship", () => {
  for (const name of ["Shield Ship", "Command Ship", "Laden Galley"]) {
    const ship = samples.find(candidate => candidate.name === name);
    assert.ok(ship);
    const healthy = renderShip(ship).getImageData(110, 255, 62, 43).data;
    const damaged = renderShip({ ...ship, hp: ship.maxHp * 0.3 }).getImageData(110, 255, 62, 43).data;
    let painted = 0, identical = 0;
    for (let index = 0; index < healthy.length; index += 4) {
      if (healthy[index + 3] < 128) continue;
      painted++;
      if (healthy.slice(index, index + 4).every((value, offset) => value === damaged[index + offset])) identical++;
    }
    assert.ok(painted > 150, `${name} must render an actual hull`);
    assert.ok(identical / painted > 0.75, `${name} changed model when damaged`);
  }
});

test("the Skolopendra keeps its living silhouette when awed or grabbed", () => {
  const boss = samples.find(ship => ship.creature === "skolopendra");
  const normal = renderShip(boss).getImageData(80, 265, 125, 144).data;
  for (const status of [{ awe: 1 }, { grappled: 1 }]) {
    const altered = renderShip({ ...boss, ...status }).getImageData(80, 265, 125, 144).data;
    let intersection = 0, union = 0;
    for (let index = 3; index < normal.length; index += 4) {
      const a = normal[index] > 128, b = altered[index] > 128;
      if (a || b) union++;
      if (a && b) intersection++;
    }
    assert.ok(intersection / union > 0.72, "the head or body jumped to a different pose");
  }
});

test("overtaking changes draw order without changing either hull's visual track", () => {
  const earlier = { ...planning, phase: "battle", battleTime: 10, ships: [{ ...hull, id: 17, y: 2 }, { ...hull, id: 18, y: 2.2 }] };
  const later = { ...earlier, ships: [{ ...earlier.ships[0], y: 1.98 }, { ...earlier.ships[1], y: 1.9 }] };
  assert.deepEqual(renderer.fleetRenderOrder(later, earlier, 0).map(item => item.ship.id), [17, 18]);
  assert.deepEqual(renderer.fleetRenderOrder(later, earlier, 1).map(item => item.ship.id), [18, 17]);
  for (let index = 0; index < 2; index++) {
    assert.equal(renderer.shipScreenPosition(earlier.ships[index]).x, renderer.shipScreenPosition(later.ships[index]).x);
  }
  assert.notEqual(renderer.shipScreenPosition(later.ships[0]).x, renderer.shipScreenPosition(later.ships[1]).x);
  const shot = { id: 90, kind: "impact", ttl: 0.4, total: 0.73, targetId: 17, channel: 0, targetOffsetY: 0.4 };
  const hit = renderer.effectPosition(shot, later);
  assert.equal(hit.waterX, renderer.shipScreenPosition(later.ships[0]).x);
  assert.ok(Math.abs(hit.waterY - (renderer.shipScreenPosition(later.ships[0]).y + 0.4 * 48)) < 1e-9);
});

test("a simultaneous impact stays on a hauled victim while another enemy passes", () => {
  for (const channel of [0, 1]) {
    const victim = { ...hull, channel };
    const claw = { id: 99, kind: "claw", ttl: 0.525, total: 1.05, targetId: victim.id,
      channel, fromRow: 3, fromCol: channel === 0 ? 1 : 6, armTier: 3,
      armFacesRight: channel === 0, grabY: 2.5, haulY: 3.08, contactY: 2.5, armOutcome: "wrench" };
    const state = { ...planning, ships: [victim, { ...victim, id: 18, y: 2.4 }], effects: [claw] };
    const motion = renderer.armEffectGeometry(claw, 0.5, state);
    const impact = renderer.effectPosition({ id: 100, kind: "impact", targetId: victim.id, ttl: 0.2, total: 0.3, channel }, state);
    assert.ok(Math.abs(impact.waterX - motion.targetX) < 1e-8);
    assert.ok(Math.abs(impact.waterY - motion.targetY) < 1e-8);
    assert.ok(Math.abs(motion.hookX - impact.waterX) < 1e-8);
    assert.ok(Math.abs(motion.hookY - impact.waterY) < 1e-8);
  }
});

test("every resource, crew pose, and creature renders actual pixels without leaking canvas state", () => {
  const jobs = [
    ...["stone", "timber", "bronze", "wine"].map(material => context => renderer.drawMaterial(context, material, 30, 30, atlases.resources, 0.6, 17)),
    ...["raiders", "spartoi"].flatMap(crew => ["deck", "landing"].map(pose => context => renderer.drawCrewSprite(context, crew, pose, 60, 60, atlases.crew, 0.6, 17))),
    ...["skolopendra", "sciron-turtle", "karkinos", "ketos"].map(creature => context => renderer.drawShip(context, { ...hull, creature }, 0.6, atlases, 2.5)),
    ...["stone", "timber", "bronze", "wine"].map(material => context => renderer.drawFloatingCargo(context, { ...planning, cargo: [{ id: 17, channel: 0, row: 2, material }] }, 0.6, atlases.fleet, atlases.resources)),
  ];
  for (const draw of jobs) {
    const context = createCanvas(414, 480).getContext("2d");
    const before = context.getTransform();
    draw(context);
    const pixels = context.getImageData(0, 0, 414, 480).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 128) painted++;
    assert.ok(painted > 20, "a sprite renderer returned blank artwork");
    assert.equal(context.globalAlpha, 1);
    assert.deepEqual(context.getTransform(), before);
  }
});

test("monster landing animations keep the monster instead of turning into a shipwreck", () => {
  for (const creature of ["skolopendra", "sciron-turtle", "karkinos", "ketos"]) {
    const context = createCanvas(414, 480).getContext("2d");
    const ship = { ...hull, creature, y: -0.04, resolved: true, outcome: "landed" };
    renderer.drawEffect(context, { id: 21, kind: "landing", creature, targetId: ship.id,
      channel: 0, ttl: 0.8, total: 0.9 }, atlases, 0.6, { ...planning, ships: [ship] });
    const pixels = context.getImageData(70, 125, 140, 185).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 128) painted++;
    assert.ok(painted > 300, `${creature} landing was blank`);
  }
});

test("hand-packed sea monsters draw complete frames without pixels from a neighboring illustration", () => {
  const bounds = {
    karkinos: [2, 33, 147, 107],
    ketos: [151, 12, 244, 109],
    "sciron-turtle": [9, 110, 135, 239],
  };
  for (const [creature, [left, top, right, bottom]] of Object.entries(bounds)) {
    const context = createCanvas(414, 480).getContext("2d");
    const draw = context.drawImage.bind(context);
    const crops = [];
    context.drawImage = (image, ...args) => {
      if (image === atlases.creatures) crops.push(args.slice(0, 4));
      draw(image, ...args);
    };
    renderer.drawShip(context, { ...hull, creature }, 0.7, atlases, 2.5);
    assert.ok(crops.length > 1, creature);
    for (const [sx, sy, sw, sh] of crops) {
      assert.ok(sx >= left && sy >= top && sx + sw <= right + 0.001 && sy + sh <= bottom + 0.001, creature);
    }
    assert.ok(crops.some(([sx, , sw]) => sx + sw >= right - 0.001), creature + " right edge");
    assert.ok(crops.some(([, sy]) => sy === top), creature + " head");
  }
});

test("all Fire Siphon tiers are distinct at tile size and both shores face the channel", () => {
  const sprites = [];
  for (let tier = 1; tier <= 3; tier++) {
    const draw = col => {
      const context = createCanvas(48, 48).getContext("2d");
      renderer.drawMachine(context, "siphon", tier, 0, 0, col, true, null, 0.3, 0, 0.4);
      return context.getImageData(0, 0, 48, 48).data;
    };
    const leftFacing = draw(3), rightFacing = draw(4);
    const flameX = data => {
      let xs = [];
      for (let y = 0; y < 20; y++) for (let x = 0; x < 48; x++) {
        const i = 4 * (y * 48 + x);
        if (data[i] === 223 && data[i+1] === 87 && data[i+2] === 43) xs.push(x);
      }
      assert.ok(xs.length, "a pilot flame is visible");
      return xs.reduce((a, b) => a + b) / xs.length;
    };
    assert.ok(flameX(leftFacing) < 16 && flameX(rightFacing) > 32);
    sprites.push(leftFacing);
  }
  for (let i = 1; i < sprites.length; i++) {
    let difference = 0;
    for (let j = 3; j < sprites[i].length; j += 4)
      if (Math.abs(sprites[i][j] - sprites[i-1][j]) > 100) difference++;
    assert.ok(difference > 45, "the extra tank must alter the silhouette");
  }
});

test("siphon fire and galley shield banks remain legible without any downloaded art", () => {
  const empty = Object.fromEntries(Object.keys(atlases).map(key => [key, null]));
  for (const assets of [empty, atlases]) {
    const fire = createCanvas(414, 480).getContext("2d");
    renderer.drawEffect(fire, { id: 42, kind: "fire", fromRow: 2, fromCol: 1,
      toY: 2.3, channel: 0, ttl: 0.25, total: 0.5 }, assets, 0.22, planning);
    assert.ok(fire.getImageData(0, 0, 414, 480).data.filter((v, i) => i % 4 === 3 && v > 128).length > 20);
    const comparison = [false, true].map(screening => {
      const context = createCanvas(414, 480).getContext("2d");
      renderer.drawShip(context, { ...hull, name: "Shield Ship", screening }, 0.4, assets, 2.5);
      return context.getImageData(80, 244, 120, 78).data;
    });
    let different = 0;
    for (let i = 0; i < comparison[0].length; i += 4)
      if (comparison[0][i] !== comparison[1][i]) different++;
    assert.ok(different > 80, "the galley's pennant and shields differ from a normal armored ship");
  }
});

test("loaded catapults face their assigned channel on both shores, including without an atlas", () => {
  for (const atlas of [atlases.machines, null]) {
    for (const col of [0, 1, 3, 4, 6, 7]) {
      const context = createCanvas(48, 48).getContext("2d");
      context.imageSmoothingEnabled = false;
      renderer.drawMachine(context, "catapult", 1, 0, 0, col, false, atlas);
      const data = context.getImageData(0, 0, 48, 12).data;
      let sumX = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        sumX += i / 4 % 48;
        count++;
      }
      assert.ok(count > 10);
      const waterToRight = col < 2 || col === 4;
      assert.ok(waterToRight ? sumX / count > 24 : sumX / count < 24, "loaded stone points toward water at column " + col);
    }
  }
});
test("landing crews remain visible when the crew atlas cannot load", () => {
  for (const crew of ["raiders", "spartoi"]) {
    const context = createCanvas(48, 48).getContext("2d");
    renderer.drawCrewSprite(context, crew, "landing", 24, 24, null, 0.5, 1);
    const data = context.getImageData(0, 0, 48, 48).data;
    assert.ok(data.filter((v, i) => i % 4 === 3 && v > 128).length > 60);
  }
});
