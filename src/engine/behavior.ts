import {
  AIR,
  BLOCKS,
  BROWN_MUSHROOM,
  CACTUS,
  DEAD_BUSH,
  DIRT,
  FARMLAND,
  GRASS_BLOCK,
  LADDER,
  OPAQUE,
  RED_MUSHROOM,
  SAND,
  SNOW_LAYER,
  SUGAR_CANE,
  TORCH,
  WATER,
  WHEAT,
  blockMeta,
  blockType,
  getBlock,
} from './blocks';
import { FACE_DX, FACE_DZ, Face } from './facing';

/** Minimal read access used by block rules. */
export interface BlockReader {
  getBlock(x: number, y: number, z: number): number;
}

const SOIL = new Set([GRASS_BLOCK, DIRT, FARMLAND]);

/** Wall direction for torch meta 1..4 / ladder meta 0..3 (S, W, N, E). */
export const WALL_FACES = [Face.South, Face.West, Face.North, Face.East] as const;

function supportedByOpaque(r: BlockReader, x: number, y: number, z: number): boolean {
  return OPAQUE[blockType(r.getBlock(x, y, z))] === 1;
}

/**
 * Whether the block `value` can stay at (x, y, z). Used when placing and whenever a neighbour
 * changes (plants pop off when their soil is removed, torches when their wall is removed...).
 */
export function canSurvive(r: BlockReader, x: number, y: number, z: number, value: number): boolean {
  const type = blockType(value);
  const def = getBlock(type);
  const below = blockType(r.getBlock(x, y - 1, z));
  switch (type) {
    case TORCH: {
      const meta = blockMeta(value);
      if (meta === 0) return OPAQUE[below] === 1;
      const f = WALL_FACES[(meta - 1) & 3];
      return supportedByOpaque(r, x + FACE_DX[f], y, z + FACE_DZ[f]);
    }
    case LADDER: {
      const f = WALL_FACES[blockMeta(value) & 3];
      return supportedByOpaque(r, x + FACE_DX[f], y, z + FACE_DZ[f]);
    }
    case SNOW_LAYER:
      return OPAQUE[below] === 1 || BLOCKS[below]?.layer === 'cutout';
    case CACTUS: {
      if (below !== CACTUS && below !== SAND) return false;
      for (const f of [Face.East, Face.West, Face.South, Face.North]) {
        const n = blockType(r.getBlock(x + FACE_DX[f], y, z + FACE_DZ[f]));
        if (getBlock(n).solid) return false;
      }
      return true;
    }
    case SUGAR_CANE: {
      if (below === SUGAR_CANE) return true;
      if (!SOIL.has(below) && below !== SAND) return false;
      for (const f of [Face.East, Face.West, Face.South, Face.North]) {
        if (blockType(r.getBlock(x + FACE_DX[f], y - 1, z + FACE_DZ[f])) === WATER) return true;
      }
      return false;
    }
    case WHEAT:
      return below === FARMLAND;
    case DEAD_BUSH:
      return below === SAND || SOIL.has(below);
    case BROWN_MUSHROOM:
    case RED_MUSHROOM:
      return OPAQUE[below] === 1;
    default:
      if (def.shape === 'cross') return SOIL.has(below);
      return true;
  }
}

/** Value to leave behind when a block breaks (water flows back in later phases). */
export function afterBreak(): number {
  return AIR;
}
