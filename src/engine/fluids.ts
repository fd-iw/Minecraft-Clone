import {
  AIR,
  COBBLESTONE,
  LADDER,
  LAVA,
  OBSIDIAN,
  STONE,
  SUGAR_CANE,
  WATER,
  blockMeta,
  blockType,
  getBlock,
  makeBlock,
} from './blocks';
import { WORLD_HEIGHT } from './constants';

/**
 * Fluid rules. A fluid block's meta encodes its level: 0 = source, 1..7 = flowing (distance from
 * the source), 8..15 = falling. Water spreads 7 blocks (drop-off 1) every 5 ticks, lava 3 blocks
 * (drop-off 2) every 30 ticks. Flowing fluid prefers the shortest route to a nearby drop.
 */

export interface FluidWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, value: number, cause: 'update'): boolean;
  scheduleTick(x: number, y: number, z: number, delay: number): void;
}

const HX = [1, -1, 0, 0];
const HZ = [0, 0, 1, -1];
const OPP = [1, 0, 3, 2];

export const isFluid = (type: number): boolean => type === WATER || type === LAVA;
export const tickRate = (type: number): number => (type === WATER ? 5 : 30);
const dropOff = (type: number): number => (type === WATER ? 1 : 2);

/** Blocks that stop fluid entering them. */
function blocksFlow(v: number): boolean {
  const t = blockType(v);
  if (t === AIR) return false;
  if (t === LADDER || t === SUGAR_CANE) return true;
  return getBlock(t).solid;
}

/** Whether fluid of `type` may flow into a cell holding `v` (replacing it). */
function canFlowInto(v: number, type: number): boolean {
  const t = blockType(v);
  if (t === type) return false;
  if (isFluid(t)) return false;
  return !blocksFlow(v);
}

function isSourceOf(v: number, type: number): boolean {
  return blockType(v) === type && blockMeta(v) === 0;
}

/**
 * Lava touching water hardens: a lava source becomes obsidian, shallow flowing lava becomes
 * cobblestone. Returns true if the block was converted.
 */
export function checkMixing(w: FluidWorld, x: number, y: number, z: number): boolean {
  const v = w.getBlock(x, y, z);
  if (blockType(v) !== LAVA) return false;
  let touchesWater = blockType(w.getBlock(x, y + 1, z)) === WATER;
  for (let i = 0; i < 4 && !touchesWater; i++)
    touchesWater = blockType(w.getBlock(x + HX[i], y, z + HZ[i])) === WATER;
  if (!touchesWater) return false;
  const meta = blockMeta(v);
  if (meta === 0) {
    w.setBlock(x, y, z, makeBlock(OBSIDIAN), 'update');
    return true;
  }
  if (meta <= 4) {
    w.setBlock(x, y, z, makeBlock(COBBLESTONE), 'update');
    return true;
  }
  return false;
}

function flowCost(
  w: FluidWorld,
  type: number,
  x: number,
  y: number,
  z: number,
  depth: number,
  from: number,
): number {
  let best = 1000;
  for (let i = 0; i < 4; i++) {
    if (i === from) continue;
    const nx = x + HX[i];
    const nz = z + HZ[i];
    const n = w.getBlock(nx, y, nz);
    if (blocksFlow(n) || isSourceOf(n, type)) continue;
    if (!blocksFlow(w.getBlock(nx, y - 1, nz))) return depth;
    if (depth < 4) {
      const c = flowCost(w, type, nx, y, nz, depth + 1, OPP[i]);
      if (c < best) best = c;
    }
  }
  return best;
}

/** Horizontal directions a fluid should spread in: those leading to the nearest drop. */
function flowDirections(w: FluidWorld, type: number, x: number, y: number, z: number): boolean[] {
  const cost = [1000, 1000, 1000, 1000];
  for (let i = 0; i < 4; i++) {
    const nx = x + HX[i];
    const nz = z + HZ[i];
    const n = w.getBlock(nx, y, nz);
    if (blocksFlow(n) || isSourceOf(n, type)) continue;
    cost[i] = blocksFlow(w.getBlock(nx, y - 1, nz)) ? flowCost(w, type, nx, y, nz, 1, OPP[i]) : 0;
  }
  const min = Math.min(...cost);
  return cost.map((c) => c === min);
}

/** Scheduled update of a fluid block. */
export function updateFluid(w: FluidWorld, x: number, y: number, z: number): void {
  const v = w.getBlock(x, y, z);
  const type = blockType(v);
  if (!isFluid(type)) return;
  if (type === LAVA && checkMixing(w, x, y, z)) return;
  let level = blockMeta(v);
  const drop = dropOff(type);
  const rate = tickRate(type);

  if (level > 0) {
    // Recompute this cell's level from its neighbours; it dries up if nothing feeds it.
    let min = -1;
    let sources = 0;
    for (let i = 0; i < 4; i++) {
      const n = w.getBlock(x + HX[i], y, z + HZ[i]);
      if (blockType(n) !== type) continue;
      const m = blockMeta(n);
      if (m === 0) sources++;
      const eff = m >= 8 ? 0 : m;
      if (min < 0 || eff < min) min = eff;
    }
    let next = min < 0 ? -1 : min + drop;
    if (next >= 8) next = -1;
    const above = w.getBlock(x, y + 1, z);
    if (blockType(above) === type) {
      const am = blockMeta(above);
      next = am >= 8 ? am : am + 8;
    }
    if (sources >= 2 && type === WATER) {
      const below = w.getBlock(x, y - 1, z);
      if (getBlock(blockType(below)).solid || isSourceOf(below, WATER)) next = 0;
    }
    if (next !== level) {
      level = next;
      if (next < 0) {
        w.setBlock(x, y, z, AIR, 'update');
        return;
      }
      w.setBlock(x, y, z, makeBlock(type, next), 'update');
      w.scheduleTick(x, y, z, rate);
    }
  }

  if (y <= 0) return;
  const below = w.getBlock(x, y - 1, z);
  if (type === LAVA && blockType(below) === WATER) {
    w.setBlock(x, y - 1, z, makeBlock(STONE), 'update');
    return;
  }
  if (canFlowInto(below, type)) {
    w.setBlock(x, y - 1, z, makeBlock(type, level >= 8 ? level : level + 8), 'update');
    return;
  }
  if (level === 0 || blocksFlow(below)) {
    const spread = level >= 8 ? 1 : level + drop;
    if (spread >= 8) return;
    const dirs = flowDirections(w, type, x, y, z);
    for (let i = 0; i < 4; i++) {
      if (!dirs[i]) continue;
      const nx = x + HX[i];
      const nz = z + HZ[i];
      const n = w.getBlock(nx, y, nz);
      if (canFlowInto(n, type)) w.setBlock(nx, y, nz, makeBlock(type, spread), 'update');
    }
  }
}

/** Surface height (0..1) of a fluid cell for rendering and physics. */
export function fluidHeight(meta: number): number {
  const eff = meta >= 8 ? 0 : meta;
  return 1 - (eff + 1) / 9;
}

export const FLUID_MAX_Y = WORLD_HEIGHT - 1;
