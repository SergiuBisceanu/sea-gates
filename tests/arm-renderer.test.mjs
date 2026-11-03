import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false, ws: false },
});
after(() => vite.close());
const { drawArmRig } = await vite.ssrLoadModule("/app/sea-gates-game.tsx");
const atlas = await loadImage(`${root}public/assets/machines-atlas.webp`);

function renderedArm(tier, facesRight, active = false, progress = 0) {
  const canvas = createCanvas(48, 48);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  drawArmRig(context, atlas, tier, 0, 0, facesRight, active, progress);
  return canvas;
}

test("every idle Arm renders the complete original voxel model on either shore", () => {
  for (const tier of [1, 2, 3]) {
    for (const facesRight of [false, true]) {
      const actual = renderedArm(tier, facesRight).getContext("2d");
      const expected = createCanvas(48, 48).getContext("2d");
      expected.imageSmoothingEnabled = false;
      if (facesRight) { expected.translate(48, 0); expected.scale(-1, 1); }
      expected.drawImage(atlas, (tier - 1) * 48, 48, 48, 48, 0, 0, 48, 48);
      assert.deepEqual(actual.getImageData(0, 0, 48, 34).data,
        expected.getImageData(0, 0, 48, 34).data,
        `Tier ${tier}, ${facesRight ? "right" : "left"}: the mast, winch and boom must retain the actual sprite`);
    }
  }
});

test("the Arm retains its textured assembly and planted base throughout an action", () => {
  for (const tier of [1, 2, 3]) {
    for (const facesRight of [false, true]) {
      const idle = renderedArm(tier, facesRight).getContext("2d");
      const base = idle.getImageData(0, 40, 48, 8).data;
      for (const progress of [0, 0.15, 0.4, 0.6, 0.8, 1]) {
        const active = renderedArm(tier, facesRight, true, progress).getContext("2d");
        assert.deepEqual(active.getImageData(0, 40, 48, 8).data, base);
        const pixels = active.getImageData(0, 0, 48, 34).data;
        const colors = new Set();
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] > 128) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
        }
        assert.ok(colors.size > 30, "the working assembly must retain its shaded sprite detail");
      }
    }
  }
});

test("deploying the claw also hides the parked Tier II hook below the assembly crop", () => {
  for (const facesRight of [false, true]) {
    const context = renderedArm(2, facesRight, true, 0).getContext("2d");
    const pixels = context.getImageData(facesRight ? 32 : 0, 34, 16, 6).data;
    for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 0);
  }
});

if (process.env.SEA_GATES_ARM_PREVIEW) {
  const preview = createCanvas(960, 440);
  const context = preview.getContext("2d");
  const terrain = await loadImage(`${root}public/assets/terrain-atlas.webp`);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#071d2b";
  context.fillRect(0, 0, 960, 440);
  context.fillStyle = "#fff0b4";
  context.font = "18px sans-serif";
  for (let index = 0; index < 6; index++) {
    const tier = index % 3 + 1;
    const facesRight = index >= 3;
    for (let row = 0; row < 2; row++) {
      const x = 8 + index * 158;
      const y = 38 + row * 210;
      context.drawImage(terrain, 0, 0, 48, 48, x, y, 144, 144);
      context.drawImage(renderedArm(tier, facesRight, row === 1, 0.55), x, y, 144, 144);
    }
    context.fillText(`Tier ${tier} ${facesRight ? "→" : "←"}`, 24 + index * 158, 24);
  }
  context.fillText("Idle", 8, 206);
  context.fillText("During a pull", 8, 422);
  await writeFile(process.env.SEA_GATES_ARM_PREVIEW, await preview.encode("png"));
}
