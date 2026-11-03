"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BOARD_COLS,
  BOARD_ROWS,
  CHANNEL_ENTRY_Y,
  MACHINE_LABELS,
  MATERIAL_LABELS,
  WATER_COLS,
  actOnLandCell,
  bossChannelForTide,
  channelForWaterCol,
  createInitialGame,
  dawnSupplyPreview,
  isWaterCol,
  isShipScreened,
  machineForMaterials,
  machineCoverage,
  selectCargoAt,
  shipActionEffect,
  startBattle,
  stepBattle,
  wavePreview,
  waveTitle,
  type CrewKind,
  type CreatureKind,
  type Effect,
  type GameState,
  type MachineKind,
  type MaterialKind,
  type Piece,
  type Ship,
} from "./game-engine";
import { resolveSwipeTarget, SWIPE_THRESHOLD } from "./game-controls";
import { rememberPlanningMove, undoPlanningMove } from "./game-history";
import { createDeviceRecords, createScoreOutbox } from "./game-scores";
import { openRunCheckpoints, type CheckpointStatus } from "./game-checkpoints";
import { loadSpriteImage } from "./game-assets";
import {
  AUDIO_STORAGE_KEY,
  browserStorage,
  createRunKey,
  readBattleSpeed,
  readBooleanPreference,
  writeBattleSpeed,
  writeBooleanPreference,
} from "./game-session";

const WIDTH = 414;
const HEIGHT = 640;
const RENDER_SCALE = 2;
const SIMULATION_STEP = 1 / 30;
const GRID_X = 15;
const GRID_Y = 139;
const CELL = 48;
const LAND_INSET = 2;

interface BoardPointerGesture {
  pointerId: number;
  row: number;
  col: number;
  x: number;
  y: number;
}

type BoardMotionKind = "swap" | "construction" | "upgrade" | "salvage" | "supply" | "rejected";

interface BoardMotionSprite {
  piece: Piece;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  collapse?: boolean;
  delay?: number;
}

interface BoardMotionResult {
  piece: Piece;
  row: number;
  col: number;
  delay?: number;
}

interface BoardMotion {
  kind: BoardMotionKind;
  startedAt: number;
  duration: number;
  hiddenCells: Array<{ row: number; col: number }>;
  sprites: BoardMotionSprite[];
  results: BoardMotionResult[];
}

interface SpriteAtlases {
  machines: HTMLImageElement | null;
  fleet: HTMLImageElement | null;
  resources: HTMLImageElement | null;
  crew: HTMLImageElement | null;
  terrain: HTMLImageElement | null;
  water: HTMLImageElement | null;
  backdrop: HTMLImageElement | null;
  gate: HTMLImageElement | null;
  skolopendra: HTMLImageElement | null;
  creatures: HTMLImageElement | null;
}

const EMPTY_ATLASES: SpriteAtlases = {
  machines: null,
  fleet: null,
  resources: null,
  crew: null,
  terrain: null,
  water: null,
  backdrop: null,
  gate: null,
  skolopendra: null,
  creatures: null,
};

type AtlasMachine = Exclude<MachineKind, "siphon">;
const MACHINE_ATLAS_ROW: Record<AtlasMachine, number> = {
  catapult: 0,
  arm: 1,
  automaton: 2,
};

type SkolopendraPose = "swim" | "awed" | "grappled" | "defeated";

const SKOLOPENDRA_POSE: Record<SkolopendraPose, { col: number; row: number }> = {
  swim: { col: 0, row: 0 },
  awed: { col: 1, row: 0 },
  grappled: { col: 0, row: 1 },
  defeated: { col: 1, row: 1 },
};

const SKOLOPENDRA_BANDS = [
  [0, 25],
  [23, 47],
  [45, 69],
  [67, 91],
  [89, 113],
  [111, 132],
  [130, 144],
] as const;

const MATERIAL_ATLAS_CELL: Record<MaterialKind, { col: number; row: number }> = {
  stone: { col: 0, row: 0 },
  timber: { col: 1, row: 0 },
  bronze: { col: 0, row: 1 },
  wine: { col: 1, row: 1 },
};

const MATERIAL_GLOW: Record<MaterialKind, { fill: string; edge: string; sparkle: string }> = {
  stone: { fill: "#f4d888", edge: "#b57a35", sparkle: "#fff8d8" },
  timber: { fill: "#df7d31", edge: "#753521", sparkle: "#ffe096" },
  bronze: { fill: "#f2aa35", edge: "#8c4924", sparkle: "#fff1a0" },
  wine: { fill: "#cf3d62", edge: "#711f45", sparkle: "#ffd0d6" },
};

const COLORS = {
  outline: "#171a24",
  seaDeep: "#083b66",
  sea: "#0b6f91",
  seaLight: "#22a5c3",
  foam: "#72d6d3",
  limestoneDark: "#74624f",
  limestone: "#b9a176",
  limestoneLight: "#e2d29b",
  timberDark: "#4d2b24",
  timber: "#8c5930",
  timberLight: "#d49a4f",
  bronzeDark: "#765029",
  bronze: "#c18a37",
  bronzeLight: "#f0cd70",
  wineDark: "#631f39",
  wine: "#a53d58",
  wineLight: "#e47779",
  oxblood: "#9a342b",
  parchment: "#e4cea1",
  parchmentDark: "#9f7651",
  gold: "#e5b951",
  red: "#c8492e",
  ink: "#382927",
};

function snapToRenderPixel(value: number) {
  return Math.round(value * RENDER_SCALE) / RENDER_SCALE;
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function animationClockSeconds() {
  return globalThis.performance.now() / 1000;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - clamp01(value), 3);
}

function easeOutBack(value: number) {
  const bounded = clamp01(value);
  return easeOutCubic(bounded) + Math.sin(bounded * Math.PI) * 0.075;
}

function armActionPose(progress: number) {
  const bounded = clamp01(progress);
  const cast = easeOutCubic(bounded / 0.3);
  const clamp = easeOutCubic((bounded - 0.3) / 0.12);
  const haul = easeOutCubic((bounded - 0.42) / 0.3);
  const release = easeOutCubic((bounded - 0.72) / 0.12);
  const retract = easeOutCubic((bounded - 0.84) / 0.16);
  return {
    cast,
    clamp,
    haul,
    release,
    retract,
    reach: cast * (1 - retract),
  };
}

function clawReachProgress(progress: number) {
  return armActionPose(progress).reach;
}

function effectProgress(effect: Effect) {
  const elapsed = effect.total - effect.ttl;
  const delay = effect.delay ?? 0;
  if (elapsed < delay) return 0;
  return clamp01((elapsed - delay) / Math.max(0.001, effect.total - delay));
}

function armFacesRight(col: number) {
  return col < 2 || col === 4;
}

function armRigGeometry(
  x: number,
  y: number,
  facesRight: boolean,
  tier: number,
  progress: number,
) {
  const pose = armActionPose(progress);
  const direction = facesRight ? 1 : -1;
  // These anchors follow the actual voxel crane in each atlas cell.
  const sourcePivotX = [22, 27, 29][tier - 1];
  const sourceTipX = [7, 10, 9][tier - 1];
  const sourceTipY = [4, 4, 2][tier - 1];
  const pivotX = x + (facesRight ? CELL - sourcePivotX : sourcePivotX);
  const pivotY = y + 34;
  const rotation = direction * (
    pose.cast * 0.1 - pose.haul * 0.2 + pose.release * 0.1
  ) * (1 - pose.retract);
  const dx = (sourceTipX - sourcePivotX) * (facesRight ? -1 : 1);
  const dy = sourceTipY - 34;
  const tipX = pivotX + dx * Math.cos(rotation) - dy * Math.sin(rotation);
  const tipY = pivotY + dx * Math.sin(rotation) + dy * Math.cos(rotation);
  return {
    ...pose,
    direction,
    pivotX,
    pivotY,
    rotation,
    tipX,
    tipY,
    parkedHookX: tipX,
    parkedHookY: tipY + [20, 25, 28][tier - 1],
  };
}

function isLegalLandTarget(state: GameState, row: number, col: number) {
  if (state.phase !== "planning" || state.actions <= 0 || isWaterCol(col)) return false;
  if (state.selection?.kind === "land") {
    if (Math.abs(state.selection.row - row) + Math.abs(state.selection.col - col) !== 1) return false;
    const source = state.board[state.selection.row][state.selection.col];
    const target = state.board[row][col];
    if (source?.kind === "material" && target?.kind === "material" && source.material === target.material) return false;
    if (source?.kind === "machine" && target?.kind === "machine" &&
      source.machine === target.machine && source.tier === 3 && target.tier === 3) return false;
    return true;
  }
  if (state.selection?.kind === "cargo") {
    const selectedCargoId = state.selection.id;
    const cargo = state.cargo.find((item) => item.id === selectedCargoId);
    if (!cargo || state.board[row][col]) return false;
    return cargo.row === row && Math.abs(WATER_COLS[cargo.channel] - col) === 1;
  }
  return false;
}

function isCompatibleBuildTarget(state: GameState, row: number, col: number) {
  if (state.selection?.kind !== "land") return false;
  const source = state.board[state.selection.row]?.[state.selection.col];
  const target = state.board[row]?.[col];
  if (!source || !target) return false;
  if (source.kind === "material" && target.kind === "material") {
    return machineForMaterials(source.material, target.material) !== null;
  }
  return (
    source.kind === "machine" &&
    target.kind === "machine" &&
    source.machine === target.machine &&
    source.tier === target.tier &&
    source.tier < 3
  );
}

function planningMotionForAction(
  before: GameState,
  after: GameState,
  targetRow: number,
  targetCol: number,
  startedAt: number,
): BoardMotion | null {
  if (after === before) return null;
  if (after.actions >= before.actions) {
    if (before.selection?.kind !== "land" || after.selection || after.message === before.message) return null;
    const { row, col } = before.selection;
    const piece = before.board[row][col];
    if (!piece || Math.abs(row - targetRow) + Math.abs(col - targetCol) !== 1) return null;
    return {
      kind: "rejected",
      startedAt,
      duration: 0.2,
      hiddenCells: [{ row, col }],
      sprites: [{ piece, fromRow: row, fromCol: col, toRow: targetRow, toCol: targetCol }],
      results: [],
    };
  }

  if (before.selection?.kind === "cargo") {
    const selectedCargoId = before.selection.id;
    const cargo = before.cargo.find((item) => item.id === selectedCargoId);
    const result = after.board[targetRow]?.[targetCol];
    if (!cargo || !result) return null;
    return {
      kind: "salvage",
      startedAt,
      duration: 0.44,
      hiddenCells: [{ row: targetRow, col: targetCol }],
      sprites: [{
        piece: { kind: "material", material: cargo.material },
        fromRow: cargo.row,
        fromCol: WATER_COLS[cargo.channel],
        toRow: targetRow,
        toCol: targetCol,
      }],
      results: [],
    };
  }

  if (before.selection?.kind !== "land") return null;
  const sourceRow = before.selection.row;
  const sourceCol = before.selection.col;
  const source = before.board[sourceRow]?.[sourceCol];
  const target = before.board[targetRow]?.[targetCol];
  const result = after.board[targetRow]?.[targetCol];
  if (!source) return null;

  const hiddenCells = [
    { row: sourceRow, col: sourceCol },
    { row: targetRow, col: targetCol },
  ];
  const construction =
    source.kind === "material" &&
    target?.kind === "material" &&
    result?.kind === "machine";
  const upgrade =
    source.kind === "machine" &&
    target?.kind === "machine" &&
    result?.kind === "machine" &&
    result.tier > target.tier;

  if ((construction || upgrade) && result) {
    return {
      kind: construction ? "construction" : "upgrade",
      startedAt,
      duration: 0.52,
      hiddenCells,
      sprites: [
        { piece: source, fromRow: sourceRow, fromCol: sourceCol, toRow: targetRow, toCol: targetCol, collapse: true },
        { piece: target, fromRow: targetRow, fromCol: targetCol, toRow: targetRow, toCol: targetCol, collapse: true },
      ],
      results: [{ piece: result, row: targetRow, col: targetCol, delay: 0.43 }],
    };
  }

  return {
    kind: "swap",
    startedAt,
    duration: 0.28,
    hiddenCells,
    sprites: [
      { piece: source, fromRow: sourceRow, fromCol: sourceCol, toRow: targetRow, toCol: targetCol },
      ...(target
        ? [{ piece: target, fromRow: targetRow, fromCol: targetCol, toRow: sourceRow, toCol: sourceCol }]
        : []),
    ],
    results: [],
  };
}

function supplyMotion(
  before: GameState,
  after: GameState,
  startedAt: number,
): BoardMotion | null {
  const results: BoardMotionResult[] = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = after.board[row][col];
      if (!before.board[row][col] && piece) {
        results.push({ piece, row, col, delay: results.length * 0.13 });
      }
    }
  }
  if (!results.length) return null;
  return {
    kind: "supply",
    startedAt,
    duration: 0.78,
    hiddenCells: results.map(({ row, col }) => ({ row, col })),
    sprites: [],
    results,
  };
}

function rect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke?: string,
  lineWidth = 2,
) {
  context.fillStyle = fill;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.strokeRect(
      Math.round(x) + lineWidth / 2,
      Math.round(y) + lineWidth / 2,
      Math.round(width) - lineWidth,
      Math.round(height) - lineWidth,
    );
  }
}

function line(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 2,
) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(Math.round(x1), Math.round(y1));
  context.lineTo(Math.round(x2), Math.round(y2));
  context.stroke();
}

function polygon(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  fill: string,
  stroke = COLORS.outline,
  lineWidth = 2,
) {
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(Math.round(x), Math.round(y));
    else context.lineTo(Math.round(x), Math.round(y));
  });
  context.closePath();
  context.fill();
  context.stroke();
}

function pixelPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = COLORS.outline,
  corner = 6,
  lineWidth = 2,
) {
  polygon(
    context,
    [
      [x + corner, y],
      [x + width - corner, y],
      [x + width, y + corner],
      [x + width, y + height - corner],
      [x + width - corner, y + height],
      [x + corner, y + height],
      [x, y + height - corner],
      [x, y + corner],
    ],
    fill,
    stroke,
    lineWidth,
  );

  // Small hard-edged highlights and shadows make every UI surface read like
  // the same carved, voxel-painted world as the board rather than flat canvas UI.
  context.save();
  context.globalAlpha = 0.42;
  line(
    context,
    x + corner + 3,
    y + 3,
    x + width - corner - 3,
    y + 3,
    "#fff0c2",
    Math.max(1, lineWidth - 1),
  );
  line(
    context,
    x + 3,
    y + corner + 2,
    x + 3,
    y + height - corner - 3,
    "#fff0c2",
    1,
  );
  context.globalAlpha = 0.34;
  line(
    context,
    x + corner + 3,
    y + height - 3,
    x + width - corner - 3,
    y + height - 3,
    "#171a24",
    Math.max(2, lineWidth),
  );
  line(
    context,
    x + width - 3,
    y + corner + 2,
    x + width - 3,
    y + height - corner - 3,
    "#171a24",
    2,
  );
  if (width >= 80 && height >= 30) {
    context.globalAlpha = 0.46;
    context.fillStyle = "#e5b951";
    context.fillRect(Math.round(x + corner + 3), Math.round(y + corner + 3), 2, 2);
    context.fillRect(Math.round(x + width - corner - 5), Math.round(y + corner + 3), 2, 2);
  }
  context.restore();
}

function pixelText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color = "#fff4cf",
  align: CanvasTextAlign = "center",
  maxWidth?: number,
) {
  context.save();
  context.font = `800 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = align;
  context.textBaseline = "middle";
  const shadowOffset = size >= 16 ? 2 : size >= 10 ? 1 : 0.5;
  if (![COLORS.ink, COLORS.wineDark, "#5b4134"].includes(color)) {
    context.fillStyle = COLORS.outline;
    context.fillText(text, Math.round(x) + shadowOffset, Math.round(y) + shadowOffset, maxWidth ?? WIDTH * 2);
  }
  context.fillStyle = color;
  context.fillText(text, Math.round(x), Math.round(y), maxWidth ?? WIDTH * 2);
  context.restore();
}

function drawAtlasCell(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  sourceCol: number,
  sourceRow: number,
  x: number,
  y: number,
  width = CELL,
  height = CELL,
) {
  context.drawImage(
    atlas,
    sourceCol * CELL,
    sourceRow * CELL,
    CELL,
    CELL,
    snapToRenderPixel(x),
    snapToRenderPixel(y),
    snapToRenderPixel(width),
    snapToRenderPixel(height),
  );
}

function drawResourceAtlasCell(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  kind: MaterialKind,
  x: number,
  y: number,
  width = CELL,
  height = CELL,
) {
  const cell = MATERIAL_ATLAS_CELL[kind];
  const sourceWidth = atlas.naturalWidth / 2;
  const sourceHeight = atlas.naturalHeight / 2;
  context.drawImage(
    atlas,
    cell.col * sourceWidth,
    cell.row * sourceHeight,
    sourceWidth,
    sourceHeight,
    snapToRenderPixel(x),
    snapToRenderPixel(y),
    snapToRenderPixel(width),
    snapToRenderPixel(height),
  );
}

function drawHeart(context: CanvasRenderingContext2D, x: number, y: number, filled: boolean) {
  const color = filled ? COLORS.red : "#63464a";
  rect(context, x + 3, y, 6, 4, color);
  rect(context, x + 11, y, 6, 4, color);
  rect(context, x, y + 3, 20, 7, color);
  rect(context, x + 3, y + 10, 14, 4, color);
  rect(context, x + 7, y + 14, 6, 4, color);
  rect(context, x + 4, y + 2, 4, 3, filled ? "#ef8a6d" : color);
}

function drawCyclopeanFallback(
  context: CanvasRenderingContext2D,
  damaged: boolean,
  shake: number,
  recoilY = 0,
) {
  const blocks: Array<[number, number, number, number, number]> = [
    [74, 43, 50, 25, -2], [126, 39, 67, 28, 1], [195, 42, 55, 24, -1],
    [252, 38, 72, 29, 2], [326, 45, 22, 25, -1], [69, 69, 43, 30, 1],
    [158, 69, 48, 29, -2], [208, 68, 43, 31, 1], [306, 70, 45, 28, -1],
    [72, 101, 40, 24, -1], [159, 100, 91, 25, 1], [305, 99, 45, 26, 2],
  ];
  context.save();
  context.translate(shake, recoilY);
  for (const [x, y, width, height, skew] of blocks) {
    polygon(
      context,
      [[x + skew, y], [x + width, y + 2], [x + width - skew, y + height], [x, y + height - 2]],
      damaged && x > 245 ? "#8f8069" : "#b9a87e",
      COLORS.outline,
      3,
    );
    line(context, x + 5, y + 5, x + width - 7, y + 4, "#e5d39c", 2);
  }
  for (const center of [135, 279]) {
    rect(context, center - 22, 67, 44, 59, "#182a32", COLORS.outline, 4);
    polygon(
      context,
      [[center - 25, 68], [center, 51], [center + 25, 68]],
      "#aa986f",
      COLORS.outline,
      3,
    );
  }
  context.restore();
}

function drawCastleFlameAccents(
  context: CanvasRenderingContext2D,
  time: number,
  damaged: boolean,
  shake: number,
  recoilY = 0,
) {
  const frame = Math.floor(modulo(time * 8, 3));
  const lift = [0, 2, 1][frame];
  const centers = damaged ? [120] : [120, 277];
  context.save();
  context.globalAlpha = 0.92;
  for (const center of centers) {
    rect(context, center - 2 + shake, 52 - lift + recoilY, 5, 5 + lift, "#e67824");
    rect(context, center - 1 + shake, 51 - lift + recoilY, 3, 4 + lift, "#ffd65a");
    rect(context, center + shake, 51 - lift + recoilY, 1, 2, "#fff3b0");
  }
  context.restore();
}

function drawCity(
  context: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  atlases: SpriteAtlases,
) {
  if (atlases.backdrop) {
    drawCroppedSprite(
      context,
      atlases.backdrop,
      0,
      0,
      atlases.backdrop.naturalWidth,
      atlases.backdrop.naturalHeight,
      0,
      0,
      WIDTH,
      139,
    );
  } else {
    rect(context, 0, 0, WIDTH, 139, "#87b8be");
    rect(context, 0, 84, WIDTH, 55, "#8b9e87");
    polygon(context, [[0, 91], [57, 52], [126, 91]], "#647d70", "#647d70", 1);
    polygon(context, [[72, 91], [174, 47], [246, 91]], "#738b74", "#738b74", 1);
    polygon(context, [[216, 91], [337, 48], [414, 91]], "#566f68", "#566f68", 1);
  }

  // The two channels continue behind the wall and terminate in the sea gates.
  for (const waterCol of WATER_COLS) {
    const waterX = GRID_X + waterCol * CELL;
    context.save();
    context.beginPath();
    context.rect(waterX, 62, CELL, 77);
    context.clip();
    if (atlases.water) {
      drawWaterAtlasTile(context, atlases.water, waterX, 62, time, waterCol, waterCol * 0.37);
      drawWaterAtlasTile(
        context,
        atlases.water,
        waterX,
        110,
        time,
        waterCol + 1,
        waterCol * 0.37 + 0.43,
      );
    } else {
      context.fillStyle = COLORS.seaDeep;
      context.fillRect(waterX, 62, CELL, 77);
      context.fillStyle = COLORS.seaLight;
      const glint = modulo(time * 13 + waterCol * 7, 34);
      context.fillRect(waterX + 8 + glint * 0.35, 76, 17, 2);
      context.fillRect(waterX + 24 - glint * 0.25, 91, 13, 2);
    }
    context.restore();
  }

  const landing = state.effects.find((effect) => effect.kind === "landing");
  const hitProgress = landing ? 1 - landing.ttl / landing.total : 1;
  const shake = landing
    ? Math.sin(hitProgress * Math.PI * 10) * (1 - hitProgress) * 3
    : 0;
  const recoilY = landing
    ? Math.sin(hitProgress * Math.PI * 6) * (1 - hitProgress) * 1.8
    : 0;
  const damaged = state.harbor <= Math.ceil(state.maxHarbor / 2);

  if (atlases.gate) {
    const sourceWidth = atlases.gate.naturalWidth / 2;
    const sourceHeight = atlases.gate.naturalHeight / 2;
    drawCroppedSprite(
      context,
      atlases.gate,
      0,
      damaged ? sourceHeight : 0,
      sourceWidth,
      sourceHeight,
      47 + shake,
      7 + recoilY,
      320,
      132,
    );
    drawCastleFlameAccents(context, time, damaged, shake, recoilY);
  } else {
    drawCyclopeanFallback(context, damaged, shake, recoilY);
  }

  if (landing) {
    context.save();
    context.globalAlpha = Math.max(0, (1 - hitProgress) * 0.7);
    for (let mote = 0; mote < 7; mote++) {
      const direction = mote % 2 === 0 ? -1 : 1;
      const dustX = 207 + direction * (18 + mote * 9) * hitProgress;
      const dustY = 111 - Math.sin(hitProgress * Math.PI) * (7 + (mote % 3) * 4);
      rect(context, dustX, dustY, 3 + (mote % 2), 3, mote % 3 === 0 ? "#e2d29b" : "#9f7651");
    }
    context.restore();
  }

}

function drawHud(context: CanvasRenderingContext2D, state: GameState) {
  const landing = state.effects.find((effect) => effect.kind === "landing");
  const restoration = state.effects.find((effect) => effect.kind === "monsterFall");
  const landingProgress = landing ? clamp01(1 - landing.ttl / landing.total) : 1;
  const restorationProgress = restoration
    ? clamp01(1 - restoration.ttl / restoration.total)
    : 1;
  const lostHearts = landing?.label ? Number.parseInt(landing.label.replace("-", ""), 10) || 1 : 0;
  pixelPanel(context, 11, 103, 98, 31, "#244c5c", COLORS.outline, 5, 2);
  pixelPanel(context, 164, 103, 86, 31, "#244c5c", COLORS.outline, 5, 2);
  pixelPanel(context, 307, 103, 96, 31, "#244c5c", COLORS.outline, 5, 2);
  for (let index = 0; index < state.maxHarbor; index++) {
    const ghostHeart = Boolean(
      landing && index >= state.harbor && index < state.harbor + lostHearts,
    );
    const restoredHeart = Boolean(restoration && index === state.harbor - 1);
    const heartPulse = ghostHeart
      ? 1 + Math.sin(landingProgress * Math.PI) * 0.34
      : restoredHeart
        ? 1 + Math.sin(restorationProgress * Math.PI) * 0.28
        : 1;
    context.save();
    context.globalAlpha = ghostHeart ? Math.max(0.18, 1 - landingProgress) : 1;
    context.translate(23.4 + index * 14.5, 115.8);
    context.scale(0.64 * heartPulse, 0.64 * heartPulse);
    context.translate(-10, -9);
    drawHeart(context, 0, 0, index < state.harbor || ghostHeart);
    context.restore();
  }
  pixelText(context, `TIDE ${state.tide}`, 207, 112, 10, "#fff0b4");
  pixelText(context, `${state.kleos} K`, 207, 126, 8, COLORS.gold);
  pixelText(
    context,
    state.phase === "battle" ? "DEFEND" : `${state.actions} MOVES`,
    355,
    119,
    10,
    state.phase === "battle" ? "#ffb07b" : "#f0cd70",
  );
}

function drawLandCell(
  context: CanvasRenderingContext2D,
  row: number,
  col: number,
  atlas?: HTMLImageElement | null,
) {
  const x = GRID_X + col * CELL;
  const y = GRID_Y + row * CELL;
  const tileX = x + LAND_INSET;
  const tileY = y + LAND_INSET;
  const tileSize = CELL - LAND_INSET * 2;
  if (atlas) {
    const sourceWidth = atlas.naturalWidth / 4;
    const sourceHeight = atlas.naturalHeight / 2;
    const variant = modulo(row * 5 + col * 3, 8);
    drawCroppedSprite(
      context,
      atlas,
      (variant % 4) * sourceWidth,
      Math.floor(variant / 4) * sourceHeight,
      sourceWidth,
      sourceHeight,
      x,
      y,
      CELL,
      CELL,
    );
    return;
  }
  const even = (row + col) % 2 === 0;
  rect(context, tileX, tileY, tileSize, tileSize, even ? "#b8a476" : "#c1ad7d");
  rect(context, tileX, tileY + tileSize - 7, tileSize, 7, COLORS.limestoneDark);
  line(context, tileX + 1, tileY + 1, tileX + tileSize - 2, tileY + 1, "#ead8a4", 2);
  line(context, tileX + 1, tileY + 1, tileX + 1, tileY + tileSize - 7, "#dac993", 2);
  line(context, tileX, tileY + tileSize - 1, tileX + tileSize, tileY + tileSize - 1, COLORS.outline, 2);
  line(context, tileX + tileSize - 1, tileY, tileX + tileSize - 1, tileY + tileSize, "#665744", 2);
  if ((row * 7 + col * 3) % 4 === 0) {
    line(context, tileX + 8, tileY + 12, tileX + 16, tileY + 12, "#8e7858", 2);
    line(context, tileX + 16, tileY + 12, tileX + 20, tileY + 17, "#8e7858", 2);
  }
  if ((row + col) % 3 === 0) {
    rect(context, tileX + 32, tileY + 7, 4, 6, "#607b5c");
    rect(context, tileX + 36, tileY + 10, 3, 5, "#739665");
  }
}

function drawBoardWaterBed(
  context: CanvasRenderingContext2D,
  time: number,
  atlas?: HTMLImageElement | null,
) {
  const left = 0;
  const top = GRID_Y - 4;
  const width = WIDTH;
  const height = BOARD_ROWS * CELL + 8;
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  context.fillStyle = COLORS.seaDeep;
  context.fillRect(left, top, width, height);

  if (atlas) {
    for (let row = -1; row <= BOARD_ROWS; row++) {
      for (let col = -1; col <= BOARD_COLS; col++) {
        // The animated bed remains beneath the transparent margins of every
        // stone cell, so water flows continuously around all three banks.
        drawWaterAtlasTile(
          context,
          atlas,
          GRID_X + col * CELL,
          GRID_Y + row * CELL,
          time,
          row + col + 16,
          row * 0.43 + col * 0.71,
        );
      }
    }
    drawVoxelShoreFoam(context, GRID_X - CELL, GRID_Y, BOARD_ROWS * CELL, time);
    drawVoxelShoreFoam(
      context,
      GRID_X + BOARD_COLS * CELL,
      GRID_Y,
      BOARD_ROWS * CELL,
      time,
    );
  } else {
    context.fillStyle = COLORS.sea;
    for (let row = 0; row < BOARD_ROWS + 1; row++) {
      const drift = modulo(time * 13 + row * 17, 31);
      context.fillRect(left + 7 + drift, top + row * CELL + 9, 18, 3);
    }
  }
  context.restore();
}

function drawWaterAtlasTile(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  x: number,
  y: number,
  time: number,
  variant: number,
  phase: number,
) {
  const sourceWidth = atlas.naturalWidth / 4;
  const sourceHeight = atlas.naturalHeight / 2;
  const frameStep = Math.floor(modulo(time * 4 + phase * 0.37, 6));
  const frame = [0, 1, 2, 3, 2, 1][frameStep];
  drawCroppedSprite(
    context,
    atlas,
    frame * sourceWidth,
    modulo(variant, 2) * sourceHeight,
    sourceWidth,
    sourceHeight,
    x,
    y,
    CELL,
    CELL,
  );
}

function drawVoxelShoreFoam(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  time: number,
) {
  for (const side of [0, 1]) {
    const direction = side === 0 ? 1 : -1;
    const edgeX = side === 0 ? x : x + CELL - 2;
    for (let index = 0; index < 10; index++) {
      const foamY = y + modulo(index * 33 - time * (13 + side * 2), height + 18) - 9;
      const pulse = Math.floor(modulo(time * 6 + index + side, 3));
      context.fillStyle = index % 3 === 0 ? "#d8f1df" : "#71d4d0";
      context.fillRect(Math.round(edgeX), Math.round(foamY), 2, 6 + pulse * 2);
      context.fillRect(
        Math.round(edgeX + direction * 2),
        Math.round(foamY + 2 + pulse),
        2 + (index % 2),
        3,
      );
      if (index % 3 === 0) {
        context.fillStyle = "#b9ecdf";
        context.fillRect(
          Math.round(edgeX + direction * 4),
          Math.round(foamY + 5),
          2,
          2,
        );
      }
    }
  }
}

function drawWaterChannel(
  context: CanvasRenderingContext2D,
  col: number,
  time: number,
  atlas?: HTMLImageElement | null,
) {
  const x = GRID_X + col * CELL;
  const y = GRID_Y;
  const height = BOARD_ROWS * CELL;
  context.save();
  context.beginPath();
  context.rect(x, y, CELL, height);
  context.clip();

  if (atlas) {
    context.fillStyle = COLORS.seaDeep;
    context.fillRect(x, y, CELL, height);
    for (let row = 0; row < BOARD_ROWS; row++) {
      drawWaterAtlasTile(
        context,
        atlas,
        x,
        y + row * CELL,
        time,
        row + col,
        row * 0.43 + col * 0.37,
      );
    }
    drawVoxelShoreFoam(context, x, y, height, time);
    context.restore();
    return;
  }

  context.fillStyle = COLORS.seaDeep;
  context.fillRect(x, y, CELL, height);
  context.fillStyle = "#0b5482";
  for (let band = 0; band < 7; band++) {
    const bandY = y + modulo(band * 47 - time * 9, height + 54) - 27;
    const offset = Math.sin(time * 0.9 + band * 1.7 + col) * 5;
    context.fillRect(x + 5 + offset, bandY, 38, 13);
  }

  const layers = [
    { color: "#117da0", speed: 17, phase: 0, width: 2 },
    { color: COLORS.seaLight, speed: 23, phase: 1.7, width: 2 },
    { color: "#62cbd0", speed: 31, phase: 3.2, width: 1.5 },
  ];
  context.lineCap = "square";
  for (const [layerIndex, layer] of layers.entries()) {
    context.strokeStyle = layer.color;
    context.lineWidth = layer.width;
    context.globalAlpha = 0.56 + layerIndex * 0.12;
    for (let index = 0; index < 7; index++) {
      const waveY = y + modulo(index * 49 - time * layer.speed + layer.phase * 20, height + 38) - 19;
      const sway = Math.sin(time * (1.15 + layerIndex * 0.13) + index + col) * 3;
      context.beginPath();
      context.moveTo(x + 5 + sway, waveY);
      context.bezierCurveTo(
        x + 13 + sway,
        waveY - 3,
        x + 20 + sway,
        waveY + 3,
        x + 28 + sway,
        waveY,
      );
      context.stroke();
      context.beginPath();
      context.moveTo(x + 31 - sway * 0.5, waveY + 15);
      context.lineTo(x + 42 - sway * 0.5, waveY + 15);
      context.stroke();
    }
  }

  context.globalAlpha = 0.9;
  for (const side of [0, 1]) {
    const edgeX = side === 0 ? x + 1 : x + CELL - 3;
    for (let index = 0; index < 11; index++) {
      const foamY = y + modulo(index * 31 - time * (20 + side * 4), height + 22) - 11;
      const width = 2.5 + (Math.sin(time * 2 + index * 2.1 + side) + 1) * 1.2;
      context.fillStyle = index % 3 === 0 ? "#d0f0df" : COLORS.foam;
      context.fillRect(edgeX, foamY, width, 10 + (index % 2) * 4);
    }
  }
  context.restore();
}

function drawStone(context: CanvasRenderingContext2D, x: number, y: number) {
  polygon(context, [[x + 8, y + 13], [x + 33, y + 9], [x + 39, y + 19], [x + 34, y + 36], [x + 9, y + 38], [x + 5, y + 23]], COLORS.limestoneDark);
  polygon(context, [[x + 10, y + 14], [x + 31, y + 12], [x + 34, y + 20], [x + 11, y + 23]], COLORS.limestoneLight, COLORS.limestoneLight, 1);
  rect(context, x + 13, y + 27, 12, 4, "#858b87");
}

function drawTimber(context: CanvasRenderingContext2D, x: number, y: number) {
  for (let index = 0; index < 3; index++) {
    const offset = index * 8;
    rect(context, x + 6 + offset, y + 12, 10, 29, COLORS.timber, COLORS.outline, 2);
    rect(context, x + 8 + offset, y + 15, 3, 22, COLORS.timberLight);
    rect(context, x + 8 + offset, y + 9, 7, 7, "#c47d43", COLORS.outline, 1);
  }
  line(context, x + 5, y + 29, x + 38, y + 29, "#d7b16b", 3);
}

function drawBronze(context: CanvasRenderingContext2D, x: number, y: number) {
  polygon(context, [[x + 7, y + 29], [x + 14, y + 14], [x + 35, y + 14], [x + 40, y + 29], [x + 33, y + 37], [x + 12, y + 37]], COLORS.bronze);
  polygon(context, [[x + 14, y + 15], [x + 35, y + 15], [x + 31, y + 22], [x + 12, y + 22]], COLORS.bronzeLight, COLORS.bronzeDark, 1);
  rect(context, x + 16, y + 27, 14, 4, COLORS.bronzeDark);
}

function drawWine(context: CanvasRenderingContext2D, x: number, y: number) {
  polygon(context, [[x + 18, y + 7], [x + 29, y + 7], [x + 29, y + 14], [x + 35, y + 21], [x + 33, y + 39], [x + 14, y + 39], [x + 12, y + 21], [x + 18, y + 14]], "#b97844");
  rect(context, x + 18, y + 5, 11, 5, COLORS.limestoneLight, COLORS.outline, 2);
  rect(context, x + 15, y + 23, 18, 9, COLORS.wineDark, COLORS.outline, 1);
  rect(context, x + 19, y + 25, 9, 3, COLORS.wineLight);
  line(context, x + 13, y + 20, x + 7, y + 27, COLORS.outline, 3);
  line(context, x + 34, y + 20, x + 40, y + 27, COLORS.outline, 3);
}

function drawResourceHalo(
  context: CanvasRenderingContext2D,
  kind: MaterialKind,
  x: number,
  y: number,
  time: number,
  motionSeed: number,
  selected: boolean,
) {
  const palette = MATERIAL_GLOW[kind];
  const pulse = selected
    ? 0.68 + Math.sin(time * 8 + motionSeed) * 0.1
    : 0.34 + Math.sin(time * 2.2 + motionSeed * 0.7) * 0.025;
  context.save();
  context.globalAlpha = pulse;
  polygon(
    context,
    [
      [x + 9, y + 6],
      [x + 39, y + 6],
      [x + 45, y + 11],
      [x + 45, y + 38],
      [x + 39, y + 44],
      [x + 9, y + 44],
      [x + 3, y + 38],
      [x + 3, y + 11],
    ],
    palette.fill,
    selected ? COLORS.gold : palette.edge,
    selected ? 3 : 2,
  );
  context.globalAlpha = selected ? 0.62 : 0.26;
  line(context, x + 10, y + 8, x + 34, y + 8, palette.sparkle, 2);
  line(context, x + 7, y + 11, x + 7, y + 27, palette.sparkle, 1.5);
  context.restore();
}

function drawResourceSparkle(
  context: CanvasRenderingContext2D,
  kind: MaterialKind,
  x: number,
  y: number,
  time: number,
  motionSeed: number,
  selected: boolean,
) {
  const phase = modulo(time * 0.72 + motionSeed * 0.173, 1);
  const wink = phase < 0.18 ? Math.sin((phase / 0.18) * Math.PI) : 0;
  const alpha = selected ? Math.max(0.55, wink) : wink;
  if (alpha <= 0) return;
  const anchor = {
    stone: [14, 11],
    timber: [34, 12],
    bronze: [14, 15],
    wine: [31, 9],
  }[kind];
  const sparkleX = x + anchor[0];
  const sparkleY = y + anchor[1];
  context.save();
  context.globalAlpha = alpha;
  rect(context, sparkleX - 1, sparkleY - 5, 3, 11, MATERIAL_GLOW[kind].sparkle);
  rect(context, sparkleX - 5, sparkleY - 1, 11, 3, MATERIAL_GLOW[kind].sparkle);
  rect(context, sparkleX, sparkleY, 2, 2, "#ffffff");
  context.restore();
}

function drawMaterial(
  context: CanvasRenderingContext2D,
  kind: MaterialKind,
  x: number,
  y: number,
  atlas?: HTMLImageElement | null,
  time = 0,
  motionSeed = 0,
  selected = false,
) {
  drawResourceHalo(context, kind, x, y, time, motionSeed, selected);
  if (atlas) {
    if (kind === "wine") {
      drawResourceAtlasCell(context, atlas, kind, x, y + 3, CELL, CELL);
    } else {
      drawResourceAtlasCell(context, atlas, kind, x - 2, y - 1, CELL + 4, CELL + 4);
    }
  } else {
    if (kind === "stone") drawStone(context, x, y);
    if (kind === "timber") drawTimber(context, x, y);
    if (kind === "bronze") drawBronze(context, x, y);
    if (kind === "wine") drawWine(context, x, y);
  }
  drawResourceSparkle(context, kind, x, y, time, motionSeed, selected);
}

function drawCatapult(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: number,
  active: boolean,
) {
  rect(context, x + 5, y + 35, 39, 9, COLORS.limestoneDark, COLORS.outline, 2);
  line(context, x + 10, y + 37, x + 23, y + 15, COLORS.outline, 7);
  line(context, x + 38, y + 37, x + 24, y + 15, COLORS.outline, 7);
  line(context, x + 10, y + 37, x + 23, y + 15, COLORS.timber, 4);
  line(context, x + 38, y + 37, x + 24, y + 15, COLORS.timberLight, 4);
  line(context, x + 24, y + 35, x + (active ? 14 : 34), y + (active ? 10 : 4), COLORS.outline, 7);
  line(context, x + 24, y + 35, x + (active ? 14 : 34), y + (active ? 10 : 4), COLORS.timber, 4);
  context.fillStyle = COLORS.limestoneLight;
  context.strokeStyle = COLORS.outline;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x + (active ? 13 : 35), y + (active ? 8 : 4), 5 + tier, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  for (let index = 1; index < tier; index++) {
    rect(context, x + 4 + index * 28, y + 28, 7, 9, COLORS.bronze, COLORS.outline, 1);
  }
}

function drawArm(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: number,
  facesRight: boolean,
  active: boolean,
) {
  const direction = facesRight ? 1 : -1;
  const postX = x + (facesRight ? 15 : 33);
  rect(context, x + 7, y + 36, 35, 8, COLORS.limestoneDark, COLORS.outline, 2);
  line(context, postX, y + 39, postX, y + 8, COLORS.outline, 8);
  line(context, postX, y + 39, postX, y + 8, COLORS.timber, 5);
  line(context, postX, y + 11, postX + direction * (25 + tier * 4), y + 5, COLORS.outline, 7);
  line(context, postX, y + 11, postX + direction * (25 + tier * 4), y + 5, COLORS.timberLight, 4);
  const hookX = postX + direction * (24 + tier * 4);
  const hookBottom = y + (active ? 40 : 28);
  line(context, hookX, y + 5, hookX, hookBottom, "#34353c", 2);
  line(context, hookX, hookBottom, hookX + direction * 5, hookBottom + 5, COLORS.outline, 3);
  rect(context, postX - direction * 8 - 5, y + 16, 10, 13, COLORS.bronzeDark, COLORS.outline, 2);
  pixelText(context, `${tier}`, x + (facesRight ? 9 : 39), y + 39, 9, "#fff4cf");
}

function drawAutomaton(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: number,
  active: boolean,
) {
  rect(context, x + 7, y + 37, 35, 7, COLORS.limestoneDark, COLORS.outline, 2);
  rect(context, x + 12, y + 30, 25, 9, COLORS.wineDark, COLORS.outline, 2);
  rect(context, x + 20, y + 13, 11, 18, COLORS.bronze, COLORS.outline, 2);
  rect(context, x + 21, y + 6, 10, 10, COLORS.bronzeLight, COLORS.outline, 2);
  line(context, x + 21, y + 19, x + 12, y + 25, COLORS.bronzeLight, 3);
  line(context, x + 31, y + 19, x + 38, y + 22, COLORS.bronze, 3);
  if (active) {
    line(context, x + 12, y + 25, x + 10, y + 34, COLORS.wineLight, 3);
    rect(context, x + 8, y + 32, 6, 4, COLORS.wine);
  }
  for (let index = 1; index < tier; index++) {
    const figureX = index === 1 ? x + 7 : x + 38;
    rect(context, figureX - 3, y + 22, 6, 13, COLORS.bronze, COLORS.outline, 1);
    rect(context, figureX - 2, y + 17, 5, 6, COLORS.bronzeLight, COLORS.outline, 1);
  }
  if (tier === 3) {
    line(context, x + 8, y + 12, x + 40, y + 12, COLORS.gold, 3);
    rect(context, x + 11, y + 8, 4, 4, COLORS.wineLight);
    rect(context, x + 34, y + 8, 4, 4, COLORS.wineLight);
  }
  pixelText(context, `${tier}`, x + 40, y + 39, 9, "#fff4cf");
}

function drawAnimatedMachineSprite(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  machine: AtlasMachine,
  tier: number,
  x: number,
  y: number,
  time: number,
  motionSeed: number,
  active: boolean,
  actionProgress = 0,
) {
  const sourceX = (tier - 1) * CELL;
  const sourceY = MACHINE_ATLAS_ROW[machine] * CELL;
  const frame = Math.floor(modulo(time * 5 + motionSeed * 0.43, 4));
  const ping = [0, 1, 0, -1][frame];
  const split = machine === "automaton" ? 35 : machine === "arm" ? 32 : 31;
  const overlap = 2;
  const progress = clamp01(actionProgress);
  const release = easeOutCubic(clamp01(progress / 0.28));
  const settle = easeOutCubic(clamp01((progress - 0.32) / 0.68));
  const throwArc = release - settle;
  const hold = clawReachProgress(progress);
  const recoil = active
    ? Math.sin(Math.max(0, progress - 0.18) * Math.PI * 5.5) * Math.exp(-progress * 3.1)
    : 0;

  // The masonry base stays planted while the working assembly moves above it.
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY + split - overlap,
    CELL,
    CELL - split + overlap,
    x,
    y + split - overlap,
    CELL,
    CELL - split + overlap,
  );

  context.save();
  if (machine === "catapult") {
    // The throwing assembly snaps forward, overshoots, then settles on its
    // fixed stone base. The projectile effect begins at the same pivot.
    const rotation = active
      ? (-11 * (1 - release) + throwArc * 9 + recoil * 7) * (Math.PI / 180)
      : ping * 0.012;
    context.translate(x + 24, y + split - 2);
    context.rotate(rotation);
    context.translate(-(x + 24), -(y + split - 2));
    context.translate(active ? -throwArc * 2 : ping, active ? -Math.abs(recoil) * 2 : 0);
  } else if (machine === "arm") {
    // The whole crane shoulders into the channel during the outward pull,
    // locks while the hook holds, and kicks back on release.
    const lean = active ? (-hold * 7 + recoil * 3) * (Math.PI / 180) : ping * 0.009;
    context.translate(x + 25, y + split);
    context.rotate(lean);
    context.translate(-(x + 25), -(y + split));
    context.translate(active ? hold * 4 : ping, active ? -hold * 2 : Math.abs(ping) * 0.5);
  } else {
    // The automaton compresses, springs upright, and shakes the wine vessels
    // through the pulse instead of merely floating above its plinth.
    const ritual = active ? Math.abs(Math.sin(progress * Math.PI * 2)) * (1 - progress * 0.2) : 0;
    const tremor = active ? Math.sin(progress * Math.PI * 8) * (1 - progress) : ping;
    context.translate(x + CELL / 2, y + split);
    context.scale(1 + ritual * 0.05, 1 - ritual * 0.09);
    context.translate(-(x + CELL / 2), -(y + split));
    context.translate(tremor * 1.5, active ? -ritual * 5 : ping === 0 ? 0 : -1);
  }
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY,
    CELL,
    split + overlap,
    x,
    y,
    CELL,
    split + overlap,
  );
  context.restore();

  if (!active) return;

  const flash = Math.sin(progress * Math.PI);
  context.save();
  context.globalAlpha = flash * 0.95;
  if (machine === "catapult") {
    const snap = release < 1 ? 8 + release * 8 : 16 + recoil * 3;
    line(context, x + 24, y + 17, x + 24 + snap, y + 9 - release * 4, COLORS.gold, 1.5);
    rect(context, x + 19 - release * 3, y + 10, 3, 3, "#fff0b4");
  } else if (machine === "arm") {
    const brace = Math.round(hold * 5);
    line(context, x + 18, y + 28, x + 30 + brace, y + 15 - brace, COLORS.bronzeLight, 2);
    rect(context, x + 27 + brace, y + 11 - brace, 3, 3, COLORS.gold);
  } else {
    const ritualBeat = Math.abs(Math.sin(progress * Math.PI * 2));
    const radius = 7 + ritualBeat * 11;
    context.fillStyle = progress < 0.5 ? COLORS.wineLight : COLORS.gold;
    for (let spark = 0; spark < 10; spark++) {
      const angle = spark * Math.PI / 5 + progress * 0.7;
      const sparkX = Math.round(x + CELL / 2 + Math.cos(angle) * radius);
      const sparkY = Math.round(y + 22 + Math.sin(angle) * radius);
      context.fillRect(sparkX, sparkY, 2, 2);
    }
    rect(context, x + 10, y + 9 - flash * 3, 3, 3, COLORS.wineLight);
    rect(context, x + 36, y + 11 - flash * 4, 3, 3, COLORS.gold);
  }
  context.restore();
}

export function drawArmRig(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  tier: number,
  x: number,
  y: number,
  facesRight: boolean,
  active: boolean,
  actionProgress: number,
) {
  const sourceX = (tier - 1) * CELL;
  const sourceY = MACHINE_ATLAS_ROW.arm * CELL;
  const rig = armRigGeometry(x, y, facesRight, tier, active ? actionProgress : 0);
  const drawX = facesRight ? 0 : x;
  const ropeWidth = [13, 16, 15][tier - 1];
  const ropeTop = [10, 11, 13][tier - 1];
  const ropeBottom = [32, 40, 36][tier - 1];

  // Render the original shaded masonry, winch, mast and counterweights.
  // Only the working assembly leans; the complete plinth remains planted.
  context.save();
  if (facesRight) {
    context.translate(x + CELL, 0);
    context.scale(-1, 1);
  }
  if (active && ropeBottom > 34) {
    context.beginPath();
    context.rect(drawX + ropeWidth, y + 34, CELL - ropeWidth, ropeBottom - 34);
    context.rect(drawX, y + ropeBottom, CELL, CELL - ropeBottom);
    context.clip();
  }
  drawCroppedSprite(context, atlas, sourceX, sourceY + 34, CELL, 14,
    drawX, y + 34, CELL, 14);
  context.restore();

  context.save();
  context.translate(rig.pivotX, rig.pivotY);
  context.rotate(rig.rotation);
  context.translate(-rig.pivotX, -rig.pivotY);
  if (facesRight) {
    context.translate(x + CELL, 0);
    context.scale(-1, 1);
  }
  if (active) {
    // Replace only the parked rope and hook while the animated claw is out.
    // The original boom stays visible, with no second beam drawn over it.
    context.beginPath();
    context.rect(drawX, y, CELL, ropeTop);
    context.rect(drawX + ropeWidth, y + ropeTop, CELL - ropeWidth, 34 - ropeTop);
    context.clip();
  }
  drawCroppedSprite(context, atlas, sourceX, sourceY, CELL, 34,
    drawX, y, CELL, 34);
  context.restore();

  pixelText(context, `${tier}`, x + (facesRight ? 8 : 40), y + 40, 8, "#fff4cf");
}

// The fire pump is painted at its native tile size, so it also works while
// the illustrated atlases are loading. Each upgrade adds a visible reservoir.
function drawSiphon(
  context: CanvasRenderingContext2D, x: number, y: number, tier: number,
  facesRight: boolean, time: number, progress: number,
) {
  context.save();
  context.translate(x + (facesRight ? CELL : 0), y);
  if (facesRight) context.scale(-1, 1);
  polygon(context, [[5, 35], [15, 30], [37, 30], [43, 35], [33, 42], [8, 41]], "#8a7357");
  polygon(context, [[5, 35], [32, 36], [43, 32], [43, 37], [32, 44], [6, 41]], "#665344");
  line(context, 8, 35, 30, 37, "#e6c88a", 1);
  line(context, 8, 39, 31, 41, "#ad8e66", 1);
  line(context, 32, 38, 41, 34, "#d3b480", 1);
  for (const [bx, by] of [[14, 37], [22, 39], [35, 38]]) {
    rect(context, bx, by, 1, 3, "#53463a");
    rect(context, bx + 1, by, 1, 1, "#e2c392");
  }
  const tanks = tier === 1 ? [28] : tier === 2 ? [35, 25] : [35, 31, 24];
  for (const [i, tankX] of tanks.entries()) {
    const top = 16 - (tier === 3 && i === 0 ? 7 : i * 2);
    polygon(context, [[tankX - 4, top], [tankX + 3, top - 1], [tankX + 6, top + 5],
      [tankX + 5, 33], [tankX + 2, 36], [tankX - 4, 35], [tankX - 6, 31], [tankX - 6, top + 6]], "#ad6634", "#392827", 1);
    polygon(context, [[tankX - 4, top + 1], [tankX + 1, top], [tankX + 3, top + 3],
      [tankX - 2, top + 6], [tankX - 5, top + 5]], "#dea75b", "#8b532d", 1);
    line(context, tankX - 3, top + 5, tankX - 3, 30, "#ffe28a", 2);
    line(context, tankX + 3, top + 5, tankX + 3, 32, "#743327", 2);
    line(context, tankX - 5, 28, tankX + 4, 27, "#493c37", 2);
    rect(context, tankX - 4, 30, 3, 2, "#db9a49");
    rect(context, tankX - 1, 33, 4, 1, "#71442e");
    rect(context, tankX, top + 7, 2, 4, "#cc8e42");
    rect(context, tankX + 2, top + 5, 2, 2, "#536054");
    rect(context, tankX - 3, top - 2, 6, 3, "#ddb05e", COLORS.outline, 1);
  }
  // A stepped bronze delivery tube and flared nozzle face the channel.
  const kick = Math.sin(progress * Math.PI) * 2;
  context.translate(kick, 0);
  polygon(context, [[24, 24], [20, 27], [7, 18], [6, 12], [11, 12], [19, 19], [24, 17]], "#b16b33", "#392827", 1);
  line(context, 10, 17, 20, 25, "#694129", 1);
  line(context, 21, 24, 24, 21, "#d7ab65", 1);
  line(context, 10, 14, 20, 21, "#ffe08a", 2);
  line(context, 15, 20, 17, 17, "#55372a", 2);
  polygon(context, [[5, 12], [9, 9], [13, 14], [8, 19]], "#d59e4a", "#392827", 1);
  line(context, 6, 13, 9, 10, "#593a32", 2);
  const flicker = Math.floor(modulo(time * 7, 3));
  rect(context, 4, 9 - flicker, 3, 4 + flicker, "#a7412c");
  rect(context, 6, 10 - flicker, 3, 5 + flicker, "#df572b");
  rect(context, 7, 12 - flicker, 2, 3, "#ffe39b");
  context.restore();
  pixelText(context, `${tier}`, x + 40, y + 40, 8, "#fff4cf");
}

function drawMachine(
  context: CanvasRenderingContext2D,
  machine: MachineKind,
  tier: number,
  x: number,
  y: number,
  col: number,
  active: boolean,
  atlas?: HTMLImageElement | null,
  time = 0,
  motionSeed = 0,
  actionProgress = 0,
) {
  if (machine === "siphon") {
    drawSiphon(context, x, y, tier, armFacesRight(col), time + motionSeed, active ? actionProgress : 0);
    return;
  }
  if (atlas) {
    if (machine === "arm") {
      drawArmRig(
        context,
        atlas,
        tier,
        x,
        y,
        armFacesRight(col),
        active,
        actionProgress,
      );
      return;
    }
    // The catapult's loaded spoon is on the right in its atlas frame.
    // Mirror it on the banks where the water is to its left.
    if (machine === "catapult" && !armFacesRight(col)) {
      context.save();
      context.translate(Math.round(x + CELL), 0);
      context.scale(-1, 1);
      drawAnimatedMachineSprite(
        context,
        atlas,
        machine,
        tier,
        0,
        y,
        time,
        motionSeed,
        active,
        actionProgress,
      );
      context.restore();
    } else {
      drawAnimatedMachineSprite(
        context,
        atlas,
        machine,
        tier,
        x,
        y,
        time,
        motionSeed,
        active,
        actionProgress,
      );
    }
    if (active && machine === "automaton") {
      rect(context, x + 9, y + 11, 4, 4, COLORS.wineLight);
      rect(context, x + 35, y + 13, 3, 3, COLORS.gold);
    }
    pixelText(context, `${tier}`, x + 41, y + 40, 8, "#fff4cf");
    return;
  }
  if (machine === "catapult") {
    const mirror = !armFacesRight(col);
    context.save();
    if (mirror) {
      context.translate(x + CELL, 0);
      context.scale(-1, 1);
    }
    drawCatapult(context, mirror ? 0 : x, y, tier, active);
    context.restore();
    pixelText(context, `${tier}`, x + 40, y + 40, 8, "#fff4cf");
  }
  if (machine === "arm") drawArm(context, x, y, tier, armFacesRight(col), active);
  if (machine === "automaton") drawAutomaton(context, x, y, tier, active);
}

function drawPiece(
  context: CanvasRenderingContext2D,
  piece: Piece,
  row: number,
  col: number,
  time: number,
  atlases: SpriteAtlases,
  selected: boolean,
  activeEffect?: Effect,
) {
  const x = GRID_X + col * CELL;
  const y = GRID_Y + row * CELL;
  const centerX = x + CELL / 2;
  const centerY = y + CELL / 2;
  const motionSeed = row * BOARD_COLS + col;
  const resource = piece.kind === "material";
  const idlePhase = modulo(time * 0.42 + motionSeed * 0.137, 1);
  const idleBeat = resource && idlePhase < 0.1
    ? Math.sin((idlePhase / 0.1) * Math.PI) * 0.018
    : 0;
  const selectedPulse = selected ? Math.sin(time * 8.5 + motionSeed) * 0.015 : 0;
  const selectedScale = selected ? 0.055 : 0;
  const scaleX = resource ? 1 + selectedScale + selectedPulse + idleBeat * 0.35 : 1;
  const scaleY = resource ? 1 + selectedScale + selectedPulse - idleBeat : 1;
  const lift = resource && selected ? -2 : 0;

  const hasAtlasShadow = resource ? Boolean(atlases.resources) : Boolean(atlases.machines);
  if (selected || !hasAtlasShadow) {
    context.save();
    context.beginPath();
    context.rect(
      x + LAND_INSET,
      y + LAND_INSET,
      CELL - LAND_INSET * 2,
      CELL - LAND_INSET * 2,
    );
    context.clip();
    context.globalAlpha = selected ? 0.42 : resource ? 0.2 : 0.16;
    context.fillStyle = selected ? COLORS.gold : "#102634";
    context.beginPath();
    context.ellipse(centerX + 1, y + 40, selected ? 19 : 16, selected ? 6 : 5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  context.save();
  context.beginPath();
  context.rect(x + 1, y + 1, CELL - 2, CELL - 2);
  context.clip();
  context.translate(centerX, centerY + lift);
  context.scale(scaleX, scaleY);
  context.translate(-centerX, -centerY);
  if (piece.kind === "material") {
    drawMaterial(
      context,
      piece.material,
      x,
      y,
      atlases.resources,
      time,
      motionSeed,
      selected,
    );
  } else {
    const actionProgress = activeEffect ? effectProgress(activeEffect) : 0;
    drawMachine(
      context,
      piece.machine,
      piece.tier,
      x,
      y,
      col,
      Boolean(activeEffect),
      atlases.machines,
      time,
      motionSeed,
      actionProgress,
    );
  }
  context.restore();
}

export function shipScreenPosition(ship: Ship, renderY = ship.y) {
  const col = WATER_COLS[ship.channel];
  return {
    // Stable visual tracks let hulls pass without snapping sideways as their
    // neighbors change. Every wake, shot and claw shares this exact anchor.
    x: GRID_X + col * CELL + CELL / 2 + (ship.boss ? 0 : [-6, 0, 6][ship.id % 3]),
    y: GRID_Y + renderY * CELL + CELL / 2,
  };
}

export function fleetRenderOrder(state: GameState, previousState: GameState, interpolation: number) {
  const previousById = new Map(previousState.ships.map(ship => [ship.id, ship]));
  return state.ships.map(ship => {
    const previousShip = previousById.get(ship.id);
    const wasPreviouslyVisible = previousState.battleTime >= ship.spawnAt;
    const renderY = previousShip && wasPreviouslyVisible
      ? previousShip.y + (ship.y - previousShip.y) * clamp01(interpolation)
      : ship.y;
    return { ship, renderY };
  }).sort((a, b) => a.renderY - b.renderY || a.ship.id - b.ship.id);
}

function drawShipWake(
  context: CanvasRenderingContext2D,
  ship: Ship,
  time: number,
  renderY: number,
) {
  const { x, y } = shipScreenPosition(ship, renderY);
  const breadth = ship.boss ? 25 : ship.mass > 1 ? 15 : 10;
  const motionFactor = ship.awe > 0 ? 0.38 : 1;
  const length = (ship.boss ? 48 : 24 + ship.speed * 18) * motionFactor;
  const ripple = Math.sin(time * 4.2 + ship.id * 0.8) * 1.5;
  context.save();
  context.globalAlpha = ship.boss ? 0.72 : 0.58;
  context.fillStyle = COLORS.foam;
  const thickness = ship.boss ? 3 : 2;
  for (const direction of [-1, 1]) {
    for (let step = 0; step < 6; step++) {
      const progress = (step + 1) / 6;
      const spread = 4 + breadth * Math.sin(progress * Math.PI * 0.72) + ripple;
      const segmentWidth = Math.max(3, Math.round(7 - progress * 3));
      const segmentX = Math.round(x + direction * spread);
      const segmentY = Math.round(y + 7 + length * progress);
      context.fillRect(
        direction < 0 ? segmentX - segmentWidth : segmentX,
        segmentY,
        segmentWidth,
        thickness,
      );
      if ((step + ship.id) % 2 === 0) {
        context.fillRect(
          direction < 0 ? segmentX - 2 : segmentX,
          segmentY + thickness,
          2,
          2,
        );
      }
    }
  }
  for (let echo = 0; echo < 3; echo++) {
    const phase = modulo(time * (ship.awe > 0 ? 0.8 : 1.8) + echo / 3 + ship.id * 0.17, 1);
    context.globalAlpha = (1 - phase) * (ship.awe > 0 ? 0.12 : 0.28);
    const halfWidth = Math.round(5 + phase * breadth);
    const echoY = Math.round(y + 12 + phase * Math.max(10, length));
    const capWidth = Math.max(3, Math.round(7 - phase * 3));
    context.fillRect(
      Math.round(x - halfWidth),
      echoY,
      capWidth,
      2,
    );
    context.fillRect(
      Math.round(x + halfWidth - capWidth),
      echoY,
      capWidth,
      2,
    );
  }
  context.restore();
}

function drawCargoMark(
  context: CanvasRenderingContext2D,
  material: MaterialKind,
  x: number,
  y: number,
) {
  const colors: Record<MaterialKind, string> = {
    stone: COLORS.limestoneLight,
    timber: COLORS.timberLight,
    bronze: COLORS.bronzeLight,
    wine: COLORS.wineLight,
  };
  rect(context, x - 6, y - 6, 12, 12, colors[material], COLORS.outline, 2);
}

function drawCroppedSprite(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.drawImage(
    atlas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    snapToRenderPixel(x),
    snapToRenderPixel(y),
    snapToRenderPixel(width),
    snapToRenderPixel(height),
  );
}

function drawAnimatedShipSprite(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  sourceCol: number,
  sourceRow: number,
  time: number,
  motionSeed: number,
  x: number,
  y: number,
  actionProgress = 0,
) {
  const sourceX = sourceCol * CELL;
  const sourceY = sourceRow * CELL;
  const frame = Math.floor(modulo(time * 5 + motionSeed * 0.37, 4));
  const ping = [0, 1, 0, -1][frame];
  const rigShiftX = ping;
  const rigShiftY = ping === 0 ? 0 : -1;
  const sailBreath = Math.sin(time * 4.1 + motionSeed * 0.29) * 0.022;
  const hitKick = Math.sin(actionProgress * Math.PI * 5) * (1 - actionProgress) * 1.6;

  // Hull and waterline stay together while sail, mast, oars and deck flex above them.
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY + 24,
    CELL,
    24,
    x,
    y + 24,
    CELL,
    24,
  );
  context.save();
  context.translate(x + CELL / 2, y + 25);
  context.scale(1 + sailBreath, 1 - Math.abs(sailBreath) * 0.4);
  context.translate(-(x + CELL / 2), -(y + 25));
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY,
    CELL,
    27,
    x + rigShiftX + hitKick,
    y + rigShiftY,
    CELL,
    27,
  );
  context.restore();

  const oarStroke = Math.sin(time * 7.2 + motionSeed * 0.61);
  context.save();
  context.globalAlpha *= 0.72;
  for (const side of [-1, 1]) {
    line(
      context,
      x + CELL / 2 + side * 10,
      y + 29,
      x + CELL / 2 + side * (17 + oarStroke * 2),
      y + 38 + Math.abs(oarStroke) * 2,
      COLORS.timberLight,
      1.5,
    );
  }
  context.restore();
}

function drawCrewSprite(
  context: CanvasRenderingContext2D,
  crew: CrewKind,
  pose: "deck" | "landing",
  x: number,
  y: number,
  atlas?: HTMLImageElement | null,
  time = 0,
  motionSeed = 0,
) {
  if (!atlas) {
    context.save();
    const size = pose === "landing" ? 1.15 : 0.65;
    context.translate(x, y);
    context.scale(size, size);
    for (const offset of [-5, 5]) {
      const step = Math.round(Math.sin(time * 5 + motionSeed + offset)) * (pose === "landing" ? 1 : 0);
      line(context, offset - 4, -6, offset - 7, 6 + step, COLORS.timberLight, 1);
      rect(context, offset - 2, -4, 5, 5, COLORS.bronzeLight, COLORS.outline, 1);
      rect(context, offset - 2, 0, 4, 6, crew === "spartoi" ? "#734038" : COLORS.timber, COLORS.outline, 1);
      rect(context, offset - 2, 6 + step, 4, 2, COLORS.bronze);
      if (crew === "spartoi") {
        polygon(context, [[offset + 1, 0], [offset + 5, 1], [offset + 4, 6], [offset + 1, 8], [offset - 1, 4]],
          COLORS.bronzeDark, COLORS.bronzeLight, 1);
      }
    }
    context.restore();
    return;
  }
  const sourceCol = crew === "spartoi" ? 1 : 0;
  const sourceRow = pose === "landing" ? 1 : 0;
  const size = pose === "landing"
    ? crew === "spartoi" ? 50 : 44
    : crew === "spartoi" ? 31 : 27;
  const scale = size / 96;
  const frame = Math.floor(modulo(time * (pose === "landing" ? 7 : 4.5) + motionSeed, 4));
  const ping = [0, 1, 0, -1][frame];
  const upperShiftX = ping * (pose === "landing" ? 1.5 : 0.75);
  const upperShiftY = ping === 0 ? 0 : pose === "landing" ? -1.5 : -0.5;
  const sourceX = sourceCol * 96;
  const sourceY = sourceRow * 96;
  const destinationX = x - size / 2;
  const destinationY = y - size / 2;

  // Feet and wake remain grounded; torso, shield and weapon visibly breathe/stride.
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY + 54,
    96,
    42,
    destinationX,
    destinationY + 54 * scale,
    size,
    42 * scale,
  );
  drawCroppedSprite(
    context,
    atlas,
    sourceX,
    sourceY,
    96,
    58,
    destinationX + upperShiftX,
    destinationY + upperShiftY,
    size,
    58 * scale,
  );
}

function drawHorizontalWaveSprite(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  motionSeed: number,
  amplitude: number,
  bands: number,
) {
  for (let band = 0; band < bands; band++) {
    const sourceTop = Math.floor((band * sourceHeight) / bands);
    const sourceBottom = Math.floor(((band + 1) * sourceHeight) / bands);
    const overlap = band < bands - 1 ? 1 : 0;
    const bandSourceHeight = sourceBottom - sourceTop + overlap;
    const destinationTop = (sourceTop / sourceHeight) * height;
    const destinationHeight = (bandSourceHeight / sourceHeight) * height;
    const tailStrength = 0.3 + (band / Math.max(1, bands - 1)) * 0.7;
    const offset = snapToRenderPixel(
      Math.sin(time * 4.2 + motionSeed * 0.31 + band * 0.72) * amplitude * tailStrength,
    );
    drawCroppedSprite(
      context,
      atlas,
      sourceX,
      sourceY + sourceTop,
      sourceWidth,
      bandSourceHeight,
      x + offset,
      y + destinationTop,
      width,
      destinationHeight,
    );
  }
}

// These four illustrations are hand-packed, not four equal atlas cells.
// In particular the crab's right claw and both turtles' heads cross the grid.
const CREATURE_FRAME = {
  karkinos: [2, 33, 145, 74],
  ketos: [151, 12, 93, 97],
  turtle: [9, 110, 126, 129],
  overturned: [137, 111, 114, 126],
} as const;

type CreatureFrame = (typeof CREATURE_FRAME)[keyof typeof CREATURE_FRAME];

function drawAnimatedKarkinos(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  frame: CreatureFrame,
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  motionSeed: number,
  attackIntensity = 0,
) {
  const [sourceX, sourceY, frameWidth, frameHeight] = frame;
  const scaleX = width / frameWidth;
  const scaleY = height / frameHeight;
  const stride = Math.sin(time * (4.8 + attackIntensity * 2.4) + motionSeed * 0.41);
  const crunch = Math.max(0, Math.sin(time * 8.6 + motionSeed)) * attackIntensity;
  // Swing each claw around its shoulder. The carapace covers both seams.
  for (const side of [-1, 1]) {
    const sourceLeft = side < 0 ? 0 : 94;
    const pivotX = x + (side < 0 ? 49 : 96) * scaleX;
    const pivotY = y + 39 * scaleY;
    context.save();
    context.translate(pivotX, pivotY);
    context.rotate(side * (stride * 0.075 - crunch * 0.12));
    context.translate(-pivotX, -pivotY);
    drawCroppedSprite(context, atlas, sourceX + sourceLeft, sourceY, 51, frameHeight,
      x + sourceLeft * scaleX, y, 51 * scaleX, height);
    context.restore();
  }
  drawCroppedSprite(context, atlas, sourceX + 46, sourceY, 54, frameHeight,
    x + 46 * scaleX, y, 54 * scaleX, height);

  if (crunch > 0.62) {
    context.save();
    context.globalAlpha = (crunch - 0.62) * 2.4;
    for (const side of [-1, 1]) {
      line(
        context,
        x + width / 2 + side * width * 0.43,
        y + height * 0.28,
        x + width / 2 + side * width * 0.56,
        y + height * 0.2,
        "#fff1a7",
        2,
      );
    }
    context.restore();
  }
}

function drawAnimatedTurtle(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  frame: CreatureFrame,
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  motionSeed: number,
  attackIntensity = 0,
) {
  const [sourceX, sourceY, frameWidth, frameHeight] = frame;
  const scaleX = width / 128;
  const scaleY = height / 128;
  const part = (sx: number, sy: number, sw: number, sh: number, dy = 0) =>
    drawCroppedSprite(context, atlas, sourceX + sx * frameWidth / 128, sourceY + sy * frameHeight / 128,
      sw * frameWidth / 128, sh * frameHeight / 128, x + sx * scaleX, y + sy * scaleY + dy, sw * scaleX, sh * scaleY);
  const swim = Math.sin(time * (4.4 + attackIntensity * 1.8) + motionSeed * 0.33);
  const thrust = snapToRenderPixel(Math.sin(time * 3.2 + motionSeed * 0.27) - attackIntensity * Math.max(0, swim) * 2);
  // Paddle around the shoulder joints, then cover the joins with the solid
  // shell. Translating rectangular strips used to tear the shell into pieces.
  for (const side of [-1, 1]) {
    const sourceLeft = side < 0 ? 0 : 95;
    const pivotX = x + (side < 0 ? 30 : 98) * scaleX;
    const pivotY = y + 76 * scaleY;
    context.save();
    context.translate(pivotX, pivotY);
    context.rotate(side * swim * (0.045 + attackIntensity * 0.025));
    context.translate(-pivotX, -pivotY);
    part(sourceLeft, 0, 33, 128);
    context.restore();
  }
  part(28, 0, 72, 43, thrust);
  part(28, 38, 72, 90);
}

function drawEnemyBar(
  context: CanvasRenderingContext2D,
  ship: Ship,
  x: number,
  y: number,
  width: number,
) {
  const massWidth = ship.mass * 5 - 1;
  for (let index = 0; index < ship.mass; index++) {
    rect(
      context,
      x - massWidth / 2 + index * 5,
      y - 5,
      4,
      3,
      COLORS.bronzeLight,
      COLORS.outline,
      1,
    );
  }
  rect(context, x - width / 2, y, width, 6, "#2b2426", COLORS.outline, 1);
  rect(
    context,
    x - width / 2 + 1,
    y + 1,
    Math.max(0, (width - 2) * (ship.hp / ship.maxHp)),
    4,
    ship.hp > ship.maxHp * 0.4 ? "#73a94c" : COLORS.red,
  );
  if (ship.bossWrenched) {
    const markX = x - width / 2 - 8;
    line(context, markX - 2, y, markX, y + 2, COLORS.bronzeLight, 2);
    line(context, markX + 2, y + 4, markX + 4, y + 6, COLORS.bronzeLight, 2);
    line(context, markX - 1, y + 6, markX + 3, y, COLORS.red, 1);
  }

  if (ship.maxPlates) {
    const pipWidth = 7;
    const totalWidth = ship.maxPlates * pipWidth - 2;
    for (let index = 0; index < ship.maxPlates; index++) {
      rect(
        context,
        x - totalWidth / 2 + index * pipWidth,
        y + 8,
        5,
        4,
        index < (ship.plates ?? 0) ? COLORS.bronzeLight : "#4d4d4c",
        COLORS.outline,
        1,
      );
    }
  }
}

function drawArticulatedSkolopendra(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  pose: SkolopendraPose,
  x: number,
  y: number,
  time: number,
  motionSeed: number,
  activeEffect?: Effect,
  deathProgress = 0,
  attackIntensity = 0,
) {
  // Keep the same living model through wine and grapple transitions; the
  // separately illustrated curled poses used to make the head teleport.
  const atlasPose = SKOLOPENDRA_POSE[pose === "defeated" ? "defeated" : "swim"];
  const sourceX = atlasPose.col * 96;
  const sourceY = atlasPose.row * 144;
  const actionProgress = activeEffect ? effectProgress(activeEffect) : 0;
  const impactImpulse = activeEffect?.kind === "impact"
    ? Math.sin(actionProgress * Math.PI * 5) * (1 - actionProgress)
    : 0;
  const speed = 3.25;
  const amplitude = pose === "awed"
    ? 2.1
    : pose === "grappled"
      ? 1.2
      : pose === "defeated"
        ? 2.8 * (1 - deathProgress)
        : 3.5;
  const phase = time * speed + motionSeed * 0.31;
  const tailPhase = phase - 4.4;
  const tailOffset = Math.sin(tailPhase) * amplitude;

  // A long creature needs a wake along its body, not the single wake used by
  // ships. These ripples follow the tail's traveling wave and collapse under wine.
  context.save();
  context.globalAlpha *= pose === "awed" ? 0.3 : 0.58;
  context.fillStyle = COLORS.foam;
  for (let ripple = 0; ripple < 3; ripple++) {
    const rippleY = y + 92 + ripple * 15 + deathProgress * (6 + ripple * 3);
    const spread = 13 + ripple * 7 + deathProgress * 15;
    const centerX = Math.round(snapToRenderPixel(x + 48 + tailOffset * 0.7));
    const foamY = Math.round(snapToRenderPixel(rippleY));
    const capWidth = 5 + ripple * 2;
    const thickness = pose === "defeated" ? 3 : 2;
    context.fillRect(
      Math.round(centerX - spread),
      foamY,
      capWidth,
      thickness,
    );
    context.fillRect(
      Math.round(centerX + spread - capWidth),
      foamY,
      capWidth,
      thickness,
    );
    context.fillRect(centerX - 2, foamY + 3 + ripple, 4, 2);
  }
  context.restore();

  context.save();
  if (pose === "defeated") {
    context.translate(x + 48, y + 70);
    context.rotate(deathProgress * 0.075);
    context.translate(-(x + 48), -(y + 70));
  }

  // Paint the tail first so every overlap terminates beneath the next
  // harborward band and the head remains visually dominant.
  for (let bandIndex = SKOLOPENDRA_BANDS.length - 1; bandIndex >= 0; bandIndex--) {
    const [sourceTop, sourceBottom] = SKOLOPENDRA_BANDS[bandIndex];
    const bodyPosition = ((sourceTop + sourceBottom) / 2) / 144;
    const tailStrength = 0.2 + bodyPosition * 0.8;
    const wave = Math.sin(phase - bodyPosition * 4.4) * amplitude * tailStrength;
    const verticalWave = Math.cos(phase - bodyPosition * 3.2) * 0.65 * tailStrength;
    const staggerLean = pose === "awed"
      ? Math.sin(time * 1.25 + motionSeed) * (1.5 - bodyPosition * 2.2)
      : 0;
    const hitKick = impactImpulse * (1 - bodyPosition * 1.7) * 6;
    const deathCurl = pose === "defeated"
      ? Math.sin(bodyPosition * Math.PI) * deathProgress * 8
      : 0;
    const deathSink = pose === "defeated"
      ? Math.pow(deathProgress, 1.55) * (4 + bodyPosition * 16)
      : 0;
    const headFlare = bandIndex === 0
      ? attackIntensity * (1.5 + (Math.sin(time * 8 + motionSeed) + 1) * 1.4)
      : 0;
    const headLunge = bandIndex === 0
      ? -attackIntensity * (2 + Math.max(0, Math.sin(time * 8 + motionSeed)) * 4)
      : 0;
    const destinationX = snapToRenderPixel(
      x + wave + staggerLean + hitKick + deathCurl - headFlare,
    );
    const destinationY = snapToRenderPixel(
      y + sourceTop + verticalWave + deathSink + headLunge,
    );
    const deathBlend = pose === "defeated" ? easeOutCubic(clamp01(deathProgress / 0.32)) : 1;
    if (deathBlend < 1) {
      context.save();
      context.globalAlpha *= 1 - deathBlend;
      drawCroppedSprite(context, atlas, 0, sourceTop, 96, sourceBottom - sourceTop,
        destinationX, destinationY, 96 + headFlare * 2, sourceBottom - sourceTop);
      context.restore();
    }
    context.save();
    context.globalAlpha *= deathBlend;
    drawCroppedSprite(context, atlas, sourceX, sourceY + sourceTop, 96, sourceBottom - sourceTop,
      destinationX, destinationY, 96 + headFlare * 2, sourceBottom - sourceTop);
    context.restore();
  }
  context.restore();

  if (Math.abs(impactImpulse) > 0.08) {
    context.save();
    context.globalAlpha = Math.min(0.9, Math.abs(impactImpulse));
    for (const direction of [-1, 1]) {
      line(
        context,
        x + 48 + direction * 22,
        y + 28,
        x + 48 + direction * (31 + Math.abs(impactImpulse) * 6),
        y + 22 - impactImpulse * 4,
        "#fff0b4",
        2,
      );
    }
    context.restore();
  }
}

function drawSkolopendra(
  context: CanvasRenderingContext2D,
  ship: Ship,
  time: number,
  renderY: number,
  atlas?: HTMLImageElement | null,
  activeEffect?: Effect,
  showStatus = true,
) {
  const { x, y } = shipScreenPosition(ship, renderY);
  if (atlas) {
    const pose: SkolopendraPose =
      activeEffect?.kind === "claw" || (ship.grappled ?? 0) > 0
        ? "grappled"
        : ship.awe > 0
          ? "awed"
          : "swim";
    drawArticulatedSkolopendra(
      context,
      atlas,
      pose,
      x - 48,
      y - 24,
      time,
      ship.id,
      activeEffect,
      0,
      clamp01((0.9 - renderY) / 0.9),
    );
  } else {
    const sway = Math.sin(time * 2.7 + ship.id) * 2.2;
    for (let segment = 0; segment < 4; segment++) {
      const segmentY = y + segment * 28;
      polygon(
        context,
        [
          [x - 17 + sway, segmentY - 14],
          [x + 17 + sway, segmentY - 14],
          [x + 14 - sway, segmentY + 16],
          [x - 14 - sway, segmentY + 16],
        ],
        segment === 0 ? COLORS.oxblood : COLORS.limestoneLight,
      );
      line(context, x - 13, segmentY, x - 27, segmentY + 8, COLORS.wine, 4);
      line(context, x + 13, segmentY, x + 27, segmentY + 8, COLORS.wine, 4);
    }
  }
  if (!showStatus) return;
  drawEnemyBar(context, ship, x, Math.max(GRID_Y + 3, y - 35), 58);
  if (ship.awe > 0) pixelText(context, "WINE", x, y - 48, 9, COLORS.gold);
}

function drawSeaCreature(
  context: CanvasRenderingContext2D,
  ship: Ship,
  time: number,
  renderY: number,
  atlas?: HTMLImageElement | null,
  activeEffect?: Effect,
  showStatus = true,
) {
  const { x, y } = shipScreenPosition(ship, renderY);
  const bob = Math.sin(time * 3.3 + ship.id * 0.7) * 1.4;
  const attackIntensity = clamp01((0.85 - renderY) / 0.85);
  const creature = ship.creature as Exclude<CreatureKind, "skolopendra">;
  let width = 76;
  let height = 39;
  if (creature === "ketos") {
    width = 53;
    height = 56;
  }
  if (creature === "sciron-turtle") {
    width = 88;
    height = 110;
  }

  if (atlas) {
    const destinationX = x - width / 2;
    const destinationY = y - (creature === "sciron-turtle" ? 22 : height / 2) + bob;
    if (creature === "karkinos") {
      drawAnimatedKarkinos(
        context,
        atlas,
        CREATURE_FRAME.karkinos,
        destinationX,
        destinationY,
        width,
        height,
        time,
        ship.id,
        attackIntensity,
      );
    } else if (creature === "ketos") {
      drawHorizontalWaveSprite(
        context,
        atlas,
        ...CREATURE_FRAME.ketos,
        destinationX,
        destinationY,
        width,
        height,
        time,
        ship.id,
        1.2 + attackIntensity * 0.7,
        16,
      );
    } else {
      let turnBlend = 0;
      if (activeEffect?.armOutcome === "overturn") {
        const pose = armActionPose(effectProgress(activeEffect));
        turnBlend = clamp01(pose.haul * (1 - pose.retract) * 1.35);
      }
      context.save();
      context.globalAlpha *= 1 - turnBlend;
      drawAnimatedTurtle(
        context,
        atlas,
        CREATURE_FRAME.turtle,
        destinationX,
        destinationY,
        width,
        height,
        time,
        ship.id,
        attackIntensity,
      );
      context.restore();
      if (turnBlend > 0) {
        context.save();
        context.globalAlpha *= turnBlend;
        drawAnimatedTurtle(
          context,
          atlas,
          CREATURE_FRAME.overturned,
          destinationX,
          destinationY,
          width,
          height,
          time,
          ship.id,
          attackIntensity,
        );
        context.restore();
      }
    }
  } else if (creature === "karkinos") {
    polygon(context, [[x, y - 16], [x + 20, y], [x, y + 16], [x - 20, y]], COLORS.oxblood);
    line(context, x - 16, y, x - 31, y - 11, COLORS.wine, 7);
    line(context, x + 16, y, x + 31, y - 11, COLORS.wine, 7);
  } else if (creature === "ketos") {
    polygon(context, [[x, y - 24], [x + 15, y - 7], [x + 8, y + 24], [x - 12, y + 18], [x - 15, y - 7]], "#386d6c");
  } else {
    context.fillStyle = "#315d4f";
    context.strokeStyle = COLORS.outline;
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(x, y + 28, 34, 48, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  if (!showStatus) return;
  const barY = creature === "sciron-turtle" ? Math.max(GRID_Y + 3, y - 35) : y + 33;
  drawEnemyBar(context, ship, x, barY, creature === "sciron-turtle" ? 58 : 36);
  if (ship.awe > 0) pixelText(context, "!", x, y - 35, 13, COLORS.gold);
  if (!ship.boss && ship.shield > 0 && ship.awe <= 0) {
    pixelText(context, `${ship.shield}`, x - 18, y - 21, 8, COLORS.bronzeLight);
  }
  const strikeBeat = Math.max(0, Math.sin(time * 8 + ship.id * 0.31)) * attackIntensity;
  if (strikeBeat > 0.58) {
    context.save();
    context.globalAlpha = (strikeBeat - 0.58) * 1.9;
    line(context, x - 20, y - 18, x - 31, y - 27, "#fff1a7", 2);
    line(context, x + 20, y - 18, x + 31, y - 27, "#fff1a7", 2);
    context.restore();
  }
}

function drawAegisStandard(context: CanvasRenderingContext2D, x: number, y: number, time: number, id: number) {
  const hem = Math.round(Math.sin(time * 5 + id) * 1.6);
  line(context, x - 2, y - 23, x - 2, y - 8, "#382833", 3);
  line(context, x - 2, y - 23, x - 2, y - 8, "#f3c97b", 1);
  polygon(context, [[x - 1, y - 22], [x + 7, y - 22 + hem], [x + 13, y - 20 + hem],
    [x + 9, y - 17 + hem], [x + 12, y - 15 + hem], [x - 1, y - 16]], "#377f79", COLORS.outline, 1);
  line(context, x, y - 21, x + 7, y - 21 + hem, "#e0ce9c", 1);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 2; row++) {
      const sx = x + side * (15 - row * 3);
      const sy = y + 3 + row * 6;
      polygon(context, [[sx - 3, sy - 3], [sx + 2, sy - 3], [sx + 4, sy - 1],
        [sx + 3, sy + 2], [sx, sy + 4], [sx - 3, sy + 2]], "#d29e4e", COLORS.outline, 1);
      rect(context, sx - 1, sy - 2, 2, 4, "#30635e");
    }
  }
}

function drawShip(
  context: CanvasRenderingContext2D,
  ship: Ship,
  time: number,
  atlases: SpriteAtlases,
  renderY: number,
  activeEffect?: Effect,
  showStatus = true,
) {
  if (ship.creature === "skolopendra") {
    drawSkolopendra(context, ship, time, renderY, atlases.skolopendra, activeEffect, showStatus);
    return;
  }
  if (ship.creature) {
    drawSeaCreature(context, ship, time, renderY, atlases.creatures, activeEffect, showStatus);
    return;
  }

  const atlas = atlases.fleet;
  const { x, y } = shipScreenPosition(ship, renderY);
  const bob = Math.sin(time * 4 + ship.id * 0.83) * 1.4;
  const shipY = y + bob;
  const isLarge = ship.mass > 1;
  const width = isLarge ? 32 : 25;
  const height = isLarge ? 42 : 34;
  const damaged = ship.hp < ship.maxHp * 0.45;

  if (atlas) {
    let sourceCol = 0;
    let sourceRow = 0;
    if (ship.boss) {
      sourceCol = 0;
      sourceRow = 1;
    } else if (ship.screening) sourceCol = 2;
    else if (ship.command) sourceCol = 4;
    else if (ship.name.includes("Laden")) sourceCol = 3;
    else if (ship.name.includes("Shield")) sourceCol = 2;
    else if (ship.name.includes("Raider")) sourceCol = 1;

    const roll = Math.sin(time * 2.4 + ship.id * 1.17) * 0.018;
    context.save();
    context.translate(x, shipY);
    context.rotate(roll);
    drawAnimatedShipSprite(
      context,
      atlas,
      sourceCol,
      sourceRow,
      time,
      ship.id,
      -24,
      -24,
      activeEffect ? effectProgress(activeEffect) : 0,
    );
    // Damage belongs to this hull: never replace a shielded or laden ship
    // with the atlas's unrelated red-sail wreck.
    if (damaged) {
      line(context, -12, 8, -6, 12, "#241c1b", 2);
      line(context, 7, 10, 13, 7, "#241c1b", 2);
      for (let ember = 0; ember < 3; ember++) {
        const drift = modulo(time * 0.75 + ship.id * 0.17 + ember / 3, 1);
        context.save();
        context.globalAlpha *= (1 - drift) * 0.6;
        rect(context, -10 + ember * 7 + Math.sin(drift * 4) * 2, 3 - drift * 15, 2, 2, "#a39484");
        context.restore();
      }
    }
    if (ship.crew) {
      drawCrewSprite(context, ship.crew, "deck", 0, -2, atlases.crew, time, ship.id);
    }
    if (ship.screening) drawAegisStandard(context, 0, 0, time, ship.id);
    if (ship.cargo) drawCargoMark(context, ship.cargo, 12, 14);
    context.restore();
    if (ship.awe > 0) pixelText(context, "!", x, shipY - 27, 14, COLORS.gold);
    if (ship.shield > 0 && ship.awe <= 0) {
      pixelText(context, `${ship.shield}`, x - 17, shipY - 19, 8, COLORS.bronzeLight);
    }
    const atlasBarWidth = 34;
    const massWidth = ship.mass * 5 - 1;
    for (let index = 0; index < ship.mass; index++) {
      rect(
        context,
        x - massWidth / 2 + index * 5,
        shipY + 19,
        4,
        3,
        COLORS.bronzeLight,
        COLORS.outline,
        1,
      );
    }
    rect(context, x - atlasBarWidth / 2, shipY + 24, atlasBarWidth, 5, "#2b2426", COLORS.outline, 1);
    rect(
      context,
      x - atlasBarWidth / 2 + 1,
      shipY + 25,
      Math.max(0, (atlasBarWidth - 2) * (ship.hp / ship.maxHp)),
      3,
      ship.hp > ship.maxHp * 0.4 ? "#73a94c" : COLORS.red,
    );
    return;
  }

  polygon(
    context,
    [
      [x, shipY - height / 2],
      [x + width / 2, shipY - height / 4],
      [x + width / 2 - 4, shipY + height / 2],
      [x - width / 2 + 4, shipY + height / 2],
      [x - width / 2, shipY - height / 4],
    ],
    damaged ? "#3c3031" : "#29252a",
    "#17151a",
    2,
  );
  rect(context, x - width / 2 + 4, shipY - 6, width - 8, 5, "#835031");
  line(context, x, shipY + 12, x, shipY - 22, COLORS.outline, 3);

  if (ship.mass > 1 || ship.command || ship.boss) {
    polygon(
      context,
      [[x + 1, shipY - 20], [x + 14, shipY - 13], [x + 1, shipY - 4]],
      ship.command || ship.boss ? COLORS.oxblood : "#c58b54",
      COLORS.outline,
      1,
    );
  }

  if (ship.crew) {
    drawCrewSprite(context, ship.crew, "deck", x, shipY - 2, atlases.crew, time, ship.id);
  }

  if (ship.shield > 0 && ship.awe <= 0) {
    for (let offset = -9; offset <= 9; offset += 6) {
      context.fillStyle = COLORS.bronzeLight;
      context.strokeStyle = COLORS.outline;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x + offset, shipY + 7, 3, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  if (ship.screening) drawAegisStandard(context, x, shipY, time, ship.id);
  if (ship.cargo) drawCargoMark(context, ship.cargo, x, shipY + 19);
  if (ship.command) rect(context, x - 3, shipY - 30, 6, 6, COLORS.gold, COLORS.outline, 1);
  if (ship.boss) {
    line(context, x - 12, shipY + 10, x + 17, shipY - 28, COLORS.timberLight, 4);
    rect(context, x + 11, shipY - 30, 9, 10, COLORS.limestoneLight, COLORS.outline, 2);
  }
  if (ship.awe > 0) {
    pixelText(context, "!", x, shipY - height / 2 - 8, 14, COLORS.gold);
  }

  const barWidth = 34;
  const massWidth = ship.mass * 5 - 1;
  for (let index = 0; index < ship.mass; index++) {
    rect(
      context,
      x - massWidth / 2 + index * 5,
      shipY + height / 2,
      4,
      3,
      COLORS.bronzeLight,
      COLORS.outline,
      1,
    );
  }
  rect(context, x - barWidth / 2, shipY + height / 2 + 4, barWidth, 5, "#2b2426", COLORS.outline, 1);
  rect(context, x - barWidth / 2 + 1, shipY + height / 2 + 5, Math.max(0, (barWidth - 2) * (ship.hp / ship.maxHp)), 3, ship.hp > ship.maxHp * 0.4 ? "#73a94c" : COLORS.red);
}

export function effectPosition(effect: Effect, state?: GameState): { waterX: number; waterY: number } {
  const channel = effect.channel ?? 0;
  const target = effect.targetId === undefined
    ? undefined
    : state?.ships.find((ship) => ship.id === effect.targetId);
  let waterX = target ? shipScreenPosition(target).x : GRID_X + WATER_COLS[channel] * CELL + CELL / 2;
  const anchorY = effect.kind === "claw"
    ? effect.contactY ?? effect.grabY ?? effect.toY ?? target?.y ?? 0
    : target ? target.y + (effect.targetOffsetY ?? 0) : effect.toY ?? 0;
  let waterY = GRID_Y + anchorY * CELL + CELL / 2;
  const grapple = target && effect.kind !== "claw" && state?.effects.find(candidate =>
    candidate.kind === "claw" && candidate.targetId === target.id && candidate.ttl > 0);
  if (grapple && target) {
    const motion = armEffectGeometry(grapple, effectProgress(grapple), state);
    const baseY = GRID_Y + ((grapple.grabY ?? target.y) + (effect.targetOffsetY ?? 0)) * CELL + CELL / 2;
    const localX = waterX - motion.contactX;
    const localY = baseY - motion.contactScreenY;
    waterX = motion.contactX + localX * Math.cos(motion.victimRoll) - localY * Math.sin(motion.victimRoll) + motion.victimX;
    waterY = motion.contactScreenY + localX * Math.sin(motion.victimRoll) + localY * Math.cos(motion.victimRoll) + motion.victimY;
  }
  return { waterX, waterY };
}

export function armEffectGeometry(effect: Effect, progress: number, state?: GameState) {
  const fromRow = effect.fromRow ?? 0;
  const fromCol = effect.fromCol ?? 1;
  const cellX = GRID_X + fromCol * CELL;
  const cellY = GRID_Y + fromRow * CELL;
  const sourcePiece = state?.board[fromRow]?.[fromCol];
  const target = effect.targetId === undefined
    ? undefined
    : state?.ships.find((ship) => ship.id === effect.targetId);
  const tier = effect.armTier ?? (
    sourcePiece?.kind === "machine" && sourcePiece.machine === "arm"
      ? sourcePiece.tier
      : 1
  );
  const rig = armRigGeometry(
    cellX,
    cellY,
    effect.armFacesRight ?? armFacesRight(fromCol),
    tier,
    progress,
  );
  const pose = armActionPose(progress);
  const { waterX, waterY } = effectPosition(effect, state);
  const grabY = effect.grabY ?? effect.toY ?? 0;
  const haulY = effect.haulY ?? effect.toY ?? grabY;
  const longitudinal = (haulY - grabY) * CELL * pose.haul;
  const towardSource = Math.sign(rig.pivotX - waterX) || -rig.direction;
  const capture = effect.armOutcome === "capture";
  const overturn = effect.armOutcome === "overturn";
  const attached = pose.haul * (
    capture ? 1 : overturn ? 1 - pose.retract : 1 - pose.release
  );
  const sideDistance = capture ? 23 : overturn ? 18 : 11;
  const liftDistance = capture ? 15 : overturn ? 18 : 8;
  const victimX = towardSource * sideDistance * attached;
  const victimY = longitudinal - liftDistance * attached;
  const rollAmount = overturn ? 1.02 : capture ? 0.2 : 0.11;
  const victimRoll = towardSource * rollAmount * attached;
  const targetX = waterX + victimX;
  const targetY = waterY + victimY;
  const extendedX = rig.parkedHookX + (targetX - rig.parkedHookX) * pose.cast;
  const extendedY = rig.parkedHookY + (targetY - rig.parkedHookY) * pose.cast;
  const hookX = extendedX + (rig.parkedHookX - extendedX) * pose.retract;
  const hookY = extendedY + (rig.parkedHookY - extendedY) * pose.retract;

  return {
    ...pose,
    ...rig,
    hookX,
    hookY,
    targetX,
    targetY,
    contactX: waterX,
    contactScreenY: waterY,
    victimX,
    victimY,
    victimRoll,
    victimAlpha: capture || (target?.resolved && !overturn)
      ? Math.max(0.08, 1 - pose.release * 0.92)
      : 1,
    hookClosed: pose.clamp * (1 - pose.release),
  };
}

function drawArmClawEffect(
  context: CanvasRenderingContext2D,
  effect: Effect,
  progress: number,
  atlases: SpriteAtlases,
  state?: GameState,
) {
  const motion = armEffectGeometry(effect, progress, state);
  const alpha = 1;
  context.save();
  context.globalAlpha = alpha;
  line(
    context,
    motion.tipX,
    motion.tipY,
    motion.hookX,
    motion.hookY,
    COLORS.outline,
    3,
  );
  line(
    context,
    motion.tipX,
    motion.tipY,
    motion.hookX,
    motion.hookY,
    "#746957",
    1,
  );

  if (motion.clamp > 0 && motion.retract < 0.1) {
    const splash = Math.sin(Math.min(1, motion.clamp) * Math.PI) * 13;
    context.globalAlpha = alpha * (1 - motion.release);
    line(
      context,
      motion.targetX - splash,
      motion.targetY + 10,
      motion.targetX + splash,
      motion.targetY + 10,
      COLORS.foam,
      2,
    );
    context.globalAlpha = alpha;
  }

  context.translate(motion.hookX, motion.hookY);
  context.rotate(motion.victimRoll * 0.28);
  context.scale(1 - motion.hookClosed * 0.24, 1);
  if (atlases.fleet) {
    const hookSize = 14 + motion.cast * (1 - motion.retract) * 14;
    drawAtlasCell(context, atlases.fleet, 3, 3, -hookSize / 2, -hookSize * 0.58, hookSize, hookSize);
  } else {
    line(context, 0, -9, 0, 7, COLORS.bronzeDark, 3);
    line(context, 0, 6, -7 + motion.hookClosed * 3, 12, COLORS.outline, 3);
    line(context, 0, 6, 7 - motion.hookClosed * 3, 12, COLORS.outline, 3);
  }
  context.restore();

  if (effect.label && motion.clamp > 0.45 && motion.retract < 0.35) {
    pixelText(
      context,
      effect.label,
      motion.targetX,
      motion.targetY - 31,
      10,
      COLORS.gold,
    );
  }
}

function drawEffect(
  context: CanvasRenderingContext2D,
  effect: Effect,
  atlases: SpriteAtlases,
  time: number,
  state?: GameState,
) {
  const elapsed = effect.total - effect.ttl;
  const delay = effect.delay ?? 0;
  if (elapsed < delay) return;
  const visibleDuration = Math.max(0.001, effect.total - delay);
  const progress = clamp01((elapsed - delay) / visibleDuration);
  const remaining = visibleDuration * (1 - progress);
  const { waterX, waterY } = effectPosition(effect, state);
  if (effect.kind === "fire" && effect.fromRow !== undefined && effect.fromCol !== undefined) {
    const fromX = GRID_X + effect.fromCol * CELL + (armFacesRight(effect.fromCol) ? CELL - 8 : 8);
    const fromY = GRID_Y + effect.fromRow * CELL + 12;
    const reach = easeOutCubic(clamp01(progress / 0.72));
    const tail = Math.max(0, (progress - 0.38) / 0.62);
    context.save();
    context.globalAlpha *= Math.min(1, (1 - progress) * 4);
    for (let segment = 0; segment < 13; segment++) {
      const t = tail + (reach - tail) * segment / 12;
      const heat = Math.sin(t * Math.PI);
      const scatter = Math.sin(segment * 1.8 + time * 17 + effect.id) * heat * 2.5;
      const x = fromX + (waterX - fromX) * t + scatter;
      const y = fromY + (waterY - fromY) * t - heat * 8;
      const size = 2 + Math.round(heat * 3);
      rect(context, x - size / 2, y - size / 2, size, size, "#c04b28");
      rect(context, x - 1, y - 1, 2, 2, segment % 3 ? "#ffc355" : "#ffed9d");
    }
    context.restore();
    return;
  }
  if (effect.kind === "claw") {
    drawArmClawEffect(context, effect, progress, atlases, state);
    return;
  }
  if (effect.kind === "monsterFall") {
    context.save();
    context.globalAlpha = effect.creature === "skolopendra"
      ? 1 - easeOutCubic(clamp01((progress - 0.58) / 0.42))
      : Math.max(0, 1 - progress * 0.82);
    if (effect.armOutcome === "overturn") {
      const sourceX = GRID_X + (effect.fromCol ?? 1) * CELL + CELL / 2;
      const turnDirection = Math.sign(sourceX - waterX) || -1;
      const pivotY = GRID_Y + (effect.contactY ?? effect.toY ?? 0) * CELL + CELL / 2;
      const handoff = 1 - easeOutCubic(clamp01(progress / 0.38));
      context.translate(turnDirection * 18 * handoff, -18 * handoff);
      context.translate(waterX, pivotY);
      context.rotate(turnDirection * (1.02 + easeOutCubic(progress) * 0.16));
      context.translate(-waterX, -pivotY);
    }
    const sink = progress * 14;
    if (effect.creature === "skolopendra" && atlases.skolopendra) {
      drawArticulatedSkolopendra(
        context,
        atlases.skolopendra,
        "defeated",
        waterX - 48,
        waterY - 24,
        time,
        effect.targetId ?? effect.id,
        effect,
        progress,
      );
    } else if (effect.creature === "sciron-turtle" && atlases.creatures) {
      const turn = easeOutCubic(clamp01(progress / 0.32));
      for (const [sourceCol, alpha] of [[0, 1 - turn], [1, turn]]) {
        if (alpha <= 0) continue;
        context.save();
        context.globalAlpha *= alpha;
        const [sx, sy, sw, sh] = sourceCol ? CREATURE_FRAME.overturned : CREATURE_FRAME.turtle;
        drawCroppedSprite(context, atlases.creatures, sx, sy, sw, sh, waterX - 44, waterY - 22 + sink, 88, 110);
        context.restore();
      }
    } else {
      context.strokeStyle = COLORS.foam;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(waterX, waterY + sink, 18 + progress * 24, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    if (effect.label) pixelText(context, effect.label, waterX, waterY - 38, 10, COLORS.gold);
    return;
  }

  if (effect.kind === "landing" && effect.creature && state) {
    const attacker = state.ships.find(ship => ship.id === effect.targetId);
    if (attacker) {
      context.save();
      context.globalAlpha *= 1 - easeOutCubic(clamp01((progress - 0.45) / 0.55));
      const lunge = -0.02 - Math.sin(progress * Math.PI) * 0.16;
      drawShip(context, attacker, time, atlases, lunge, undefined, false);
      context.restore();
      if (effect.label) pixelText(context, effect.label, waterX, GRID_Y + 12, 14, COLORS.red);
      return;
    }
  }

  const atlas = atlases.fleet;
  if (atlas) {
    context.save();
    context.globalAlpha = Math.min(1, remaining / Math.min(0.25, visibleDuration));
    if (effect.kind === "stone" && effect.fromRow !== undefined && effect.fromCol !== undefined) {
      const startX = GRID_X + effect.fromCol * CELL + CELL / 2;
      const startY = GRID_Y + effect.fromRow * CELL + CELL / 2;
      const x = startX + (waterX - startX) * progress;
      const y = startY + (waterY - startY) * progress - Math.sin(progress * Math.PI) * 24;
      context.save();
      context.globalAlpha *= 0.34;
      line(context, x - (waterX - startX) * 0.08, y - (waterY - startY) * 0.08, x, y, "#fff0b4", 3);
      context.restore();
      context.save();
      context.translate(x, y);
      context.rotate(progress * Math.PI * 5);
      drawAtlasCell(context, atlas, 0, 3, -12, -12, 24, 24);
      context.restore();
    }
    if (effect.kind === "impact") {
      const burstScale = 0.35 + Math.sin(progress * Math.PI) * 0.9;
      context.save();
      context.translate(waterX, waterY);
      context.scale(burstScale, burstScale);
      drawAtlasCell(context, atlas, 1, 3, -21, -21, 42, 42);
      context.restore();
      if (effect.label) pixelText(context, effect.label, waterX + 16, waterY - 14 - progress * 10, 10, "#fff0b4");
    }
    if (effect.kind === "awe") {
      drawAtlasCell(context, atlas, 2, 3, waterX - 24, waterY - 24);
      if (effect.label) pixelText(context, effect.label, waterX, waterY - 25, 9, COLORS.gold);
    }
    if (effect.kind === "landing") {
      drawAtlasCell(context, atlas, 4, 3, waterX - 20, GRID_Y - 2, 40, 40);
      if (effect.crew) {
        const arrivalScale = 0.88 + Math.sin(progress * Math.PI) * 0.14;
        context.save();
        context.translate(waterX, GRID_Y + 16 - Math.sin(progress * Math.PI) * 5);
        context.scale(arrivalScale, arrivalScale);
        drawCrewSprite(context, effect.crew, "landing", 0, 0, atlases.crew, time, effect.id);
        context.restore();
      }
      if (effect.label) pixelText(context, effect.label, waterX, GRID_Y - 13 - progress * 8, 14, "#ff8a68");
    }
    context.restore();
    return;
  }
  if (effect.kind === "stone" && effect.fromRow !== undefined && effect.fromCol !== undefined) {
    const startX = GRID_X + effect.fromCol * CELL + CELL / 2;
    const startY = GRID_Y + effect.fromRow * CELL + CELL / 2;
    const x = startX + (waterX - startX) * progress;
    const y = startY + (waterY - startY) * progress - Math.sin(progress * Math.PI) * 24;
    context.fillStyle = COLORS.limestoneLight;
    context.strokeStyle = COLORS.outline;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(Math.round(x), Math.round(y), 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  if (effect.kind === "impact") {
    const radius = 4 + Math.floor(progress * 14);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      rect(context, waterX + dx * radius - 2, waterY + dy * radius - 2, 5, 5, COLORS.foam);
    }
    if (effect.label) pixelText(context, effect.label, waterX + 16, waterY - 14 - progress * 10, 10, "#fff0b4");
  }
  if (effect.kind === "awe") {
    context.strokeStyle = progress < 0.5 ? COLORS.wineLight : COLORS.gold;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(waterX, waterY, 8 + progress * 18, 0, Math.PI * 2);
    context.stroke();
    if (effect.label) pixelText(context, effect.label, waterX, waterY - 25, 9, COLORS.gold);
  }
  if (effect.kind === "landing") {
    if (effect.crew) {
      const arrivalScale = 0.88 + Math.sin(progress * Math.PI) * 0.14;
      context.save();
      context.translate(waterX, GRID_Y + 16 - Math.sin(progress * Math.PI) * 5);
      context.scale(arrivalScale, arrivalScale);
      drawCrewSprite(context, effect.crew, "landing", 0, 0, atlases.crew, time, effect.id);
      context.restore();
    }
    if (effect.label) pixelText(context, effect.label, waterX, GRID_Y - 13 - progress * 8, 14, "#ff8a68");
  }
}

function drawFloatingCargo(
  context: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  fleetAtlas?: HTMLImageElement | null,
  resourceAtlas?: HTMLImageElement | null,
) {
  for (const cargo of state.cargo) {
    const x = GRID_X + WATER_COLS[cargo.channel] * CELL + 4;
    const y = GRID_Y + cargo.row * CELL + 4 + Math.sin(time * 3.6 + cargo.id) * 1.7;
    if (fleetAtlas) {
      drawAtlasCell(context, fleetAtlas, 4, 2, x - 4, y - 4);
      if (resourceAtlas) {
        drawResourceAtlasCell(
          context,
          resourceAtlas,
          cargo.material,
          x + 7,
          y + 4,
          29,
          29,
        );
      } else {
        context.save();
        context.translate(x + 9, y + 6);
        context.scale(0.55, 0.55);
        drawMaterial(context, cargo.material, 0, 0, null, time, cargo.id);
        context.restore();
      }
    } else {
      rect(context, x, y, 40, 40, "#173d66", COLORS.foam, 2);
      context.save();
      context.translate(x + 7, y + 4);
      context.scale(0.62, 0.62);
      drawMaterial(context, cargo.material, 0, 0, resourceAtlas, time, cargo.id);
      context.restore();
    }
    if (state.selection?.kind === "cargo" && state.selection.id === cargo.id) {
      context.strokeStyle = COLORS.gold;
      context.lineWidth = 3;
      context.strokeRect(x - 2, y - 2, 44, 44);
    }
  }
}

function activeBoardMotion(motion: BoardMotion | null, time: number) {
  if (!motion) return null;
  const elapsed = time - motion.startedAt;
  return elapsed >= 0 && elapsed < motion.duration ? { motion, elapsed } : null;
}

function drawLegalTarget(
  context: CanvasRenderingContext2D,
  row: number,
  col: number,
  time: number,
  compatible: boolean,
) {
  const x = GRID_X + col * CELL;
  const y = GRID_Y + row * CELL;
  const pulse = 0.62 + Math.sin(time * 8 + row + col) * 0.18;
  context.save();
  context.globalAlpha = compatible ? 0.18 + pulse * 0.14 : pulse;
  if (compatible) {
    context.fillStyle = COLORS.gold;
    context.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
    context.globalAlpha = pulse;
    context.strokeStyle = "#fff1a7";
    context.lineWidth = 3;
    context.strokeRect(x + 5, y + 5, CELL - 10, CELL - 10);
    for (const [sparkX, sparkY] of [[8, 8], [38, 9], [9, 38], [39, 37]]) {
      rect(context, x + sparkX, y + sparkY, 3, 3, "#fff8d8");
    }
  } else {
    context.strokeStyle = COLORS.gold;
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.lineDashOffset = -Math.floor(time * 10);
    context.strokeRect(x + 6, y + 6, CELL - 12, CELL - 12);
  }
  context.restore();
}

function drawMergeBurst(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  progress: number,
) {
  const bounded = clamp01(progress);
  const alpha = 1 - bounded;
  const radius = 5 + easeOutCubic(bounded) * 20;
  const colors = ["#fff8d8", COLORS.gold, COLORS.wineLight, COLORS.bronzeLight];
  context.save();
  context.globalAlpha = alpha;
  for (let index = 0; index < 8; index++) {
    const angle = (Math.PI * 2 * index) / 8 + Math.PI / 8;
    const particleX = centerX + Math.cos(angle) * radius;
    const particleY = centerY + Math.sin(angle) * radius * 0.72;
    const size = index % 2 === 0 ? 4 : 3;
    rect(
      context,
      particleX - size / 2,
      particleY - size / 2,
      size,
      size,
      colors[index % colors.length],
    );
  }
  context.strokeStyle = "#fff1a7";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(centerX, centerY - radius * 0.48);
  context.lineTo(centerX + radius * 0.62, centerY);
  context.lineTo(centerX, centerY + radius * 0.48);
  context.lineTo(centerX - radius * 0.62, centerY);
  context.closePath();
  context.stroke();
  context.restore();
}

function drawBoardMotion(
  context: CanvasRenderingContext2D,
  active: { motion: BoardMotion; elapsed: number },
  time: number,
  atlases: SpriteAtlases,
) {
  const { motion, elapsed } = active;
  for (const sprite of motion.sprites) {
    const delay = (sprite.delay ?? 0) * motion.duration;
    const localProgress = clamp01((elapsed - delay) / Math.max(0.001, motion.duration - delay));
    if (localProgress <= 0) continue;
    const travel = motion.kind === "rejected"
      ? Math.sin(localProgress * Math.PI) * 0.18
      : motion.kind === "swap" ? easeOutBack(localProgress) : easeOutCubic(localProgress);
    const offsetX = (sprite.toCol - sprite.fromCol) * CELL * travel;
    const offsetY =
      (sprite.toRow - sprite.fromRow) * CELL * travel -
      Math.sin(localProgress * Math.PI) * (motion.kind === "rejected" ? 0 : motion.kind === "salvage" ? 9 : 5);
    const collapse = sprite.collapse ? 1 - easeOutCubic(clamp01((localProgress - 0.12) / 0.68)) : 1;
    const stretch = Math.sin(localProgress * Math.PI) * (motion.kind === "swap" ? 0.09 : 0.055);
    const horizontal = sprite.fromCol !== sprite.toCol;
    const travelScaleX = horizontal ? 1 + stretch : 1 - stretch * 0.28;
    const travelScaleY = horizontal ? 1 - stretch * 0.28 : 1 + stretch;
    const originCenterX = GRID_X + sprite.fromCol * CELL + CELL / 2;
    const originCenterY = GRID_Y + sprite.fromRow * CELL + CELL / 2;

    if (sprite.piece.kind === "material" && (motion.kind === "swap" || motion.kind === "salvage")) {
      context.save();
      context.globalAlpha = Math.sin(localProgress * Math.PI) * 0.42;
      context.strokeStyle = MATERIAL_GLOW[sprite.piece.material].fill;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(originCenterX, originCenterY);
      context.lineTo(originCenterX + offsetX, originCenterY + offsetY);
      context.stroke();
      context.restore();
    }

    context.save();
    context.globalAlpha = sprite.collapse ? clamp01(collapse * 1.4) : 1;
    context.translate(offsetX, offsetY);
    context.translate(originCenterX, originCenterY);
    if (sprite.collapse) {
      const direction = (sprite.fromRow + sprite.fromCol) % 2 === 0 ? -1 : 1;
      context.rotate((1 - collapse) * direction * 0.16);
    }
    context.scale(
      Math.max(0.08, collapse * travelScaleX),
      Math.max(0.08, collapse * travelScaleY),
    );
    context.translate(-originCenterX, -originCenterY);
    drawPiece(
      context,
      sprite.piece,
      sprite.fromRow,
      sprite.fromCol,
      time,
      atlases,
      false,
    );
    context.restore();
  }

  for (const result of motion.results) {
    const delay = (result.delay ?? 0) * motion.duration;
    const localProgress = clamp01((elapsed - delay) / Math.max(0.001, motion.duration - delay));
    if (localProgress <= 0) continue;
    const supplyDrop = motion.kind === "supply"
      ? Math.pow(1 - localProgress, 2) * -22
      : 0;
    const overshoot = localProgress < 0.64
      ? 0.48 + easeOutCubic(localProgress / 0.64) * 0.7
      : 1.18 - easeOutCubic((localProgress - 0.64) / 0.36) * 0.18;
    const centerX = GRID_X + result.col * CELL + CELL / 2;
    const centerY = GRID_Y + result.row * CELL + CELL / 2;
    if (motion.kind === "construction" || motion.kind === "upgrade") {
      drawMergeBurst(context, centerX, centerY, localProgress);
    }
    context.save();
    context.globalAlpha = clamp01(localProgress * 3);
    context.translate(centerX, centerY + supplyDrop);
    context.scale(
      overshoot + Math.sin(localProgress * Math.PI) * 0.035,
      overshoot - Math.sin(localProgress * Math.PI) * 0.035,
    );
    context.translate(-centerX, -centerY);
    drawPiece(context, result.piece, result.row, result.col, time, atlases, false);
    context.restore();
  }
}

function drawBoard(
  context: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  atlases: SpriteAtlases,
  previousState: GameState,
  interpolation: number,
  boardMotion: BoardMotion | null,
) {
  const activeMotion = activeBoardMotion(boardMotion, time);
  drawBoardWaterBed(context, time, atlases.water);
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      if (!isWaterCol(col)) drawLandCell(context, row, col, atlases.terrain);
    }
  }
  for (const waterCol of WATER_COLS) {
    drawWaterChannel(context, waterCol, time, atlases.water);
  }

  if (state.phase === "planning" && state.selection?.kind === "land") {
    const { row, col } = state.selection;
    const piece = state.board[row][col];
    if (piece?.kind === "machine") {
      const { channels, range } = machineCoverage(piece, col);
      const top = GRID_Y + Math.max(0, row + 0.5 - range) * CELL;
      const bottom = GRID_Y + Math.min(BOARD_ROWS, row + 0.5 + range) * CELL;
      context.save();
      for (const channel of channels) {
        const x = GRID_X + WATER_COLS[channel] * CELL;
        context.fillStyle = "rgba(240, 205, 112, 0.16)";
        context.fillRect(x + 2, top, CELL - 4, bottom - top);
        context.strokeStyle = COLORS.gold;
        context.lineWidth = 2;
        context.setLineDash([4, 4]);
        context.strokeRect(x + 3, top + 1, CELL - 6, Math.max(0, bottom - top - 2));
      }
      context.restore();
    }
  }

  if (state.selection) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        if (isLegalLandTarget(state, row, col)) {
          drawLegalTarget(
            context,
            row,
            col,
            time,
            isCompatibleBuildTarget(state, row, col),
          );
        }
      }
    }
  }

  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = state.board[row][col];
      const hiddenByMotion = activeMotion?.motion.hiddenCells.some(
        (cell) => cell.row === row && cell.col === col,
      );
      const selected =
        state.selection?.kind === "land" &&
        state.selection.row === row &&
        state.selection.col === col;
      const currentActiveEffect = state.effects.find(
        (effect) =>
          effect.fromRow === row &&
          effect.fromCol === col &&
          ((piece?.kind === "machine" && piece.machine === "catapult" && effect.kind === "stone") ||
            (piece?.kind === "machine" && piece.machine === "siphon" && effect.kind === "fire") ||
            (piece?.kind === "machine" && piece.machine === "arm" && effect.kind === "claw") ||
            (piece?.kind === "machine" && piece.machine === "automaton" && effect.kind === "awe")),
      );
      const previousActiveEffect = currentActiveEffect
        ? previousState.effects.find((effect) => effect.id === currentActiveEffect.id)
        : undefined;
      const activeEffect = currentActiveEffect && previousActiveEffect
        ? {
            ...currentActiveEffect,
            ttl:
              previousActiveEffect.ttl +
              (currentActiveEffect.ttl - previousActiveEffect.ttl) * interpolation,
          }
        : currentActiveEffect;
      if (piece && !hiddenByMotion) {
        drawPiece(context, piece, row, col, time, atlases, selected, activeEffect);
      }
    }
  }

  if (activeMotion) drawBoardMotion(context, activeMotion, time, atlases);

  drawFloatingCargo(context, state, time, atlases.fleet, atlases.resources);
  const renderFleet = fleetRenderOrder(state, previousState, interpolation);
  const escorts = state.ships.filter(ship => ship.screening && !ship.resolved);
  const renderedEffects = state.effects.map(effect => {
    const previousEffect = previousState.effects.find(candidate => candidate.id === effect.id);
    return previousEffect
      ? { ...effect, ttl: previousEffect.ttl + (effect.ttl - previousEffect.ttl) * interpolation }
      : effect;
  });
  const renderState = { ...state, ships: renderFleet.map(({ ship, renderY }) => ({ ...ship, y: renderY })), effects: renderedEffects };
  // Water marks are always beneath every hull, including a passing neighbor.
  for (const { ship, renderY } of renderFleet) {
    if (!ship.resolved && state.battleTime >= ship.spawnAt && ship.y <= CHANNEL_ENTRY_Y &&
      ship.creature !== "skolopendra" && !renderedEffects.some(effect => effect.kind === "claw" && effect.targetId === ship.id)) {
      drawShipWake(context, ship, time, renderY);
    }
  }
  for (const { ship, renderY: interpolatedY } of renderFleet) {
    const exitEffect = shipActionEffect(ship, state.effects);
    const previousExitEffect = exitEffect
      ? previousState.effects.find((effect) => effect.id === exitEffect.id)
      : undefined;
    const renderedExitEffect = exitEffect && previousExitEffect
      ? {
          ...exitEffect,
          ttl: previousExitEffect.ttl + (exitEffect.ttl - previousExitEffect.ttl) * interpolation,
        }
      : exitEffect;
    const lingering = ship.resolved && !ship.boss && exitEffect;
    const fallEffect = renderedEffects.find(
      (effect) => effect.targetId === ship.id && effect.kind === "monsterFall",
    );
    const bossAwaitingFall = Boolean(
      ship.resolved &&
      ship.boss &&
      fallEffect &&
      fallEffect.total - fallEffect.ttl < (fallEffect.delay ?? 0),
    );
    if (
      (!ship.resolved || lingering || bossAwaitingFall) &&
      state.battleTime >= ship.spawnAt &&
      ship.y <= CHANNEL_ENTRY_Y
    ) {
      let renderY = interpolatedY;
      let exitProgress = 0;
      let recoilX = 0;
      const armMotion = renderedExitEffect?.kind === "claw"
        ? armEffectGeometry(renderedExitEffect, effectProgress(renderedExitEffect), state)
        : null;
      if (armMotion) {
        renderY = renderedExitEffect?.grabY ?? renderY;
      }
      if (renderedExitEffect?.kind === "impact") {
        const hitElapsed = renderedExitEffect.total - renderedExitEffect.ttl;
        const hitDelay = renderedExitEffect.delay ?? 0;
        const hitProgress = clamp01(
          (hitElapsed - hitDelay) / Math.max(0.001, renderedExitEffect.total - hitDelay),
        );
        recoilX = Math.sin(hitProgress * Math.PI * 5) * (1 - hitProgress) * 2.2;
      }
      if (lingering) {
        const animatedExit = renderedExitEffect ?? exitEffect;
        const elapsed = animatedExit.total - animatedExit.ttl;
        const delay = animatedExit.delay ?? 0;
        exitProgress = clamp01((elapsed - delay) / Math.max(0.001, animatedExit.total - delay));
        if (animatedExit.kind !== "claw") renderY += exitProgress * 0.24;
      }
      context.save();
      context.translate(recoilX, 0);
      if (armMotion) {
        context.translate(armMotion.victimX, armMotion.victimY);
        context.translate(armMotion.contactX, armMotion.contactScreenY);
        context.rotate(armMotion.victimRoll);
        context.translate(-armMotion.contactX, -armMotion.contactScreenY);
        context.globalAlpha = armMotion.victimAlpha;
      } else if (lingering) {
        context.globalAlpha = Math.max(0.08, 1 - exitProgress * 0.92);
      }
      drawShip(context, ship, time, atlases, renderY, renderedExitEffect);
      if (escorts.length && isShipScreened(ship, escorts, state.battleTime)) {
        const { x, y } = shipScreenPosition(ship, renderY);
        const badgeY = y + (ship.creature ? 36 : 24);
        polygon(context, [[x + 17, badgeY - 3], [x + 24, badgeY - 3], [x + 23, badgeY + 2],
          [x + 20, badgeY + 5], [x + 17, badgeY + 2]], "#377f79", COLORS.bronzeLight, 1);
      }
      context.restore();
    }
    if (fallEffect) drawEffect(context, fallEffect, atlases, time, renderState);
  }
  for (const renderedEffect of renderedEffects) {
    if (renderedEffect.kind !== "monsterFall") drawEffect(context, renderedEffect, atlases, time, renderState);
  }

  if (state.selection?.kind === "land") {
    const x = GRID_X + state.selection.col * CELL;
    const y = GRID_Y + state.selection.row * CELL;
    context.globalAlpha = 0.72 + Math.sin(time * 7) * 0.24;
    context.strokeStyle = COLORS.gold;
    context.lineWidth = 3.5;
    context.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);
    context.globalAlpha = 1;
  }
}

function drawVoxelUiBackdrop(
  context: CanvasRenderingContext2D,
  top: number,
) {
  rect(context, 0, top, WIDTH, HEIGHT - top, "#102f3e");
  rect(context, 0, top, WIDTH, 4, "#2c5964");
  rect(context, 0, top + 4, WIDTH, 3, "#071d2b");
}

function drawLowerPanel(
  context: CanvasRenderingContext2D,
  state: GameState,
) {
  const panelTop = GRID_Y + BOARD_ROWS * CELL + 4;
  drawVoxelUiBackdrop(context, panelTop);
  pixelPanel(context, 12, 439, 390, 127, "#d9bf87", COLORS.outline, 6, 3);

  const title = state.phase === "gameover" ? "THE GATES HAVE FALLEN" : waveTitle(state.tide).toUpperCase();
  pixelText(context, title, WIDTH / 2, 453, 14, COLORS.wineDark, "center", 350);
  pixelText(
    context,
    state.phase === "planning"
      ? wavePreview(state.tide, state.runSeed)
      : state.phase === "gameover"
        ? `TIDE ${state.tide} · ${state.captures} CAPTURED`
        : `${state.ships.filter((ship) => !ship.resolved).length} REMAIN · ${state.harbor}/${state.maxHarbor} GATE`,
    WIDTH / 2,
    473,
    10,
    COLORS.ink,
    "center",
    350,
  );
  if (state.phase === "planning") {
    const nextSupply = dawnSupplyPreview(state.tide, state.runSeed)
      .map((material) => MATERIAL_LABELS[material].toUpperCase())
      .join(" · ");
    pixelText(
      context,
      `NEXT DAWN · ${nextSupply}`,
      WIDTH / 2,
      489,
      9,
      "#5b4134",
      "center",
      350,
    );
  }

  if (state.phase === "battle") {
    const incoming = state.ships.filter(ship => !ship.resolved && ship.spawnAt > state.battleTime);
    const nextArrival = Math.min(...incoming.map(ship => ship.spawnAt));
    pixelText(context, incoming.length
      ? `${incoming.length} INCOMING · NEXT IN ${Math.max(1, Math.ceil(nextArrival - state.battleTime))}s`
      : "FINAL ASSAULT · HOLD THE GATES", WIDTH / 2, 489, 9, "#5b4134", "center", 350);
  }

  rect(context, 27, 501, 360, 2, "#9f7651");
  context.save();
  context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = COLORS.ink;
  const feedback = state.phase === "planning" && state.actions === 0 && !state.selection
    ? "No moves left. Sound the horn when you are ready."
    : state.message;
  const words = feedback.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width > 348 && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((text, index) =>
    context.fillText(text, WIDTH / 2, 517 + index * 15),
  );
  context.restore();
}

function drawGame(
  context: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  atlases: SpriteAtlases,
  previousState: GameState,
  interpolation: number,
  boardMotion: BoardMotion | null,
) {
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  drawCity(context, state, time, atlases);
  drawHud(context, state);
  drawBoard(context, state, time, atlases, previousState, interpolation, boardMotion);
  drawLowerPanel(context, state);

  const landing = state.effects.find((effect) => effect.kind === "landing");
  if (landing) {
    const progress = 1 - landing.ttl / landing.total;
    context.save();
    context.globalAlpha = Math.max(0, (1 - progress) * 0.34);
    context.fillStyle = COLORS.oxblood;
    context.fillRect(0, 0, WIDTH, 5);
    context.fillRect(0, HEIGHT - 5, WIDTH, 5);
    context.fillRect(0, 0, 5, HEIGHT);
    context.fillRect(WIDTH - 5, 0, 5, HEIGHT);
    context.restore();
  }

  if (state.phase === "gameover") {
    context.fillStyle = "rgba(20, 16, 24, 0.62)";
    context.fillRect(0, GRID_Y, WIDTH, BOARD_ROWS * CELL);
    pixelText(context, `${state.kleos} KLEOS`, WIDTH / 2, GRID_Y + 117, 25, COLORS.gold);
    pixelText(context, `${state.captures} SHIPS TAKEN WHOLE`, WIDTH / 2, GRID_Y + 151, 12, "#fff0b4");
  }
}

function cellLabel(state: GameState, row: number, col: number) {
  if (isWaterCol(col)) {
    const channel = channelForWaterCol(col);
    const cargo = channel === null
      ? undefined
      : state.cargo.find((item) => item.row === row && item.channel === channel);
    return cargo
      ? `${channel === 0 ? "West" : "east"} channel row ${row + 1}, floating ${MATERIAL_LABELS_FOR_ARIA[cargo.material]}`
      : `${channel === 0 ? "West" : "east"} channel row ${row + 1}`;
  }
  const piece = state.board[row][col];
  if (!piece) return `Empty land square, row ${row + 1}, column ${col + 1}`;
  if (piece.kind === "material") {
    return `${MATERIAL_LABELS_FOR_ARIA[piece.material]}, row ${row + 1}, column ${col + 1}`;
  }
  return `${MACHINE_LABELS[piece.machine]}, tier ${piece.tier}, row ${row + 1}, column ${col + 1}`;
}

const MATERIAL_LABELS_FOR_ARIA: Record<MaterialKind, string> = {
  stone: "limestone",
  timber: "timber",
  bronze: "bronze",
  wine: "wine amphora",
};

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

interface BronzeDroneGraph {
  context: AudioContext;
  tone: OscillatorNode;
  lfo: OscillatorNode;
  mute: GainNode;
  nodes: AudioNode[];
}

type OpenPanel = "menu" | "account" | "rules" | "forecast" | null;

interface SuppressedBoardClick {
  row: number;
  col: number;
  expiresAt: number;
}

type ScoreRecord = {
  tide: number;
  kleos: number;
  captures: number;
  created_at: string;
};

type AccountRecord = {
  displayName: string;
  joinedAt: string;
  runs: number;
  best: ScoreRecord | null;
  recentRuns: ScoreRecord[];
};

type LeaderboardEntry = {
  rank: number;
  displayName: string;
  tide: number;
  kleos: number;
  captures: number;
  runs: number;
};

interface SeaGatesGameProps {
  initialAccount: { displayName: string; accountKey: string } | null;
  signInHref: string;
  signOutHref: string;
  deviceOnly?: boolean;
}

function useBronzeDrone() {
  const graphRef = useRef<BronzeDroneGraph | null>(null);
  const mutedRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const stored = readBooleanPreference(browserStorage(), AUDIO_STORAGE_KEY);
    mutedRef.current = stored;
    const timeout = window.setTimeout(() => setIsMuted(stored), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const startDrone = useCallback(() => {
    const existing = graphRef.current;
    if (existing) {
      if (!mutedRef.current && !document.hidden && existing.context.state !== "running") {
        void existing.context.resume().catch(() => {});
      }
      return;
    }

    if (mutedRef.current || document.hidden) return;

    const AudioContextClass = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AudioContextClass) return;

    let context: AudioContext | undefined;
    try {
      context = new AudioContextClass();
      const tone = context.createOscillator();
      const filter = context.createBiquadFilter();
      const level = context.createGain();
      const mute = context.createGain();
      const lfo = context.createOscillator();
      const lfoDepth = context.createGain();
      const now = context.currentTime;

      // One fixed A2 pitch, softened into a very quiet bronze-like drone.
      tone.type = "triangle";
      tone.frequency.setValueAtTime(110, now);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(480, now);
      filter.Q.setValueAtTime(0.5, now);
      level.gain.setValueAtTime(0.011, now);
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.055, now);
      lfoDepth.gain.setValueAtTime(0.0015, now);
      mute.gain.setValueAtTime(0, now);
      if (!mutedRef.current) mute.gain.linearRampToValueAtTime(1, now + 1.5);

      tone.connect(filter).connect(level).connect(mute).connect(context.destination);
      lfo.connect(lfoDepth).connect(level.gain);
      graphRef.current = {
        context,
        tone,
        lfo,
        mute,
        nodes: [tone, filter, level, mute, lfo, lfoDepth],
      };
      tone.start(now);
      lfo.start(now);
      if (context.state !== "running") void context.resume().catch(() => {});
    } catch {
      if (context) void context.close().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unlock = () => startDrone();
    const unlockFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") startDrone();
    };
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlockFromKeyboard, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlockFromKeyboard, true);
    };
  }, [startDrone]);

  useEffect(() => {
    const syncAudioVisibility = () => {
      const graph = graphRef.current;
      if (!graph) return;
      if (document.hidden || mutedRef.current) {
        void graph.context.suspend().catch(() => {});
      } else if (graph.context.state !== "running") {
        void graph.context.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", syncAudioVisibility);
    return () => document.removeEventListener("visibilitychange", syncAudioVisibility);
  }, []);

  useEffect(() => () => {
    const graph = graphRef.current;
    graphRef.current = null;
    if (!graph) return;
    try {
      graph.tone.stop();
    } catch {
      // The source was already stopped during teardown.
    }
    try {
      graph.lfo.stop();
    } catch {
      // The source was already stopped during teardown.
    }
    for (const node of graph.nodes) node.disconnect();
    void graph.context.close().catch(() => {});
  }, []);

  const toggleMuted = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setIsMuted(next);
    writeBooleanPreference(browserStorage(), AUDIO_STORAGE_KEY, next);
    const graph = graphRef.current;
    if (!graph) {
      if (!next) startDrone();
      return;
    }
    const now = graph.context.currentTime;
    graph.mute.gain.cancelScheduledValues(now);
    graph.mute.gain.setTargetAtTime(next ? 0 : 1, now, 0.025);
    if (next) {
      window.setTimeout(() => {
        if (mutedRef.current) void graph.context.suspend().catch(() => {});
      }, 80);
    } else if (!document.hidden && graph.context.state !== "running") {
      void graph.context.resume().catch(() => {});
    }
  }, [startDrone]);

  return { isMuted, toggleMuted };
}

export default function SeaGatesGame({
  initialAccount,
  signInHref,
  signOutHref,
  deviceOnly = false,
}: SeaGatesGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [desktopToolsOpen, setDesktopToolsOpen] = useState(false);
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });
  const [accountRecord, setAccountRecord] = useState<AccountRecord | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [deviceBook] = useState(() => createDeviceRecords(deviceOnly ? browserStorage() : null));
  const [deviceRecords, setDeviceRecords] = useState<ReturnType<typeof deviceBook.read> | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const [cargoWarningArmed, setCargoWarningArmed] = useState(false);
  const [battleSpeed, setBattleSpeed] = useState<1 | 2>(1);
  const [undoCount, setUndoCount] = useState(0);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "pending" | "saved">("idle");
  const [saveStatus, setSaveStatus] = useState<CheckpointStatus>("saved");
  const checkpointsRef = useRef<ReturnType<typeof openRunCheckpoints> | null>(null);
  const [recoveredRun, setRecoveredRun] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const retryArtworkRef = useRef<() => void>(() => {});
  const undoHistoryRef = useRef<GameState[]>([]);
  const scoreOutboxRef = useRef<ReturnType<typeof createScoreOutbox> | null>(null);
  const scoreRequestRef = useRef<AbortController | null>(null);
  const recordsRequestRef = useRef(0);
  const gameRef = useRef(game);
  const previousGameRef = useRef(game);
  const battleSpeedRef = useRef<1 | 2>(1);
  const boardControlsRef = useRef<HTMLDivElement>(null);
  const desktopToolsRef = useRef<HTMLDivElement>(null);
  const panelOpenerRef = useRef<HTMLElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wakeRendererRef = useRef<() => void>(() => {});
  const boardMotionRef = useRef<BoardMotion | null>(null);
  const boardPointerRef = useRef<BoardPointerGesture | null>(null);
  const suppressClickRef = useRef<SuppressedBoardClick | null>(null);
  const openPanelRef = useRef<OpenPanel>(openPanel);
  const atlasesRef = useRef<SpriteAtlases>(EMPTY_ATLASES);
  const runKeyRef = useRef<string | null>(null);
  const submittedRunRef = useRef<string | null>(null);
  const { isMuted, toggleMuted } = useBronzeDrone();

  if (runKeyRef.current === null) runKeyRef.current = createRunKey();

  const checkpointRun = useCallback((current: GameState, history: readonly GameState[] = undoHistoryRef.current) => {
    const runKey = runKeyRef.current;
    if (runKey && checkpointsRef.current) setSaveStatus(checkpointsRef.current.save(current, runKey, history));
  }, []);

  const changeOpenPanel = useCallback((panel: OpenPanel) => {
    if (panel && !openPanelRef.current) {
      const focused = document.activeElement;
      panelOpenerRef.current = focused instanceof HTMLElement ? focused : null;
    }
    openPanelRef.current = panel;
    if (dialogRef.current) dialogRef.current.scrollTop = 0;
    setOpenPanel(panel);
    setDesktopToolsOpen(false);
    boardPointerRef.current = null;
    if (panel && runKeyRef.current) {
      checkpointRun(gameRef.current);
    }
    wakeRendererRef.current();
  }, [checkpointRun]);

  useEffect(() => {
    const checkpoints = openRunCheckpoints(browserStorage());
    checkpointsRef.current = checkpoints;
    const saved = checkpoints.saved;
    const preferredSpeed = readBattleSpeed(browserStorage());
    battleSpeedRef.current = preferredSpeed;
    if (saved) {
      undoHistoryRef.current = saved.undoHistory;
      runKeyRef.current = saved.runKey;
      gameRef.current = saved.game;
      previousGameRef.current = saved.game;
      if (saved.game.phase === "battle") openPanelRef.current = "menu";
    }
    const timeout = window.setTimeout(() => {
      setBattleSpeed(preferredSpeed);
      setUndoCount(undoHistoryRef.current.length);
      setRecoveredRun(Boolean(saved?.recovered));
      if (saved) setGame(saved.game);
      if (saved?.game.phase === "battle") setOpenPanel("menu");
      wakeRendererRef.current();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const checkpoint = () => {
      checkpointRun(gameRef.current);
    };
    const interval = window.setInterval(() => {
      if (gameRef.current.phase === "battle") checkpoint();
    }, 1800);
    const handleVisibility = () => {
      if (document.hidden) {
        checkpoint();
        if (gameRef.current.phase === "battle" && !openPanelRef.current) {
          changeOpenPanel("menu");
        }
      }
    };
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [changeOpenPanel, checkpointRun]);

  useEffect(() => {
    if (!resetArmed) return;
    const timeout = window.setTimeout(() => setResetArmed(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [resetArmed]);

  useEffect(() => {
    if (!desktopToolsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!desktopToolsRef.current?.contains(event.target as Node)) {
        setDesktopToolsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDesktopToolsOpen(false);
        desktopToolsRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [desktopToolsOpen]);

  const loadRecords = useCallback(async () => {
    if (deviceOnly) {
      setDeviceRecords(deviceBook.read());
      return;
    }
    const requestId = ++recordsRequestRef.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setRecordsLoading(true);
    setRecordsError("");
    setAccountError("");
    const leaderboardRequest = (async () => {
      const response = await fetch("/api/leaderboard", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The records wall did not answer.");
      return (await response.json()) as { leaderboard: LeaderboardEntry[] };
    })();
    const accountRequest = initialAccount
      ? (async () => {
          const response = await fetch("/api/account", { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Your account record did not answer.");
          return (await response.json()) as { account: AccountRecord };
        })()
      : Promise.resolve(null);
    const [leaderboardResult, accountResult] = await Promise.allSettled([
      leaderboardRequest,
      accountRequest,
    ]);
    window.clearTimeout(timeout);
    if (requestId !== recordsRequestRef.current) return;

    if (leaderboardResult.status === "fulfilled") {
      setLeaderboard(leaderboardResult.value.leaderboard);
    } else {
      setRecordsError(
        leaderboardResult.reason instanceof Error
          ? leaderboardResult.reason.message
          : "The records wall did not answer.",
      );
    }
    if (accountResult.status === "fulfilled") {
      if (accountResult.value) setAccountRecord(accountResult.value.account);
    } else {
      setAccountError(
        accountResult.reason instanceof Error
          ? accountResult.reason.message
          : "Your account record did not answer.",
      );
    }
    setRecordsLoading(false);
  }, [initialAccount, deviceOnly, deviceBook]);

  const openAccountPanel = useCallback(() => {
    changeOpenPanel("account");
    void loadRecords();
  }, [changeOpenPanel, loadRecords]);

  const openRulesPanel = useCallback(() => {
    changeOpenPanel("rules");
  }, [changeOpenPanel]);

  const openHarborMenu = useCallback(() => {
    changeOpenPanel("menu");
  }, [changeOpenPanel]);

  const flushScores = useCallback(async () => {
    const outbox = scoreOutboxRef.current;
    if (!outbox?.size || scoreRequestRef.current) return;
    setScoreStatus("pending");
    const controller = new AbortController();
    scoreRequestRef.current = controller;
    const saved = await outbox.flush(async (score) => {
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ ...score, accountKey: outbox.accountKey }),
        });
        return response.ok;
      } finally {
        window.clearTimeout(timeout);
      }
    });
    if (scoreRequestRef.current === controller) scoreRequestRef.current = null;
    if (scoreOutboxRef.current !== outbox) return;
    setScoreStatus(saved ? "saved" : "pending");
    if (saved && openPanelRef.current === "account") void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!initialAccount) return;
    scoreOutboxRef.current = createScoreOutbox(browserStorage(), initialAccount.accountKey);
    const retry = () => { if (!document.hidden) void flushScores(); };
    const firstAttempt = window.setTimeout(retry, 0);
    const interval = window.setInterval(retry, 30_000);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.clearTimeout(firstAttempt);
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
      scoreOutboxRef.current = null;
      scoreRequestRef.current?.abort();
      scoreRequestRef.current = null;
    };
  }, [initialAccount, flushScores]);

  const queueCompletedRun = useCallback((completed: GameState) => {
    const runKey = runKeyRef.current;
    if (completed.phase !== "gameover" || !runKey || submittedRunRef.current === runKey) return;
    const score = { runKey, tide: completed.tide, kleos: completed.kleos, captures: completed.captures };
    if (deviceOnly) {
      deviceBook.record(score);
      submittedRunRef.current = runKey;
      return;
    }
    if (!scoreOutboxRef.current) return;
    scoreOutboxRef.current.enqueue(score);
    submittedRunRef.current = runKey;
    void flushScores();
  }, [flushScores, deviceOnly, deviceBook]);

  useEffect(() => {
    if (game.phase !== "gameover") return;
    queueCompletedRun(game);
  }, [game, queueCompletedRun]);

  useEffect(() => {
    let cancelled = false;
    let deferred = 0;
    let retryTimer = 0;
    let retryRounds = 0;
    const controller = new AbortController();
    const inFlight = new Set<keyof SpriteAtlases>();
    const failed = new Set<keyof SpriteAtlases>();

    const critical: Array<[keyof SpriteAtlases, string]> = [
      ["machines", "/assets/machines-atlas.webp"],
      ["fleet", "/assets/fleet-atlas.webp"],
      ["resources", "/assets/resource-atlas-v2.webp"],
      ["terrain", "/assets/terrain-atlas.webp"],
      ["water", "/assets/water-atlas.webp"],
      ["backdrop", "/assets/aegean-backdrop.webp"],
      ["gate", "/assets/cyclopean-gate-atlas.webp"],
    ];
    const deferredAtlases: Array<[keyof SpriteAtlases, string]> = [
      ["crew", "/assets/crew-atlas.webp"],
      ["skolopendra", "/assets/skolopendra-atlas.webp"],
      ["creatures", "/assets/sea-creatures-atlas.webp"],
    ];
    const allAtlases = [...critical, ...deferredAtlases];

    const loadSet = async (entries: Array<[keyof SpriteAtlases, string]>) => {
      const pending = entries.filter(([key]) => !atlasesRef.current[key] && !inFlight.has(key));
      if (!pending.length) return;
      for (const [key] of pending) inFlight.add(key);
      const results = await Promise.allSettled(
        pending.map(async ([key, source]) => [key, await loadSpriteImage(deviceOnly ? "." + source : source, { signal: controller.signal })] as const),
      );
      if (cancelled) return;
      const loaded: Partial<SpriteAtlases> = {};
      for (const [index, result] of results.entries()) {
        const key = pending[index][0];
        inFlight.delete(key);
        if (result.status === "fulfilled") {
          loaded[key] = result.value[1];
          failed.delete(key);
        } else failed.add(key);
      }
      atlasesRef.current = { ...atlasesRef.current, ...loaded };
      wakeRendererRef.current();
      setArtworkFailed(failed.size > 0);
      if (failed.size && retryRounds < 2 && !retryTimer) {
        retryTimer = window.setTimeout(() => {
          retryTimer = 0;
          retryRounds++;
          void loadSet(allAtlases);
        }, 1500 * (retryRounds + 1));
      }
    };

    const retry = () => {
      if (cancelled) return;
      retryRounds = 0;
      window.clearTimeout(retryTimer);
      retryTimer = 0;
      setArtworkFailed(false);
      void loadSet(allAtlases);
    };
    retryArtworkRef.current = retry;
    window.addEventListener("online", retry);

    // Swap the opening visual family in together so slow connections never
    // show a half-atlas/half-fallback board. Boss art waits until that set is ready.
    void loadSet(critical).finally(() => {
      if (cancelled) return;
      deferred = window.setTimeout(() => void loadSet(deferredAtlases), 180);
    });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(deferred);
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", retry);
      retryArtworkRef.current = () => {};
    };
  }, [deviceOnly]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    let animationFrame = 0;
    let wakeTimer = 0;
    let running = true;
    let previous = performance.now();
    let accumulator = 0;
    let gameOverAt: number | null = null;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionPreference.matches;
    const reactSignature = (state: GameState) => [
      state.phase,
      state.harbor,
      state.kleos,
      state.captures,
      state.tide,
      state.actions,
      state.ships.filter((ship) => !ship.resolved).length,
    ].join("|");
    let lastReactSignature = reactSignature(gameRef.current);

    const frameRate = () => {
      const current = gameRef.current;
      if (openPanelRef.current) return 0;
      if (current.phase === "battle") return reduceMotion ? 15 : 30;
      if (activeBoardMotion(boardMotionRef.current, performance.now() / 1000)) {
        return reduceMotion ? 12 : 30;
      }
      return reduceMotion ? 1 : 20;
    };

    const schedule = () => {
      if (!running || document.hidden) return;
      const framesPerSecond = frameRate();
      if (framesPerSecond === 0) return;
      // Leave one display frame for requestAnimationFrame. Waiting the full
      // interval first turned the intended 30 fps into roughly 20 fps.
      const delay = Math.max(0, Math.round(1000 / framesPerSecond) - 16);
      wakeTimer = window.setTimeout(() => {
        wakeTimer = 0;
        if (running && !document.hidden) animationFrame = requestAnimationFrame(tick);
      }, delay);
    };

    const wakeRenderer = () => {
      if (!running || document.hidden) return;
      window.clearTimeout(wakeTimer);
      cancelAnimationFrame(animationFrame);
      previous = performance.now();
      animationFrame = requestAnimationFrame(tick);
    };

    wakeRendererRef.current = wakeRenderer;

    const tick = (now: number) => {
      const dt = Math.min(0.12, Math.max(0, (now - previous) / 1000));
      previous = now;
      let current = gameRef.current;
      const phaseAtTickStart = current.phase;

      const menuPaused = openPanelRef.current !== null;
      if (current.phase === "battle" && !menuPaused) {
        const speed = battleSpeedRef.current;
        accumulator = Math.min(
          accumulator + dt * speed,
          SIMULATION_STEP * (speed === 2 ? 8 : 4),
        );
        let stepped = false;
        while (accumulator >= SIMULATION_STEP && current.phase === "battle") {
          const beforeStep = current;
          previousGameRef.current = current;
          current = stepBattle(current, SIMULATION_STEP);
          if (beforeStep.phase === "battle" && current.phase === "planning") {
            undoHistoryRef.current = [];
            setUndoCount(0);
            boardMotionRef.current = reduceMotion ? null : supplyMotion(beforeStep, current, now / 1000);
          }
          gameRef.current = current;
          accumulator -= SIMULATION_STEP;
          stepped = true;
          if (current.phase === "gameover") gameOverAt = now;
        }
        if (stepped) {
          const signature = reactSignature(current);
          if (signature !== lastReactSignature) {
            setGame(current);
            lastReactSignature = signature;
          }
          if (current.phase !== phaseAtTickStart) {
            checkpointRun(current);
          }
        }
      } else {
        previousGameRef.current = current;
        accumulator = 0;
        if (current.phase !== "gameover") gameOverAt = null;
      }

      const interpolation = current.phase === "battle"
        ? accumulator / SIMULATION_STEP
        : 1;
      context.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      const gameOverElapsed = gameOverAt === null ? 0 : (now - gameOverAt) / 1000;
      const renderState = current.phase === "gameover" && gameOverAt !== null
        ? {
            ...current,
            effects: current.effects
              .map((effect) => ({
                ...effect,
                ttl: effect.ttl - gameOverElapsed,
              }))
              .filter((effect) => effect.ttl > 0),
          }
        : current;
      drawGame(
        context,
        renderState,
        reduceMotion ? 0 : now / 1000,
        atlasesRef.current,
        previousGameRef.current,
        interpolation,
        reduceMotion ? null : boardMotionRef.current,
      );
      schedule();
    };

    const handleVisibilityChange = () => {
      window.clearTimeout(wakeTimer);
      cancelAnimationFrame(animationFrame);
      if (!document.hidden) {
        wakeRenderer();
      }
    };

    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      wakeRenderer();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    motionPreference.addEventListener("change", handleMotionPreference);
    wakeRenderer();
    return () => {
      running = false;
      wakeRendererRef.current = () => {};
      window.clearTimeout(wakeTimer);
      cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      motionPreference.removeEventListener("change", handleMotionPreference);
    };
  }, []);

  const commitGame = (update: (current: GameState) => GameState) => {
    const next = update(gameRef.current);
    gameRef.current = next;
    previousGameRef.current = next;
    setGame(next);
    wakeRendererRef.current();
    if (next.cargo.length === 0) setCargoWarningArmed(false);
    checkpointRun(next);
  };

  const commitCellAction = (
    before: GameState,
    next: GameState,
    row: number,
    col: number,
    startedAt: number,
  ) => {
    if (next === before) return false;
    undoHistoryRef.current = rememberPlanningMove(undoHistoryRef.current, before, next);
    setUndoCount(undoHistoryRef.current.length);
    const motion = planningMotionForAction(before, next, row, col, startedAt);
    if (motion) {
      boardMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : motion;
    }
    gameRef.current = next;
    previousGameRef.current = next;
    setGame(next);
    wakeRendererRef.current();
    setCargoWarningArmed(false);
    checkpointRun(next);
    if (next.actions < before.actions) {
      try {
        navigator.vibrate?.(motion?.kind === "construction" || motion?.kind === "upgrade" ? 18 : 8);
      } catch {
        // Haptics are an optional enhancement on supporting mobile browsers.
      }
    }
    return true;
  };

  const handleCell = (row: number, col: number, startedAt: number) => {
    // The board state is already committed. Finish the previous cosmetic
    // motion when a player acts again instead of silently dropping their tap.
    boardMotionRef.current = null;
    const current = gameRef.current;
    let next = current;
    if (isWaterCol(col)) {
      const channel = channelForWaterCol(col);
      if (channel !== null) next = selectCargoAt(current, row, channel);
    } else {
      next = actOnLandCell(current, row, col);
    }
    commitCellAction(current, next, row, col, startedAt);
  };

  const handleCellPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ) => {
    if (!event.isPrimary || event.button > 0 || gameRef.current.phase !== "planning" || gameRef.current.actions <= 0) return;
    boardPointerRef.current = {
      pointerId: event.pointerId,
      row,
      col,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCellPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = boardPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    boardPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const boardWidth = boardControlsRef.current?.getBoundingClientRect().width ?? BOARD_COLS * CELL;
    const scale = BOARD_COLS * CELL / Math.max(1, boardWidth);
    const dx = (event.clientX - gesture.x) * scale;
    const dy = (event.clientY - gesture.y) * scale;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;

    // Every real swipe consumes its synthetic click, including a swipe into
    // the sea or off the board. Invalid swipes must not become stray taps.
    const suppression: SuppressedBoardClick = {
      row: gesture.row,
      col: gesture.col,
      expiresAt: animationClockSeconds() * 1000 + 450,
    };
    suppressClickRef.current = suppression;
    window.setTimeout(() => {
      if (suppressClickRef.current === suppression) suppressClickRef.current = null;
    }, 460);
    const target = resolveSwipeTarget(gesture.row, gesture.col, dx, dy);
    if (!target) return;

    const startedAt = animationClockSeconds();
    boardMotionRef.current = null;
    const current = gameRef.current;
    const unselected = current.selection ? { ...current, selection: null } : current;
    let primed = unselected;
    if (isWaterCol(gesture.col)) {
      const channel = channelForWaterCol(gesture.col);
      if (channel !== null) primed = selectCargoAt(unselected, gesture.row, channel);
    } else {
      primed = actOnLandCell(unselected, gesture.row, gesture.col);
    }
    if (!primed.selection) return;
    const next = actOnLandCell(primed, target.row, target.col);
    commitCellAction(primed, next, target.row, target.col, startedAt);
  };

  const beginNewRun = () => {
    queueCompletedRun(gameRef.current);
    checkpointsRef.current?.beginNew();
    runKeyRef.current = createRunKey();
    submittedRunRef.current = null;
    boardMotionRef.current = null;
    undoHistoryRef.current = [];
    setUndoCount(0);
    setResetArmed(false);
    setRecoveredRun(false);
    setCargoWarningArmed(false);
    setFocusedCell({ row: 0, col: 0 });
    changeOpenPanel(null);
    commitGame(() => createInitialGame());
  };

  const undoLastMove = useCallback(() => {
    const result = undoPlanningMove(gameRef.current, undoHistoryRef.current);
    if (!result) return;
    undoHistoryRef.current = result.history;
    boardMotionRef.current = null;
    boardPointerRef.current = null;
    suppressClickRef.current = null;
    gameRef.current = result.game;
    previousGameRef.current = result.game;
    setGame(result.game);
    setUndoCount(result.history.length);
    setCargoWarningArmed(false);
    wakeRendererRef.current();
    checkpointRun(result.game, result.history);
  }, [checkpointRun]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.isContentEditable || target?.closest("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        if (!openPanelRef.current && undoHistoryRef.current.length && gameRef.current.phase === "planning") {
          event.preventDefault();
          undoLastMove();
        }
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat &&
        (event.key === "Escape" || event.key.toLowerCase() === "p")) {
        if (!openPanelRef.current) {
          event.preventDefault();
          changeOpenPanel("menu");
        }
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [changeOpenPanel, undoLastMove]);

  const cellIsInteractive = (row: number, col: number) => {
    if (game.phase !== "planning") return false;
    if (!isWaterCol(col)) return true;
    const channel = channelForWaterCol(col);
    return channel !== null && game.cargo.some((item) => item.row === row && item.channel === channel);
  };

  const focusBoardCell = (row: number, col: number) => {
    setFocusedCell({ row, col });
    window.requestAnimationFrame(() => {
      boardControlsRef.current
        ?.querySelector<HTMLButtonElement>(`[data-board-row="${row}"][data-board-col="${col}"]`)
        ?.focus();
    });
  };

  const handleCellKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ) => {
    if (event.key === "Escape" && gameRef.current.selection) {
      event.preventDefault();
      event.stopPropagation();
      commitGame((current) => ({ ...current, selection: null }));
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();

    if (event.key === "Home") {
      focusBoardCell(0, 0);
      return;
    }
    if (event.key === "End") {
      focusBoardCell(BOARD_ROWS - 1, BOARD_COLS - 1);
      return;
    }

    let nextRow = row + direction[0];
    let nextCol = col + direction[1];
    while (
      nextRow >= 0 && nextRow < BOARD_ROWS &&
      nextCol >= 0 && nextCol < BOARD_COLS
    ) {
      if (cellIsInteractive(nextRow, nextCol)) {
        focusBoardCell(nextRow, nextCol);
        return;
      }
      nextRow += direction[0];
      nextCol += direction[1];
    }
  };

  const primaryAction = () => {
    const current = gameRef.current;
    if (current.phase === "planning") {
      if (current.actions > 0 && current.cargo.length > 0 && !cargoWarningArmed) {
        setCargoWarningArmed(true);
        return;
      }
      setCargoWarningArmed(false);
      boardMotionRef.current = null;
      undoHistoryRef.current = [];
      setUndoCount(0);
      commitGame((latest) => startBattle(latest));
    } else if (current.phase === "battle") {
      const nextSpeed = battleSpeedRef.current === 1 ? 2 : 1;
      battleSpeedRef.current = nextSpeed;
      setBattleSpeed(nextSpeed);
      writeBattleSpeed(browserStorage(), nextSpeed);
      try {
        navigator.vibrate?.(8);
      } catch {
        // Haptics are optional.
      }
    } else {
      beginNewRun();
    }
  };

  const buttonLabel =
    game.phase === "planning"
      ? cargoWarningArmed ? "LEAVE CARGO?" : "SOUND HORN"
      : game.phase === "battle"
        ? `DEFEND · ${battleSpeed}×`
        : "NEW POLIS";
  const rovingCell = cellIsInteractive(focusedCell.row, focusedCell.col)
    ? focusedCell
    : { row: 0, col: 0 };
  const bossChannel = game.phase === "planning" ? bossChannelForTide(game.tide, game.runSeed) : null;
  const openingHint = game.phase === "planning" && game.tide === 1 && game.actions === 5 && !game.selection;
  const scoutedFleet = openPanel === "forecast" && game.phase === "planning"
    ? startBattle(game).ships
    : [];

  return (
    <main className="sea-gates-page">
      <section className="game-stage" aria-labelledby="game-title">
        <h1 id="game-title" className="sr-only">The Sea Gates</h1>
        <div className="game-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={WIDTH * RENDER_SCALE}
            height={HEIGHT * RENDER_SCALE}
            aria-hidden="true"
          />
          <button
            type="button"
            ref={menuTriggerRef}
            className="touch-hud-menu-trigger"
            onClick={openHarborMenu}
            title="Open Harbor Menu"
            aria-haspopup="dialog"
            aria-label={`Open harbor menu. Tide ${game.tide}, gate ${game.harbor} of ${game.maxHarbor}, ${game.kleos} Kleos.`}
          />
          <p id="board-instructions" className="sr-only">
            Swipe a piece toward an adjacent square, or select it and then an adjacent highlighted
            square. Use arrow keys to move between cells, then Enter or Space to select.
            Escape clears the selection. P pauses the game and opens the menu.
            Swipe floating cargo toward an empty shore square, or use the same two-tap method.
          </p>
          <div
            ref={boardControlsRef}
            className="board-controls"
            role="group"
            aria-label="Harbor construction board"
            aria-describedby="board-instructions"
          >
            {Array.from({ length: BOARD_ROWS }, (_, row) =>
              Array.from({ length: BOARD_COLS }, (_, col) => {
                const waterChannel = channelForWaterCol(col);
                const cargo = waterChannel === null
                  ? undefined
                  : game.cargo.find((item) => item.row === row && item.channel === waterChannel);
                const selectedLand =
                  game.selection?.kind === "land" &&
                  game.selection.row === row &&
                  game.selection.col === col;
                const selectedCargo =
                  game.selection?.kind === "cargo" &&
                  cargo?.id === game.selection.id;
                const selected = selectedLand || selectedCargo;
                const legalTarget = isLegalLandTarget(game, row, col);
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    className="board-cell-control"
                    aria-label={`${cellLabel(game, row, col)}${legalTarget ? ", legal target" : ""}`}
                    aria-pressed={selected}
                    data-legal-target={legalTarget || undefined}
                    data-opening-piece={openingHint && row === 3 && col < 2 ? (col === 0 ? "source" : "target") : undefined}
                    data-board-row={row}
                    data-board-col={col}
                    tabIndex={
                      game.phase === "planning" &&
                      rovingCell.row === row && rovingCell.col === col
                        ? 0
                        : -1
                    }
                    disabled={game.phase !== "planning" || (isWaterCol(col) && !cargo)}
                    onFocus={() => setFocusedCell({ row, col })}
                    onKeyDown={(event) => handleCellKeyDown(event, row, col)}
                    onPointerDown={(event) => handleCellPointerDown(event, row, col)}
                    onPointerUp={handleCellPointerUp}
                    onPointerCancel={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                      if (boardPointerRef.current?.pointerId === event.pointerId) boardPointerRef.current = null;
                    }}
                    onLostPointerCapture={(event) => {
                      if (boardPointerRef.current?.pointerId === event.pointerId) {
                        boardPointerRef.current = null;
                      }
                    }}
                    onClick={(event) => {
                      const suppressed = suppressClickRef.current;
                      if (
                        suppressed &&
                        event.detail > 0 &&
                        suppressed.expiresAt >= animationClockSeconds() * 1000 &&
                        suppressed.row === row &&
                        suppressed.col === col
                      ) {
                        suppressClickRef.current = null;
                        return;
                      }
                      if (suppressed) suppressClickRef.current = null;
                      handleCell(row, col, animationClockSeconds());
                    }}
                  />
                );
              }),
            )}
            {bossChannel !== null && (
              <span aria-hidden="true" className="boss-pennant" data-channel={bossChannel}>▲ BOSS</span>
            )}
          </div>
          <div className="game-actions">
            <button
              type="button"
              className="horn-button"
              onClick={primaryAction}
              aria-label={
                game.phase === "planning"
                  ? cargoWarningArmed
                    ? `Confirm departure and leave ${game.cargo.length} cargo at sea.`
                    : `Sound the horn. ${game.actions} moves remain. Unused moves become Kleos if no ship lands.`
                  : game.phase === "gameover"
                    ? "Found a new polis"
                    : `Toggle battle speed. Currently ${battleSpeed} times speed. ${game.ships.filter((ship) => !ship.resolved).length} enemies remain.`
              }
            >
              <span>{buttonLabel}</span>
            </button>
          </div>
        </div>
        {saveStatus === "other-tab" && (
          <div className="game-notice" role="status">Another tab has a newer checkpoint. <button type="button" onClick={() => window.location.reload()}>Resume that run</button></div>
        )}
        {artworkFailed && (
          <div className="game-notice" role="status">
            Some artwork could not load. <button type="button" onClick={() => retryArtworkRef.current()}>Retry artwork</button>
          </div>
        )}
        <div
          ref={desktopToolsRef}
          className="desktop-utility"
          aria-label="Game utilities"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDesktopToolsOpen(false);
            }
          }}
        >
          <button
            type="button"
            className="desktop-utility-toggle"
            aria-expanded={desktopToolsOpen}
            aria-controls="desktop-utility-tray"
            onClick={() => setDesktopToolsOpen((open) => !open)}
            title={desktopToolsOpen ? "Hide game utilities" : "Show game utilities"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
              {desktopToolsOpen ? (
                <path d="M5 5h3v3H5V5Zm11 0h3v3h-3V5ZM9 9h6v6H9V9Zm-4 7h3v3H5v-3Zm11 0h3v3h-3v-3Z" />
              ) : (
                <path d="M4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z" />
              )}
            </svg>
            <span className="sr-only">{desktopToolsOpen ? "Hide" : "Show"} game utilities</span>
          </button>
          {desktopToolsOpen && (
            <div id="desktop-utility-tray" className="desktop-utility-tray">
              <button
                type="button"
                className="desktop-tool-button"
                onClick={openAccountPanel}
                aria-label={deviceOnly ? "Open harbor records" : "Open account and records"}
                title={deviceOnly ? "Harbor records" : "Account and records"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
                  <path d="M8 3h8v3h3v7h-3v3h-2v2h5v3H5v-3h5v-2H8v-3H5V6h3V3Zm1 3H7v6h2V6Zm8 0h-2v6h2V6Zm-6 0v7h2V6h-2Z" />
                </svg>
              </button>
              <button
                type="button"
                className="desktop-tool-button"
                onClick={openRulesPanel}
                aria-label="Open builder's scroll"
                title="Builder's scroll"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
                  <path d="M5 3h14v3h2v4h-3V7H7v10h10v-3h3v5h-2v2H5V3Zm4 6h6v2H9V9Zm0 4h6v2H9v-2Z" />
                </svg>
              </button>
              <button
                type="button"
                className="desktop-tool-button"
                onClick={() => {
                  toggleMuted();
                  setDesktopToolsOpen(false);
                }}
                aria-pressed={isMuted}
                aria-label={isMuted ? "Unmute ambient drone" : "Mute ambient drone"}
                title={isMuted ? "Unmute ambient drone" : "Mute ambient drone"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
                  <path d="M3 9h4l5-4v14l-5-4H3V9Z" />
                  {isMuted ? (
                    <path d="M15 7h2v3h2V7h2v3h-2v3h2v3h-2v-3h-2v3h-2v-3h2v-3h-2V7Z" />
                  ) : (
                    <path d="M15 9h2v6h-2V9Zm4-2h2v10h-2V7Z" />
                  )}
                </svg>
              </button>
              <button
                type="button"
                className="desktop-tool-button"
                data-armed={resetArmed || undefined}
                onClick={() => {
                  if (resetArmed) beginNewRun();
                  else setResetArmed(true);
                }}
                aria-label={resetArmed ? "Confirm new run" : "Prepare a new run"}
                title={resetArmed ? "Confirm new run" : "New run"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
                  {resetArmed ? (
                    <path d="M10 3h4v13h-4V3Zm0 16h4v4h-4v-4Z" />
                  ) : (
                    <path d="M8 3H3v5h3V6h6c3.9 0 7 3.1 7 7s-3.1 7-7 7c-3.2 0-5.9-2.1-6.7-5H2.2c.9 4.6 4.9 8 9.8 8 5.5 0 10-4.5 10-10S17.5 3 12 3H8Z" />
                  )}
                </svg>
              </button>
            </div>
          )}
        </div>
        <Dialog
          open={openPanel !== null}
          onOpenChange={(open) => {
            if (!open) changeOpenPanel(null);
          }}
        >
          <DialogContent
            ref={dialogRef}
            className="game-dialog"
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const opener = panelOpenerRef.current;
              const target = opener?.isConnected && opener !== document.body && !opener.matches(":disabled")
                ? opener : menuTriggerRef.current;
              target?.focus({ preventScroll: true });
            }}
          >
            <div className="dialog-sticky-bar">
              {openPanel && openPanel !== "menu" && (
                <button type="button" className="harbor-back-button" onClick={() => changeOpenPanel("menu")}>‹ Harbor menu</button>
              )}
              <DialogClose asChild>
                <button type="button" className="dialog-close-button" aria-label="Close menu">
                  ×
                </button>
              </DialogClose>
            </div>
            {openPanel === "menu" ? (
              <>
                <DialogHeader className="game-dialog-header compact-dialog-header">
                  <DialogTitle>Harbor Menu</DialogTitle>
                  <DialogDescription>Take your time. Nothing moves while this menu is open.</DialogDescription>
                </DialogHeader>
                {saveStatus === "unavailable" && <p className="records-message" role="status">This browser could not save your run. Keep this page open to continue playing.</p>}
                {saveStatus === "saved" && recoveredRun && <p className="records-message" role="status">Your previous checkpoint was recovered. You can continue this run.</p>}
                <nav className="harbor-menu-list" aria-label="Harbor menu">
                  <button type="button" className="resume-menu-row" onClick={() => changeOpenPanel(null)}>
                    <span>
                      <strong>{game.phase === "battle" ? "Resume Battle" : "Back to the Harbor"}</strong>
                      <small>Tide {game.tide} · Gate {game.harbor}/{game.maxHarbor}</small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </button>
                  {game.phase === "planning" && (
                    <button type="button" onClick={() => changeOpenPanel("forecast")}>
                      <span><strong>Scout Tide {game.tide}</strong><small>See each channel&apos;s enemies before the horn</small></span>
                      <b aria-hidden="true">›</b>
                    </button>
                  )}
                  <button type="button" onClick={openRulesPanel}>
                    <span>
                      <strong>Builder&apos;s Scroll</strong>
                      <small>Recipes, machines and rules</small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </button>
                  {game.phase === "planning" && (
                    <button type="button" disabled={undoCount === 0} onClick={() => {
                      undoLastMove();
                      changeOpenPanel(null);
                    }}>
                      <span>
                        <strong>Undo Last Move</strong>
                        <small>{undoCount ? "Restore the pieces and the spent move" : "No moves to undo this Tide"}</small>
                      </span>
                      <b aria-hidden="true">↶</b>
                    </button>
                  )}
                  <button type="button" onClick={openAccountPanel}>
                    <span>
                      <strong>{deviceOnly ? "Harbor Records" : <>Account &amp; Records</>}</strong>
                      <small>{deviceOnly ? "Your best and recent voyages on this device" :
                        initialAccount ? initialAccount.displayName : "Sign in or view the records wall"}</small>
                    </span>
                    <b aria-hidden="true">›</b>
                  </button>
                  <button type="button" onClick={toggleMuted} aria-pressed={isMuted}>
                    <span>
                      <strong>Ambient Drone</strong>
                      <small>The quiet monotone background track</small>
                    </span>
                    <em>{isMuted ? "Muted" : "On"}</em>
                  </button>
                  <button
                    type="button"
                    className="new-run-menu-row"
                    data-armed={resetArmed || undefined}
                    onClick={() => {
                      if (resetArmed) beginNewRun();
                      else setResetArmed(true);
                    }}
                  >
                    <span>
                      <strong>{resetArmed ? "Confirm New Run" : "New Run"}</strong>
                      <small>{resetArmed ? "Tap once more; the current run will be replaced" : "Restart from Tide 1"}</small>
                    </span>
                    <b aria-hidden="true">{resetArmed ? "!" : "↻"}</b>
                  </button>
                </nav>
              </>
            ) : openPanel === "forecast" ? (
              <>
                <DialogHeader className="game-dialog-header">
                  <DialogTitle>Scout Tide {game.tide}</DialogTitle>
                  <DialogDescription>
                    {waveTitle(game.tide)}. These are the enemies you will face, in sailing order. Your moves and a reload keep this forecast.
                  </DialogDescription>
                </DialogHeader>
                {bossChannel !== null && <p className="scout-tip"><strong>Boss from the {bossChannel === 0 ? "west" : "east"}.</strong> Place your Arm and artillery in that channel before sounding the horn. Only the first Arm can pull this boss.</p>}
                {scoutedFleet.some(ship => ship.screening) && <p className="scout-tip"><strong>Aegis Galley sighted.</strong> Nearby escorts gain armor against Catapult hits. Awe the galley to break its screen, or burn the formation with a Siphon.</p>}
                <p className="scout-tip">An Arm captures ships with Mass up to its tier. Against heavier hulls, combine it with artillery.</p>
                {([0, 1] as const).map(channel => {
                  const fleet = scoutedFleet.filter(ship => ship.channel === channel).sort((a, b) => a.spawnAt - b.spawnAt);
                  return (
                    <section className="scout-channel" key={channel}>
                      <h3>{channel === 0 ? "West" : "East"} channel · {fleet.length} enemies</h3>
                      {fleet.length ? (
                        <table>
                          <thead><tr><th scope="col">Enemy</th><th scope="col">HP</th><th scope="col">Armor</th><th scope="col">Mass</th></tr></thead>
                          <tbody>{fleet.map(ship => (
                            <tr key={ship.id}>
                              <th scope="row">{ship.name}<small>Arrives at {ship.spawnAt.toFixed(1)}s{ship.boss ? " · One pull only" : ship.screening ? " · Screens allies" : ""}</small>{ship.cargo && <small>Cargo · {MATERIAL_LABELS[ship.cargo]}</small>}</th>
                              <td>{ship.maxHp}</td><td>{ship.plates ?? ship.shield}</td><td>{ship.mass}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      ) : <p>Clear water.</p>}
                    </section>
                  );
                })}
                <p className="scout-tip">Next Dawn, from west bank to east bank: {dawnSupplyPreview(game.tide, game.runSeed).map(material => MATERIAL_LABELS[material]).join(" · ")}.</p>
              </>
            ) : openPanel === "rules" ? (
              <>
                <DialogHeader className="game-dialog-header">
                  <DialogTitle>Builder&apos;s Scroll</DialogTitle>
                  <DialogDescription>
                    Build on the square you move into. Join two machines of the same kind and tier to upgrade.
                  </DialogDescription>
                </DialogHeader>
                <p className="scout-tip manual-opening"><strong>First Tide.</strong> On the left bank, tap the limestone and then the timber beside it, or swipe right from the limestone. Your Catapult faces the western approach. Sound the horn when you are ready.</p>
                <div className="recipe-list" aria-label="Construction recipes">
                  <div className="recipe-row">
                    <span className="material-token stone-token">Stone</span>
                    <b>+</b>
                    <span className="material-token timber-token">Timber</span>
                    <span className="recipe-arrow">›</span>
                    <strong>Catapult</strong>
                  </div>
                  <div className="recipe-row">
                    <span className="material-token timber-token">Timber</span>
                    <b>+</b>
                    <span className="material-token bronze-token">Bronze</span>
                    <span className="recipe-arrow">›</span>
                    <strong>Archimedean Arm</strong>
                  </div>
                  <div className="recipe-row">
                    <span className="material-token bronze-token">Bronze</span>
                    <b>+</b>
                    <span className="material-token wine-token">Wine</span>
                    <span className="recipe-arrow">›</span>
                    <strong>Automaton</strong>
                  </div>
                  <div className="recipe-row">
                    <span className="material-token stone-token">Stone</span>
                    <b>+</b>
                    <span className="material-token wine-token">Wine</span>
                    <span className="recipe-arrow">›</span>
                    <strong>Fire Siphon</strong>
                  </div>
                </div>
                <section className="machine-manual" aria-label="Machine mechanics">
                  <article className="machine-manual-card catapult-manual">
                    <header>
                      <h3>Stone Catapult</h3>
                      <span>Artillery</span>
                    </header>
                    <p>
                      Fires into its own channel. Saves the gate from imminent arrivals,
                      then prefers armored or heavy targets.
                      Higher tiers hit harder, reload faster, reach farther, and pierce armor.
                      Tier III also splashes 2 damage onto a nearby hull.
                    </p>
                    <div className="machine-stat-line" aria-label="Catapult damage by tier">
                      <b>I · 4 damage</b><b>II · 6 damage</b><b>III · 9 damage</b>
                    </div>
                    <small className="machine-detail-line">
                      Range 2.1 / 3.1 / whole channel · Reload 2.2 / 2.0 / 1.8 sec · Pierce 0 / 1 / 2
                    </small>
                  </article>
                  <article className="machine-manual-card arm-manual">
                    <header>
                      <h3>Archimedean Arm</h3>
                      <span>Capture</span>
                    </header>
                    <p>
                      Works from any land row and faces the nearest channel. When a ship
                      crosses that row, Lift equal to its tier seizes a ship of equal or
                      lower Mass whole, preserving cargo and earning extra Kleos. A ship
                      that is too heavy is still damaged and shoved seaward. A boss can be
                      pulled only once in its entire battle: 18 / 27 / 36% of its
                      current life, according to the first Arm&apos;s tier. It then breaks
                      the chain and resists every Arm. Finish it with Catapult fire.
                    </p>
                    <div className="machine-stat-line" aria-label="Archimedean Arm lift by tier">
                      <b>I · 1 Lift</b><b>II · 2 Lift</b><b>III · 3 Lift</b>
                    </div>
                    <small className="machine-detail-line">
                      Reload 7 / 6 / 5 sec · Heavy hull damage 2 / 4 / 7 · One boss pull · 18 / 27 / 36%
                    </small>
                  </article>
                  <article className="machine-manual-card automaton-manual">
                    <header>
                      <h3>Dionysian Automaton</h3>
                      <span>Control</span>
                    </header>
                    <p>
                      Spills wine to awe enemies in range: ships crawl, bosses resist most of the slow,
                      and armor opens for Catapult fire, though Spartoi retain 1 armor.
                      It also hastens adjacent machines. Tier III on either inner shore
                      can reach both channels. From Tide 15, veteran hulls arrive;
                      later ranks gain Mass and resist wine and wrenching. Keep
                      expanding and upgrading your defense.
                    </p>
                    <div className="machine-stat-line" aria-label="Automaton targets by tier">
                      <b>I · 1 target</b><b>II · 2 targets</b><b>III · 3 targets</b>
                    </div>
                    <small className="machine-detail-line">
                      Awe 2.4 / 2.7 / 3.0 sec · Radius 1.90 / 2.25 / 2.65 rows · Reload 3.8 / 3.4 / 3.0 sec
                    </small>
                  </article>
                  <article className="machine-manual-card siphon-manual">
                    <header><h3>Fire Siphon</h3><span>Close defense</span></header>
                    <p>Burns a tight group in its own channel. Fire ignores hull armor and the Aegis Galley’s screen. Pair it with an Automaton to hold ships within reach.</p>
                    <div className="machine-stat-line" aria-label="Fire Siphon damage per target by tier">
                      <b>I · 2 damage</b><b>II · 3 damage</b><b>III · 5 damage</b>
                    </div>
                    <small className="machine-detail-line">Hits up to 2 / 3 / 4 ships · Range 1.2 / 1.4 / 1.6 rows</small>
                  </article>
                </section>
                <ol className="rule-list">
                  <li>Swipe a piece one square, or tap two adjacent land squares, to swap.</li>
                  <li>The forecast gives West/East threats and shows each bank&apos;s next supply.</li>
                  <li>Open Scout Tide from the Harbor Menu to see the exact fleet before the horn. Each run varies the hulls, sailing order and cargo.</li>
                  <li>After the opening, supplies are shuffled in bags. Each bank receives all four materials over four Dawns. The forecast always shows its next delivery.</li>
                  <li>Enemies pass each other freely: slowing a monster cannot stop its escorts. After Tide 10, fleets attack in several groups, hulls strengthen every Tide, and veterans gain armor and Mass. Tide 50 demands a deeply upgraded defense.</li>
                  <li>Swipe one recipe material onto its partner to build in the destination square.</li>
                  <li>Join two identical machines of the same tier to upgrade.</li>
                  <li>Undo a planning move from the Harbor Menu, or press Ctrl / ⌘ Z. Moves cannot be undone after the horn.</li>
                  <li>Swipe cargo ashore, or tap it then an adjacent empty shore square.</li>
                  <li>Automata awe first, Catapults and Siphons fire, Arms seize, then surviving ships advance.</li>
                  <li>The boss pennant marks the threatened channel for the whole planning turn. Aegis Galleys can sail from Tide 12 and add 2 armor against direct Catapult hits to nearby non-boss allies. Awe or grapple the galley to interrupt its protection.</li>
                  <li>On a keyboard, use the arrow keys to move around the board, Enter or Space to choose a square, Escape to clear a selection and P to open the menu.</li>
                  <li>During battle, tap the large Defend button to switch between 1× and 2×.</li>
                  <li>Opening a menu or leaving the page pauses battle. Return and choose Resume Battle.</li>
                  <li>Your run saves on this device when browser storage is available.</li>
                  <li>A full bank sends its Dawn delivery to another bank with room.</li>
                  <li>Any cargo left in the channels sinks when the next battle begins.</li>
                  <li>Each unused move earns 8 Kleos if no enemy lands that Tide.</li>
                </ol>
              </>
            ) : openPanel === "account" && deviceOnly ? (
              <>
                <DialogHeader className="game-dialog-header">
                  <DialogTitle>Harbor Records</DialogTitle>
                  <DialogDescription>Your best voyage is the one that earned the most Kleos. Records stay in this browser.</DialogDescription>
                </DialogHeader>
                <section className="account-card" aria-label="Local voyage records">
                  {deviceRecords?.best ? (
                    <>
                      <h3>Best voyage</h3>
                      <div className="account-stats">
                        <div><b>{deviceRecords.best.tide}</b><span>Tide</span></div>
                        <div><b>{deviceRecords.best.kleos}</b><span>Kleos</span></div>
                        <div><b>{deviceRecords.best.captures}</b><span>Captures</span></div>
                        <div><b>{deviceRecords.runs}</b><span>Voyages</span></div>
                      </div>
                      <div className="recent-runs">
                        <h3>Recent voyages</h3>
                        {deviceRecords.recent.map((run) => (
                          <p key={run.runKey}>Tide {run.tide} · {run.kleos} K · {run.captures} captured</p>
                        ))}
                      </div>
                    </>
                  ) : <p className="records-message">Finish a voyage to inscribe your first record.</p>}
                  {deviceRecords && !deviceRecords.persistent && (
                    <p className="records-message">Storage is unavailable. Records will last for this visit.</p>
                  )}
                </section>
              </>
            ) : openPanel === "account" ? (
              <>
                <DialogHeader className="game-dialog-header">
                  <DialogTitle>Account &amp; Records</DialogTitle>
                  <DialogDescription>
                    Every account keeps its best complete run on the public records wall.
                  </DialogDescription>
                </DialogHeader>

                {initialAccount ? (
                  <section className="account-card" aria-label="Your game account">
                    {scoreStatus !== "idle" && (
                      <p className="records-message" role="status">
                        {scoreStatus === "pending"
                          ? "Your score is waiting to sync. It retries when you reconnect."
                          : "Your completed runs are recorded."}
                      </p>
                    )}
                    <div className="account-heading">
                      <span className="account-sigil" aria-hidden="true">Ω</span>
                      <div>
                        <small>Signed in as {initialAccount.displayName}</small>
                        <strong>
                          {accountRecord?.displayName ?? (accountError ? "Record unavailable" : "Preparing your inscription…")}
                        </strong>
                      </div>
                    </div>
                    {accountError && <p className="records-message">{accountError}</p>}
                    {accountRecord && (
                      <>
                        <div className="account-stats">
                          <div><b>{accountRecord.best?.tide ?? 0}</b><span>Best Tide</span></div>
                          <div><b>{accountRecord.best?.kleos ?? 0}</b><span>Best Kleos</span></div>
                          <div><b>{accountRecord.best?.captures ?? 0}</b><span>Captures</span></div>
                          <div><b>{accountRecord.runs}</b><span>Runs</span></div>
                        </div>
                        {accountRecord.recentRuns.length > 0 && (
                          <div className="recent-runs">
                            <h3>Recent inscriptions</h3>
                            {accountRecord.recentRuns.slice(0, 3).map((run, index) => (
                              <p key={`${run.created_at}-${index}`}>
                                Tide {run.tide} · {run.kleos} K · {run.captures} captured
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <a className="quiet-auth-link" href={signOutHref} target="_top">
                      Sign out
                    </a>
                  </section>
                ) : (
                  <section className="account-callout" aria-label="Create an account">
                    <span className="account-sigil" aria-hidden="true">Ω</span>
                    <p>Keep your best Tide, Kleos and captures across devices.</p>
                    <a className="account-auth-button" href={signInHref} target="_top">
                      Create / Sign In
                    </a>
                    <small>Uses ChatGPT sign-in. No separate password.</small>
                  </section>
                )}

                <section className="records-wall" aria-labelledby="records-title">
                  <div className="records-heading">
                    <h3 id="records-title">Records Wall</h3>
                    <button type="button" onClick={() => void loadRecords()} disabled={recordsLoading}>
                      {recordsLoading ? "…" : "↻"}
                      <span className="sr-only">Refresh records</span>
                    </button>
                  </div>
                  {recordsError && <p className="records-message">{recordsError}</p>}
                  {leaderboard.length > 0 ? (
                    <div className="score-table" role="table" aria-label="Leaderboard">
                      <div className="score-row score-head" role="row">
                        <span role="columnheader">#</span>
                        <span role="columnheader">Strategos</span>
                        <span role="columnheader">Tide</span>
                        <span role="columnheader">Kleos</span>
                      </div>
                      {leaderboard.map((entry) => (
                        <div className="score-row" role="row" key={`${entry.rank}-${entry.displayName}`}>
                          <span role="cell">{entry.rank}</span>
                          <span role="cell">
                            <b>{entry.displayName}</b>
                            <small>{entry.captures} captured · {entry.runs} runs</small>
                          </span>
                          <span role="cell">{entry.tide}</span>
                          <span role="cell">{entry.kleos}</span>
                        </div>
                      ))}
                    </div>
                  ) : !recordsError ? (
                    <p className="records-message">
                      {recordsLoading ? "Reading the inscriptions…" : "No deeds have been inscribed yet."}
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          Tide {game.tide}. Gate {game.harbor} of {game.maxHarbor}. {game.kleos} Kleos.
          {game.phase === "planning"
            ? ` ${game.actions} moves. ${wavePreview(game.tide, game.runSeed)}. Next Dawn: ${dawnSupplyPreview(game.tide, game.runSeed).map((material) => MATERIAL_LABELS[material]).join(", ")}.`
            : ` ${game.ships.filter((ship) => !ship.resolved).length} enemies remain.`}
          {` ${game.message}`}
        </p>
      </section>
    </main>
  );
}
