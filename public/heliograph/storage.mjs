const PREFIX = "sea-gates.heliograph.v1.";
export const SLOTS = ["campaign", "daily", "challenge"];

export function browserStore() {
  try { return window.localStorage; } catch { return null; }
}

export function campaignStore(storage) {
  const seen = new Map();
  function read(slot) {
    if (!SLOTS.includes(slot)) return null;
    try {
      const raw = storage?.getItem(PREFIX + slot) ?? null;
      seen.set(slot, raw);
      return raw === null ? null : JSON.parse(raw);
    } catch { return null; }
  }
  function write(slot, replay) {
    if (!storage || !SLOTS.includes(slot)) return "unavailable";
    try {
      const current = storage.getItem(PREFIX + slot);
      if (seen.has(slot) && seen.get(slot) !== current) return "other-tab";
      const next = JSON.stringify(replay);
      if (next !== current) storage.setItem(PREFIX + slot, next);
      seen.set(slot, next);
      try { storage.setItem(PREFIX + "last", slot); } catch { /* The replay itself is saved. */ }
      return "saved";
    } catch { return "unavailable"; }
  }
  function last() {
    try { return storage?.getItem(PREFIX + "last"); } catch { return null; }
  }
  return { read, write, last };
}

export function dateSeed(date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  // Calendar dates are human-readable, distinct, and identical in every time zone.
  return Number(iso.replaceAll("-", ""));
}

export function challengeSeed(href) {
  const value = new URL(href).searchParams.get("seed");
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const seed = Number(value);
  return seed >= 1 && seed <= 0x7fffffff ? seed : null;
}

export function challengeURL(href, seed) {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("seed", String(seed));
  return url.href;
}
