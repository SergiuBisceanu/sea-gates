import { loadStoredRun, RUN_BACKUP_STORAGE_KEY, RUN_STORAGE_KEY, saveStoredRun } from "./game-session";
import type { GameState } from "./game-engine";

export type CheckpointStatus = "saved" | "unavailable" | "other-tab";

// A suspended tab can receive pagehide after another tab has made several moves.
// Remember the checkpoint we actually read or wrote before replacing it.
export function openRunCheckpoints(storage: Storage | null) {
  let expected: string | null = null;
  let loaded = false;
  try {
    if (storage) {
      expected = storage.getItem(RUN_STORAGE_KEY);
      loaded = true;
    }
  } catch { /* A browser can allow access to localStorage but refuse reads. */ }
  const saved = loaded && storage ? loadStoredRun({
    getItem: key => key === RUN_STORAGE_KEY ? expected : storage.getItem(key),
  }) : null;
  let lastGame = saved?.recovered ? undefined : saved?.game;
  let lastHistory = saved?.undoHistory as readonly GameState[] | undefined;
  let lastKey = saved?.runKey;
  let startingNew = false;

  return {
    saved,
    beginNew() { startingNew = true; },
    save(game: GameState, runKey: string, history: readonly GameState[]): CheckpointStatus {
      if (!storage || !loaded) return "unavailable";
      try {
        if (storage.getItem(RUN_STORAGE_KEY) !== expected) return "other-tab";
        // Closing an idle second tab should not claim a new checkpoint.
        if (!startingNew && game === lastGame && history === lastHistory && runKey === lastKey) return "saved";
        const writer = {
          getItem: (key: string) => key === RUN_STORAGE_KEY ? expected : storage.getItem(key),
          setItem(key: string, value: string) {
            storage.setItem(key, value);
            if (key === RUN_STORAGE_KEY) expected = value;
          },
        };
        if (!saveStoredRun(writer, game, runKey, history)) return "unavailable";
        lastGame = game;
        lastHistory = history;
        lastKey = runKey;
        if (startingNew) {
          // The new polis must survive a failed write before discarding the old backup.
          try { storage.removeItem(RUN_BACKUP_STORAGE_KEY); } catch { /* Primary is safe. */ }
          startingNew = false;
        }
        return "saved";
      } catch {
        return "unavailable";
      }
    },
  };
}
