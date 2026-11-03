import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] }, configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false } });
after(() => vite.close());
const { loadSpriteImage } = await vite.ssrLoadModule("/app/game-assets.ts");

function fakeImage(outcome = "load", decode = async () => {}) {
  return {
    onload: null, onerror: null, naturalWidth: 144, naturalHeight: 144, decode,
    set src(value) {
      if (value && outcome !== "hang") queueMicrotask(() => this[outcome === "load" ? "onload" : "onerror"]?.());
    },
  };
}

test("a failed artwork request can retry and return the complete decoded sprite", async () => {
  await assert.rejects(loadSpriteImage("/sprite.webp", { createImage: () => fakeImage("error") }), /download failed/);
  const image = fakeImage();
  assert.equal(await loadSpriteImage("/sprite.webp", { createImage: () => image }), image);
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
});

test("stalled downloads and decodes time out instead of blocking the sprite family forever", async () => {
  for (const image of [fakeImage("hang"), fakeImage("load", () => new Promise(() => {}))]) {
    await assert.rejects(loadSpriteImage("/sprite.webp", { createImage: () => image, timeoutMs: 10 }), /timed out/);
    assert.equal(image.onload, null);
  }
});

test("artwork teardown aborts requests and already loaded images tolerate optional decode failures", async () => {
  const controller = new AbortController();
  const pending = loadSpriteImage("/sprite.webp", { signal: controller.signal, createImage: () => fakeImage("hang") });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const image = fakeImage("load", async () => { throw new Error("Unsupported decode"); });
  assert.equal(await loadSpriteImage("/sprite.webp", { createImage: () => image }), image);
});
