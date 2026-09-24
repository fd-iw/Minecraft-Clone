import { placeTree, type TreeKind } from './worldgen/features';
import { Rng } from '../shared/rng';
import {
  AIR,
  BIRCH_LEAVES,
  BIRCH_LOG,
  BIRCH_SAPLING,
  CACTUS,
  DIRT,
  GRASS_BLOCK,
  GRAVEL,
  ICE,
  LIGHT_OPACITY,
  OAK_LEAVES,
  OAK_LOG,
  OAK_SAPLING,
  OPAQUE,
  SAND,
  SNOW_LAYER,
  SPRUCE_LEAVES,
  SPRUCE_LOG,
  SPRUCE_SAPLING,
  SUGAR_CANE,
  WATER,
  blockMeta,
  blockType,
  getBlock,
  makeBlock,
} from './blocks';
import { canSurvive } from './behavior';
import { WORLD_HEIGHT } from './constants';
import { isFluid, updateFluid, type FluidWorld } from './fluids';

/** World access needed by block tick handlers. */
export interface TickWorld extends FluidWorld {
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  isLoaded(x: number, z: number): boolean;
}

export const LEAVES = new Set([OAK_LEAVES, SPRUCE_LEAVES, BIRCH_LEAVES]);
const LOGS = new Set([OAK_LOG, SPRUCE_LOG, BIRCH_LOG]);
/** Leaves placed by a player carry this meta bit and never decay. */
export const PERSISTENT_LEAVES = 8;

export const GRAVITY_BLOCKS = new Set([SAND, GRAVEL]);
export const FALL_DELAY = 2;

/** Whether a falling block can drop into the cell holding `v`. */
export function canFallInto(v: number): boolean {
  const t = blockType(v);
  if (t === AIR || isFluid(t)) return true;
  const def = getBlock(t);
  return def.replaceable && !def.solid;
}

/** Scheduled tick dispatch. */
export function scheduledTick(w: TickWorld, x: number, y: number, z: number): void {
  const v = w.getBlock(x, y, z);
  const t = blockType(v);
  if (isFluid(t)) {
    updateFluid(w, x, y, z);
    return;
  }
  if (GRAVITY_BLOCKS.has(t)) {
    if (y <= 0 || !canFallInto(w.getBlock(x, y - 1, z))) return;
    let ty = y - 1;
    while (ty > 0 && canFallInto(w.getBlock(x, ty - 1, z))) ty--;
    w.setBlock(x, y, z, AIR, 'update');
    w.setBlock(x, ty, z, v, 'update');
  }
}

/** Called for blocks adjacent to a change: schedules fluid and gravity updates. */
export function neighbourChanged(w: TickWorld, x: number, y: number, z: number, v: number): void {
  const t = blockType(v);
  if (isFluid(t)) w.scheduleTick(x, y, z, t === WATER ? 5 : 30);
  else if (GRAVITY_BLOCKS.has(t) && y > 0 && canFallInto(w.getBlock(x, y - 1, z)))
    w.scheduleTick(x, y, z, FALL_DELAY);
}

function lightAbove(w: TickWorld, x: number, y: number, z: number): number {
  return Math.max(w.getSkyLight(x, y + 1, z), w.getBlockLight(x, y + 1, z));
}

/** True if a log is reachable from leaves at (x, y, z) through leaves within `radius` steps. */
function connectedToLog(w: TickWorld, x: number, y: number, z: number, radius: number): boolean {
  const seen = new Set<number>();
  let frontier: [number, number, number][] = [[x, y, z]];
  const key = (a: number, b: number, c: number): number =>
    ((a - x + 8) * 32 + (b - y + 8)) * 32 + (c - z + 8);
  seen.add(key(x, y, z));
  for (let d = 0; d < radius && frontier.length; d++) {
    const next: [number, number, number][] = [];
    for (const [cx, cy, cz] of frontier) {
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        const k = key(nx, ny, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        // Unknown terrain might hold the trunk: never decay against an unloaded chunk.
        if (!w.isLoaded(nx, nz)) return true;
        const t = blockType(w.getBlock(nx, ny, nz));
        if (LOGS.has(t)) return true;
        if (LEAVES.has(t)) next.push([nx, ny, nz]);
      }
    }
    frontier = next;
  }
  return false;
}

const SAPLING_TREE: Record<number, TreeKind> = {
  [OAK_SAPLING]: 'oak',
  [SPRUCE_SAPLING]: 'spruce',
  [BIRCH_SAPLING]: 'birch',
};

/** Random tick dispatch: slow environmental changes (grass spread, decay, growth, melting). */
export function randomTick(w: TickWorld, x: number, y: number, z: number, rng: Rng): void {
  const v = w.getBlock(x, y, z);
  const t = blockType(v);
  switch (t) {
    case GRASS_BLOCK: {
      const above = blockType(w.getBlock(x, y + 1, z));
      if (lightAbove(w, x, y, z) < 4 && LIGHT_OPACITY[above] > 2) {
        w.setBlock(x, y, z, makeBlock(DIRT), 'update');
        return;
      }
      if (lightAbove(w, x, y, z) >= 9) {
        for (let i = 0; i < 4; i++) {
          const nx = x + rng.int(3) - 1;
          const ny = y + rng.int(5) - 3;
          const nz = z + rng.int(3) - 1;
          if (!w.isLoaded(nx, nz) || ny < 0 || ny >= WORLD_HEIGHT - 1) continue;
          if (blockType(w.getBlock(nx, ny, nz)) !== DIRT) continue;
          const na = blockType(w.getBlock(nx, ny + 1, nz));
          if (lightAbove(w, nx, ny, nz) >= 4 && LIGHT_OPACITY[na] <= 2)
            w.setBlock(nx, ny, nz, makeBlock(GRASS_BLOCK), 'update');
        }
      }
      return;
    }
    case OAK_LEAVES:
    case SPRUCE_LEAVES:
    case BIRCH_LEAVES:
      if (blockMeta(v) & PERSISTENT_LEAVES) return;
      if (!connectedToLog(w, x, y, z, 4)) w.setBlock(x, y, z, AIR, 'update');
      return;
    case OAK_SAPLING:
    case SPRUCE_SAPLING:
    case BIRCH_SAPLING: {
      if (lightAbove(w, x, y, z) < 9 || !rng.chance(1 / 7)) return;
      const kind = SAPLING_TREE[t];
      // Needs room to grow.
      for (let dy = 1; dy <= 6; dy++) if (OPAQUE[blockType(w.getBlock(x, y + dy, z))]) return;
      w.setBlock(x, y, z, AIR, 'update');
      placeTree(kind, x, y, z, rng, (px, py, pz, val, overwrite) => {
        if (py < 0 || py >= WORLD_HEIGHT || !w.isLoaded(px, pz)) return;
        const cur = blockType(w.getBlock(px, py, pz));
        if (cur !== AIR && !LEAVES.has(cur) && !getBlock(cur).replaceable) return;
        if (!overwrite && cur !== AIR && !getBlock(cur).replaceable) return;
        w.setBlock(px, py, pz, val, 'update');
      });
      if (blockType(w.getBlock(x, y - 1, z)) === GRASS_BLOCK)
        w.setBlock(x, y - 1, z, makeBlock(DIRT), 'update');
      return;
    }
    case SUGAR_CANE:
    case CACTUS: {
      if (blockType(w.getBlock(x, y + 1, z)) !== AIR) return;
      let height = 1;
      while (height < 3 && blockType(w.getBlock(x, y - height, z)) === t) height++;
      if (height >= 3) return;
      const age = blockMeta(v);
      if (age < 15) {
        w.setBlock(x, y, z, makeBlock(t, age + 1), 'update');
        return;
      }
      w.setBlock(x, y, z, makeBlock(t, 0), 'update');
      if (canSurvive(w, x, y + 1, z, makeBlock(t))) w.setBlock(x, y + 1, z, makeBlock(t), 'update');
      return;
    }
    case ICE:
      if (w.getBlockLight(x, y, z) > 11) w.setBlock(x, y, z, makeBlock(WATER), 'update');
      return;
    case SNOW_LAYER:
      if (w.getBlockLight(x, y, z) > 11) w.setBlock(x, y, z, AIR, 'update');
      return;
  }
}

/** Blocks that react to random ticks (used to skip sections cheaply). */
export const RANDOM_TICKING = new Set([
  GRASS_BLOCK,
  OAK_LEAVES,
  SPRUCE_LEAVES,
  BIRCH_LEAVES,
  OAK_SAPLING,
  SPRUCE_SAPLING,
  BIRCH_SAPLING,
  SUGAR_CANE,
  CACTUS,
  ICE,
  SNOW_LAYER,
]);
