import test from "node:test";
import assert from "node:assert/strict";
import { campaignStore, dateSeed, challengeSeed, challengeURL } from "../public/heliograph/storage.mjs";
function memory() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
}
test("campaign, daily and challenge slots are independent; stale tabs cannot replace a later plan", () => {
  const storage = memory();
  const a = campaignStore(storage), b = campaignStore(storage);
  assert.equal(a.read("campaign"), null);
  assert.equal(b.read("campaign"), null);
  assert.equal(a.write("campaign", { tide: 2 }), "saved");
  assert.equal(b.write("campaign", { tide: 1 }), "other-tab");
  b.read("daily");
  assert.equal(b.write("daily", { tide: 3 }), "saved");
  assert.equal(b.last(), "daily");
  assert.deepEqual(b.read("campaign"), { tide: 2 });
  assert.deepEqual(a.read("daily"), { tide: 3 });
});
test("blocked storage still allows play", () => {
  const store = campaignStore({ getItem() { throw Error(); } });
  assert.equal(store.read("campaign"), null);
  assert.equal(store.write("campaign", {}), "unavailable");
});
test("challenge links roundtrip project subpaths and the daily siege rolls at UTC midnight", () => {
  const url = challengeURL("https://example.org/sea-gates/heliograph/?x=1#bad", 3);
  assert.equal(url, "https://example.org/sea-gates/heliograph/?seed=3");
  assert.equal(challengeSeed(url), 3);
  for (const s of ["", "0", "-1", "3.1", "99999999999"]) assert.equal(challengeSeed("https://example.org/?seed="+s), null);
  assert.equal(dateSeed(new Date("2026-11-03T23:59:59.999Z")), 20261103);
  assert.equal(dateSeed(new Date("2026-11-04T00:00:00Z")), 20261104);
});
