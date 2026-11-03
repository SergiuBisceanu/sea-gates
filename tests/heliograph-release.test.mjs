import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = new URL("../public/heliograph/", import.meta.url);
const published = new URL("../docs/heliograph/", import.meta.url);
const deployment = new URL("https://example.test/sea-gates/heliograph/");

async function inventory(root) {
  const paths = [];
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) {
      const name = relative(fileURLToPath(root), join(item.parentPath, item.name));
      paths.push(name.split(sep).join("/"));
    }
  }
  return paths.sort();
}

test("building Pages preserves the editable Heliograph game without adding test or build files", async () => {
  const files = await inventory(source);
  assert.ok(files.includes("index.html"));
  assert.ok(files.some(path => path.endsWith(".mjs") || path.endsWith(".js")));
  assert.deepEqual(await inventory(published), files);
  for (const path of files) {
    assert.doesNotMatch(path, /(?:^|\/)(?:tests?|\.git|node_modules|\.env)(?:\/|$)|\.test\.[cm]?js$/);
    assert.deepEqual(await readFile(new URL(path, published)), await readFile(new URL(path, source)), path);
  }
});

test("the sibling entry loads its scripts, stylesheets and images below its own Pages URL", async () => {
  const html = await readFile(new URL("index.html", published), "utf8");
  const tags = [...html.matchAll(/<(?:script|link|img)\b[^>]*>/gi)].map(match => match[0]);
  const urls = tags.flatMap(tag => Array.from(tag.matchAll(/\b(?:href|src)=["']([^"']+)["']/g), match => match[1]));
  assert.ok(tags.some(tag => /^<script\b/i.test(tag) && /\bsrc=/.test(tag)));
  for (const url of urls.filter(url => !url.startsWith("data:"))) {
    const resolved = new URL(url, deployment);
    assert.equal(resolved.origin, deployment.origin, url);
    assert.ok(resolved.pathname.startsWith(deployment.pathname), url);
    assert.ok((await stat(new URL(resolved.pathname.slice(deployment.pathname.length), published))).isFile(), url);
  }
});

test("relative module imports and stylesheet assets exist inside the published sibling", async () => {
  const files = await inventory(published);
  for (const path of files.filter(name => /\.(?:m?js|css)$/.test(name))) {
    const sourceText = await readFile(new URL(path, published), "utf8");
    const references = path.endsWith(".css")
      ? [...sourceText.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)].map(match => match[1])
      : [...sourceText.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g)].map(match => match[1]);
    if (!path.endsWith(".css")) {
      for (const match of sourceText.matchAll(/new\s+URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) references.push(match[1]);
    }
    for (const reference of references.filter(item => !item.startsWith("data:") && !item.startsWith("#"))) {
      const resolved = new URL(reference, new URL(path, deployment));
      assert.equal(resolved.origin, deployment.origin, path + " → " + reference);
      assert.ok(resolved.pathname.startsWith(deployment.pathname), path + " → " + reference);
      const relative = decodeURIComponent(resolved.pathname.slice(deployment.pathname.length));
      assert.ok(files.includes(relative), path + " → " + reference);
    }
  }
});

test("Heliograph's campaign and daily records leave existing Sea Gates progress intact", async () => {
  const { campaignStore } = await import("../public/heliograph/storage.mjs");
  const legacy = new Map([
    ["cyclopean-harbor.run.v1", "classic run"],
    ["cyclopean-harbor.run-backup.v1", "classic backup"],
    ["sea-gates.completed-run.v1.example", "classic score"],
  ]);
  const values = new Map(legacy);
  const touched = [];
  const store = campaignStore({
    getItem(key) { touched.push(key); return values.get(key) ?? null; },
    setItem(key, value) { touched.push(key); values.set(key, value); },
  });
  for (const slot of ["campaign", "daily", "challenge"]) {
    assert.equal(store.read(slot), null);
    assert.equal(store.write(slot, { seed: 17, actions: [] }), "saved");
    assert.deepEqual(store.read(slot), { seed: 17, actions: [] });
  }
  assert.ok(touched.every(key => key.startsWith("sea-gates.heliograph.")));
  for (const [key, value] of legacy) assert.equal(values.get(key), value);
});
