import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const site = new URL("../docs/", import.meta.url);
const source = new URL("../public/", import.meta.url);
const simulatedPage = new URL("https://example.test/sea-gates/");

async function deployedAsset(relativePath) {
  const resolved = new URL(relativePath, simulatedPage);
  assert.equal(resolved.origin, simulatedPage.origin);
  assert.ok(resolved.pathname.startsWith(simulatedPage.pathname), relativePath);
  const file = new URL(resolved.pathname.slice(simulatedPage.pathname.length), site);
  assert.ok((await stat(file)).isFile(), relativePath);
  return file;
}

test("the HTML, manifest, icons and bundles load from a repository subpath", async () => {
  const html = await readFile(new URL("index.html", site), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(refs.some(path => path.endsWith(".js")));
  assert.ok(refs.some(path => path.endsWith(".css")));
  const outputFiles = await readdir(new URL("assets/", site));
  for (const name of outputFiles.filter(name => /\.(css|js)$/.test(name))) {
    assert.ok(refs.includes("./assets/" + name), `Orphaned bundle ${name}`);
  }
  for (const path of refs) await deployedAsset(path);
  const manifest = JSON.parse(await readFile(await deployedAsset("./manifest.webmanifest"), "utf8"));
  assert.equal(new URL(manifest.start_url, simulatedPage).href, simulatedPage.href);
  assert.equal(new URL(manifest.scope, simulatedPage).href, simulatedPage.href);
  for (const icon of manifest.icons) await deployedAsset(icon.src);
  await deployedAsset("./.nojekyll");
});

test("the published build ships the source art byte-for-byte", async () => {
  const assets = await readdir(new URL("assets/", source));
  assert.ok(assets.length > 0);
  for (const asset of assets) {
    const published = await deployedAsset("./assets/" + asset);
    assert.deepEqual(await readFile(published), await readFile(new URL("assets/" + asset, source)));
  }
});
