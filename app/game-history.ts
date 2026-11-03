import type { GameState } from "./game-engine";

export function rememberPlanningMove(
  history: readonly GameState[], before: GameState, after: GameState,
): GameState[] {
  if (before.phase !== "planning" || after.phase !== "planning" ||
    before.tide !== after.tide || before.runSeed !== after.runSeed ||
    after.actions !== before.actions - 1) return [...history];
  return [...history, { ...before, selection: null }].slice(-5);
}

export function undoPlanningMove(current: GameState, history: readonly GameState[]) {
  const previous = history.at(-1);
  if (current.phase !== "planning" || !previous || previous.phase !== "planning" ||
    previous.tide !== current.tide || previous.runSeed !== current.runSeed ||
    previous.actions !== current.actions + 1) return null;
  return {
    game: { ...previous, selection: null, message: "Move undone. Your materials and move are restored." },
    history: history.slice(0, -1),
  };
}
