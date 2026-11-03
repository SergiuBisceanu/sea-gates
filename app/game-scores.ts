export interface CompletedScore {
  runKey: string;
  tide: number;
  kleos: number;
  captures: number;
}

type ScoreStorage = Pick<Storage, "getItem" | "setItem">;

function isScore(value: unknown): value is CompletedScore {
  if (!value || typeof value !== "object") return false;
  const score = value as CompletedScore;
  return typeof score.runKey === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(score.runKey) &&
    Number.isInteger(score.tide) && score.tide >= 1 && score.tide <= 100_000 &&
    Number.isInteger(score.kleos) && score.kleos >= 0 && score.kleos <= 1_000_000_000 &&
    Number.isInteger(score.captures) && score.captures >= 0 && score.captures <= 1_000_000;
}

// Queue records separately from the live run. Starting again, reloading or
// signing in as another player must not lose or misattribute a pending score.
export function createScoreOutbox(storage: ScoreStorage | null, accountKey: string) {
  const key = `cyclopean-harbor.pending-scores.v1.${accountKey}`;
  const pending = new Map<string, CompletedScore>();
  let flight: Promise<boolean> | null = null;
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    if (Array.isArray(saved)) {
      for (const score of saved.slice(-1000)) {
        if (isScore(score)) pending.set(score.runKey, score);
      }
    }
  } catch { /* Keep playing when device storage is unavailable. */ }

  const persist = () => {
    try { storage?.setItem(key, JSON.stringify([...pending.values()])); }
    catch { /* The in-memory queue remains available for this visit. */ }
  };

  return {
    accountKey,
    get size() { return pending.size; },
    enqueue(score: CompletedScore) {
      if (!isScore(score) || pending.has(score.runKey)) return;
      pending.set(score.runKey, { ...score });
      persist();
    },
    flush(send: (score: CompletedScore) => Promise<boolean>): Promise<boolean> {
      if (flight) return flight;
      flight = (async () => {
        for (const [runKey, score] of pending) {
          try {
            if (!await send(score)) return false;
          } catch { return false; }
          pending.delete(runKey);
          persist();
        }
        return true;
      })().finally(() => { flight = null; });
      return flight;
    },
  };
}

type DeviceScore = CompletedScore & { completedAt: number };
const DEVICE_SCORE_PREFIX = "sea-gates.completed-run.v1.";

export function createDeviceRecords(storage: Storage | null) {
  const memory = new Map<string, DeviceScore>();
  let persistent = storage !== null;
  return {
    record(score: CompletedScore) {
      if (!isScore(score) || memory.has(score.runKey)) return;
      const entry: DeviceScore = { ...score, completedAt: Date.now() };
      memory.set(entry.runKey, entry);
      // One key per run keeps independent tabs from overwriting one another.
      try {
        const key = DEVICE_SCORE_PREFIX + entry.runKey;
        if (storage && !storage.getItem(key)) storage.setItem(key, JSON.stringify(entry));
      } catch { persistent = false; }
    },
    read() {
      const runs = new Map(memory);
      try {
        for (let index = 0; storage && index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(DEVICE_SCORE_PREFIX)) continue;
          try {
            const entry = JSON.parse(storage.getItem(key) ?? "null");
            if (isScore(entry) && "completedAt" in entry && typeof entry.completedAt === "number" &&
              Number.isFinite(entry.completedAt) && key === DEVICE_SCORE_PREFIX + entry.runKey) {
              runs.set(entry.runKey, { ...entry, completedAt: entry.completedAt });
            }
          } catch { /* One unreadable inscription must not hide the others. */ }
        }
      } catch { persistent = false; }
      const recent = [...runs.values()].sort((a, b) => b.completedAt - a.completedAt);
      const best = [...recent].sort((a, b) => b.kleos - a.kleos || b.tide - a.tide ||
        b.captures - a.captures || a.completedAt - b.completedAt)[0] ?? null;
      return { best, recent: recent.slice(0, 5), runs: recent.length, persistent };
    },
  };
}
