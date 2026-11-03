import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(
  new URL("../app/sea-gates-game.tsx", import.meta.url),
);
const cssPath = fileURLToPath(
  new URL("../app/globals.css", import.meta.url),
);

test("provides one gesture-unlocked monotone drone with complete cleanup", async () => {
  const [source, css] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(source, /function useBronzeDrone/);
  assert.match(source, /window\.AudioContext/);
  assert.match(source, /webkitAudioContext/);
  assert.match(source, /window\.addEventListener\("pointerdown"/);
  assert.match(source, /window\.addEventListener\("keydown"/);
  assert.match(source, /const existing = graphRef\.current/);
  assert.match(source, /tone\.type = "triangle"/);
  assert.match(source, /tone\.frequency\.setValueAtTime\(110/);
  assert.match(source, /context\.resume\(\)/);
  assert.match(source, /context\.suspend\(\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /graph\.tone\.stop\(\)/);
  assert.match(source, /graph\.lfo\.stop\(\)/);
  assert.match(source, /graph\.context\.close\(\)/);
  assert.match(source, /Mute ambient drone/);
  assert.match(source, /Unmute ambient drone/);
  assert.match(css, /\.desktop-tool-button/);
  assert.match(css, /\.game-actions[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.desktop-utility\s*{\s*display: none/);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.desktop-utility[\s\S]*?display: flex/,
  );
  assert.doesNotMatch(source, /<audio/);
  assert.doesNotMatch(source, /tone\.frequency\.(?:linearRamp|setTargetAtTime)/);
});
