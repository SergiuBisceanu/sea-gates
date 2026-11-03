import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const sourcePath = fileURLToPath(
  new URL("../app/sea-gates-game.tsx", import.meta.url),
);
const gatePath = fileURLToPath(
  new URL("../public/assets/cyclopean-gate-atlas.webp", import.meta.url),
);
const terrainPath = fileURLToPath(
  new URL("../public/assets/terrain-atlas.webp", import.meta.url),
);
const waterPath = fileURLToPath(
  new URL("../public/assets/water-atlas.webp", import.meta.url),
);
const backdropPath = fileURLToPath(
  new URL("../public/assets/aegean-backdrop.webp", import.meta.url),
);
const resourcePath = fileURLToPath(
  new URL("../public/assets/resource-atlas-v2.webp", import.meta.url),
);
const cssPath = fileURLToPath(
  new URL("../app/globals.css", import.meta.url),
);

test("uses one fluid render loop and continuous channel water", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const SIMULATION_STEP = 1 \/ 30/);
  assert.match(source, /function drawBoardWaterBed/);
  assert.match(source, /function drawWaterChannel/);
  assert.match(source, /function drawWaterAtlasTile/);
  assert.match(source, /drawBoardWaterBed\(context, time, atlases\.water\)/);
  assert.match(source, /requestAnimationFrame\(tick\)/);
  assert.doesNotMatch(source, /animationFrame\s*=\s*(?:window\.)?setInterval\(/);
});

test("ships voxel terrain, animated water, a stable fortress, and a painted horizon", async () => {
  const [gate, terrain, water, backdrop] = await Promise.all([
    sharp(gatePath).metadata(),
    sharp(terrainPath).metadata(),
    sharp(waterPath).metadata(),
    sharp(backdropPath).metadata(),
  ]);

  assert.equal(gate.format, "webp");
  assert.deepEqual([gate.width, gate.height], [640, 264]);
  assert.equal(terrain.format, "webp");
  assert.deepEqual([terrain.width, terrain.height], [384, 192]);
  assert.equal(water.format, "webp");
  assert.deepEqual([water.width, water.height], [384, 192]);
  assert.equal(backdrop.format, "webp");
  assert.deepEqual([backdrop.width, backdrop.height], [828, 278]);

  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /function drawCastleFlameAccents/);
  assert.doesNotMatch(source, /animationFrame \* sourceWidth/);
});

test("animates the moving parts inside every sprite family", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /function drawAnimatedMachineSprite/);
  assert.match(source, /const release = easeOutCubic/);
  assert.match(source, /const hold = clawReachProgress/);
  assert.match(source, /function clawReachProgress/);
  assert.match(source, /const ritual = active \? Math\.abs\(Math\.sin/);
  assert.match(source, /function armFacesRight/);
  assert.match(source, /previousActiveEffect\.ttl/);
  assert.match(source, /function drawAnimatedShipSprite/);
  assert.match(source, /function drawCrewSprite[\s\S]*upperShiftX/);
  assert.match(source, /function drawAnimatedKarkinos/);
  assert.match(source, /function drawAnimatedTurtle/);
  assert.match(source, /function drawHorizontalWaveSprite/);
  assert.match(source, /function drawArticulatedSkolopendra/);
  assert.match(source, /const SKOLOPENDRA_BANDS/);
  assert.match(source, /bandIndex = SKOLOPENDRA_BANDS\.length - 1/);
  assert.match(source, /function armActionPose/);
  assert.match(source, /function armRigGeometry/);
  assert.match(source, /const impactImpulse/);
  assert.doesNotMatch(source, /const grapplePull/);
  assert.match(source, /armMotion\.contactScreenY/);
  assert.match(source, /effect\.grabY/);
  assert.match(source, /effect\.haulY/);
  assert.match(source, /effect\.armOutcome/);
  assert.match(source, /"defeated",[\s\S]*(?:effect\.targetId \?\? )?effect\.id,[\s\S]*progress/);
  assert.doesNotMatch(source, /ship\.id === effect\.targetId && !ship\.boss/);
  assert.match(source, /function drawBoardMotion/);
  const wakeRenderer = source.match(
    /function drawShipWake[\s\S]*?(?=\nfunction )/,
  )?.[0] ?? "";
  assert.ok(wakeRenderer, "expected the stepped ship-wake renderer");
  assert.doesNotMatch(wakeRenderer, /bezierCurveTo|ellipse/);
  assert.match(source, /planningMotionForAction/);
  assert.match(source, /function drawMergeBurst/);
  assert.match(source, /function easeOutBack/);
  assert.match(source, /function drawResourceHalo/);
  assert.match(source, /function drawResourceSparkle/);
  const clawRenderer = source.match(
    /function drawArmClawEffect[\s\S]*?(?=\nfunction )/,
  )?.[0] ?? "";
  assert.ok(clawRenderer, "expected the dedicated single-Arm claw renderer");
  assert.doesNotMatch(clawRenderer, /secondaryFromCol/);
  const armRigRenderer = source.match(
    /function drawArmRig[\s\S]*?(?=\nfunction )/,
  )?.[0] ?? "";
  assert.ok(armRigRenderer, "expected the voxel Arm sprite renderer");
  const seaCreatureRenderer = source.match(
    /function drawSeaCreature[\s\S]*?(?=\nfunction )/,
  )?.[0] ?? "";
  assert.match(seaCreatureRenderer, /activeEffect\?: Effect/);
  assert.match(seaCreatureRenderer, /armOutcome === "overturn"/);
  assert.doesNotMatch(seaCreatureRenderer, /sourceCol = \(ship\.grappled/);
  assert.match(source, /effect\.targetId === ship\.id/);
  assert.match(source, /const delay = effect\.delay \?\? 0/);
  assert.match(source, /drawEffect\(context, renderedEffect, atlases, time, renderState\)/);
  assert.match(source, /const wasPreviouslyVisible = previousState\.battleTime >= ship\.spawnAt/);
  assert.match(source, /ship\.y <= CHANNEL_ENTRY_Y/);
});

test("uses a dedicated compact resource atlas and contains pieces at tile boundaries", async () => {
  const [source, resource] = await Promise.all([
    readFile(sourcePath, "utf8"),
    sharp(resourcePath).metadata(),
  ]);

  assert.equal(resource.format, "webp");
  assert.deepEqual([resource.width, resource.height], [512, 512]);
  assert.match(source, /\["resources", "\/assets\/resource-atlas-v2\.webp"\]/);
  assert.match(source, /\["crew", "\/assets\/crew-atlas\.webp"\]/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /void loadSet\(critical\)/);
  assert.match(source, /void loadSet\(deferredAtlases\)/);
  assert.match(source, /drawResourceAtlasCell/);
  assert.doesNotMatch(source, /function cleanFleetAtlas/);
  assert.match(source, /const LAND_INSET = 2/);
  assert.match(source, /CELL - LAND_INSET \* 2/);
});

test("keeps the visible interface compact and tactile", async () => {
  const [source, css] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(source, /const HEIGHT = 640/);
  assert.doesNotMatch(source, /function drawRecipeCard/);
  assert.doesNotMatch(source, /pixelText\(context, "THE SEA GATES"/);
  assert.match(source, /function drawVoxelUiBackdrop/);
  assert.match(source, /const shadowOffset = size >= 16 \? 2 : size >= 10 \? 1 : 0\.5/);
  assert.match(source, /"SOUND HORN"/);
  assert.match(source, /Builder&apos;s Scroll/);
  assert.match(source, /Machine mechanics/);
  assert.match(source, /Archimedean Arm/);
  assert.match(source, /Tier III also splashes 2 damage/);
  assert.match(source, /Each unused move earns 8 Kleos/);
  assert.match(source, /forecast gives West\/East threats/);
  assert.match(source, /Account &amp; Records/);
  assert.match(source, /Records Wall/);
  assert.match(css, /aspect-ratio: 414 \/ 640/);
  assert.match(css, /top: 21\.71875%/);
  assert.match(css, /height: 45%/);
  assert.doesNotMatch(css, /repeating-linear-gradient/);
  assert.match(css, /clip-path:\s*polygon/);
  assert.match(css, /border-radius: 2px/);
  assert.match(css, /\.machine-manual-card/);
  assert.match(css, /\.dialog-sticky-bar/);
  assert.match(css, /\.desktop-utility-toggle,[\s\S]*?width: 44px/);
  assert.match(css, /\.touch-hud-menu-trigger[\s\S]*?background: transparent/);
  assert.match(css, /\.desktop-utility\s*{\s*display: none/);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.desktop-utility[\s\S]*?display: flex/,
  );
});

test("ships mobile-first quality-of-life controls without cluttering the board", async () => {
  const [source, css] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(source, /import \{ resolveSwipeTarget, SWIPE_THRESHOLD \} from "\.\/game-controls"/);
  assert.match(source, /resolveSwipeTarget\(gesture\.row, gesture\.col, dx, dy\)/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /handleCellPointerUp/);
  assert.match(source, /current\.phase === "battle" && !menuPaused/);
  assert.match(source, /battleSpeedRef\.current/);
  assert.match(source, /openRunCheckpoints\(browserStorage\(\)\)/);
  assert.doesNotMatch(source, /window\.localStorage/);
  assert.match(source, /saved\.game\.phase === "battle"\) openPanelRef\.current = "menu"/);
  assert.match(source, /Resume Battle/);
  assert.match(source, /machineCoverage\(piece, col\)/);
  assert.match(source, /setGame\(next\);\s*wakeRendererRef\.current\(\)/);
  assert.match(source, /NEXT DAWN/);
  assert.match(source, /DEFEND · \$\{battleSpeed\}×/);
  assert.match(source, /tabIndex=/);
  assert.match(source, /handleCellKeyDown/);
  assert.match(source, /cargoWarningArmed/);
  assert.match(css, /\.board-controls[\s\S]*touch-action: none/);
  assert.match(css, /width: min\(calc\(100% - 2px\), 422px, calc\(64\.6875svh - 16px\)\)/);
});

test("throttles rendering and sleeps while the page is hidden", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /if \(openPanelRef\.current\) return 0/);
  assert.match(source, /if \(current\.phase === "battle"\) return reduceMotion \? 15 : 30/);
  assert.match(source, /activeBoardMotion[\s\S]*return reduceMotion \? 12 : 30/);
  assert.match(source, /return reduceMotion \? 1 : 20/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /if \(framesPerSecond === 0\) return/);
  assert.match(source, /motionPreference\.addEventListener\("change"/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /reactSignature/);
});
