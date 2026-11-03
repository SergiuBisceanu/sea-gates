import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeviceRecords } from "../app/game-scores.ts";

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(i) { return [...values.keys()][i] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

const make = (i, tide, kleos, captures = 0) => ({
  runKey: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, tide, kleos, captures,
});

test("two tabs can finish voyages independently; replaying a saved loss counts once", () => {
  const device = storage();
  const first = createDeviceRecords(device), second = createDeviceRecords(device);
  first.record(make(1, 4, 110));
  second.record(make(2, 3, 140));
  first.record(make(1, 4, 110));
  const reopened = createDeviceRecords(device);
  reopened.record(make(1, 4, 110));
  const { runs, best, recent } = reopened.read();
  assert.equal(runs, 2);
  assert.equal(best.runKey, make(2, 3, 140).runKey);
  assert.equal(recent.length, 2);
});

test("recent voyages are bounded and an unrelated or malformed record never hides valid scores", () => {
  const device = storage(), book = createDeviceRecords(device);
  device.setItem("sea-gates.completed-run.v1.stale", "{");
  device.setItem("another-game", "unrelated");
  for (let i = 1; i <= 9; i++) book.record(make(i, i, i * 5));
  book.record({ ...make(99, 1, 0), captures: -4 });
  const snapshot = createDeviceRecords(device).read();
  assert.equal(snapshot.runs, 9);
  assert.equal(snapshot.recent.length, 5);
  assert.equal(snapshot.best.tide, 9);
  assert.ok(snapshot.persistent);
});

test("with storage blocked a completed voyage stays visible for this visit", () => {
  for (const device of [null, { getItem() { throw Error("blocked"); }, get length() { throw Error("blocked"); } }]) {
    const book = createDeviceRecords(device);
    book.record(make(1, 4, 110));
    assert.equal(book.read().persistent, false);
    assert.equal(book.read().runs, 1);
  }
});
