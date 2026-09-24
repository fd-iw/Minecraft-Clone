import { Rng } from '../../shared/rng';
import {
  BIRCH_LEAVES,
  BIRCH_LOG,
  OAK_LEAVES,
  OAK_LOG,
  SPRUCE_LEAVES,
  SPRUCE_LOG,
  makeBlock,
} from '../blocks';

/** Sink for feature blocks; implementations clip to the chunk being generated. */
export type PlaceFn = (x: number, y: number, z: number, value: number, overwriteSolid: boolean) => void;

export type TreeKind = 'oak' | 'birch' | 'spruce' | 'bush';

/** Places a tree with its trunk base at (x, y, z) (the block above the ground). */
export function placeTree(kind: TreeKind, x: number, y: number, z: number, rng: Rng, place: PlaceFn): void {
  switch (kind) {
    case 'oak':
      return roundTree(x, y, z, 4 + rng.int(3), makeBlock(OAK_LOG), makeBlock(OAK_LEAVES), rng, place);
    case 'birch':
      return roundTree(x, y, z, 5 + rng.int(3), makeBlock(BIRCH_LOG), makeBlock(BIRCH_LEAVES), rng, place);
    case 'spruce':
      return coneTree(x, y, z, rng, place);
    case 'bush':
      place(x, y, z, makeBlock(OAK_LOG), true);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = 0; dy <= 1; dy++) {
            if (dy === 1 && Math.abs(dx) + Math.abs(dz) === 2) continue;
            place(x + dx, y + dy, z + dz, makeBlock(OAK_LEAVES), false);
          }
      return;
  }
}

function roundTree(
  x: number,
  y: number,
  z: number,
  trunk: number,
  log: number,
  leaves: number,
  rng: Rng,
  place: PlaceFn,
): void {
  const top = y + trunk;
  for (let ly = top - 3; ly <= top; ly++) {
    const fromTop = top - ly;
    const r = fromTop <= 1 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (fromTop === 0 || rng.chance(0.55))) continue;
        place(x + dx, ly, z + dz, leaves, false);
      }
    }
  }
  for (let i = 0; i < trunk; i++) place(x, y + i, z, log, true);
}

function coneTree(x: number, y: number, z: number, rng: Rng, place: PlaceFn): void {
  const log = makeBlock(SPRUCE_LOG);
  const leaves = makeBlock(SPRUCE_LEAVES);
  const trunk = 6 + rng.int(4);
  const bare = 1 + rng.int(2);
  const top = y + trunk;
  place(x, top + 1, z, leaves, false);
  let r = 0;
  let maxR = 1;
  for (let ly = top; ly >= y + bare; ly--) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        place(x + dx, ly, z + dz, leaves, false);
      }
    }
    if (r >= maxR) {
      r = 1;
      maxR = Math.min(3, maxR + 1);
    } else {
      r++;
    }
  }
  for (let i = 0; i < trunk; i++) place(x, y + i, z, log, true);
}

/**
 * Places an ore vein as a short 3D random walk of roughly `size` blocks. `place` should only
 * replace the host stone.
 */
export function placeVein(
  x: number,
  y: number,
  z: number,
  size: number,
  value: number,
  rng: Rng,
  place: PlaceFn,
): void {
  let px = x;
  let py = y;
  let pz = z;
  for (let i = 0; i < size; i++) {
    place(px, py, pz, value, true);
    const r = rng.int(6);
    if (r === 0) px++;
    else if (r === 1) px--;
    else if (r === 2) py++;
    else if (r === 3) py--;
    else if (r === 4) pz++;
    else pz--;
  }
}
