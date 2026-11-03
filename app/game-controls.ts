import { BOARD_COLS, BOARD_ROWS, isWaterCol } from "./game-engine";

export const SWIPE_THRESHOLD = 14;

export interface BoardCellPosition {
  row: number;
  col: number;
}

export function resolveSwipeTarget(
  row: number,
  col: number,
  deltaX: number,
  deltaY: number,
): BoardCellPosition | null {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_THRESHOLD) return null;

  const rowDelta = Math.abs(deltaY) > Math.abs(deltaX) ? Math.sign(deltaY) : 0;
  const colDelta = rowDelta === 0 ? Math.sign(deltaX) : 0;
  const target = { row: row + rowDelta, col: col + colDelta };

  if (
    target.row < 0 ||
    target.row >= BOARD_ROWS ||
    target.col < 0 ||
    target.col >= BOARD_COLS ||
    isWaterCol(target.col)
  ) return null;

  return target;
}
