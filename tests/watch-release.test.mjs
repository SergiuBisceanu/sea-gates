import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = new URL("../public/watch/", import.meta.url);
const published = new URL("../docs/watch/", import.meta.url);

async function files(root) {
  const result = [];
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) result.push(relative(fileURLToPath(root), join(item.parentPath, item.name)).split(sep).join("/"));
  }
  return result.sort();
}

test("the Pages build publishes the exact editable Daily Watch client and art", async () => {
  const paths = await files(source);
  assert.ok(paths.includes("index.html"));
  assert.ok(paths.includes("app.mjs"));
  assert.deepEqual(await files(published), paths);
  for (const path of paths) {
    assert.doesNotMatch(path, /(?:^|\/)(?:tests?|\.git|node_modules|\.env)(?:\/|$)|\.test\.[cm]?js$/);
    assert.deepEqual(await readFile(new URL(path, published)), await readFile(new URL(path, source)), path);
  }
});

test("the account service validates replays with the same rules and content as the guest game", async () => {
  for (const name of ["engine.mjs", "content.mjs"]) {
    assert.deepEqual(
      await readFile(new URL(name, source)),
      await readFile(new URL("../daily-watch-server/public/play/" + name, import.meta.url)),
      name,
    );
  }
});
