import { selectionBoxes } from '../shapes';
import { AABB } from './aabb';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** Face that was hit (Face enum). */
  face: number;
  value: number;
  /** Exact hit point. */
  px: number;
  py: number;
  pz: number;
  distance: number;
}

export interface RayWorld {
  getBlock(x: number, y: number, z: number): number;
}

const scratch = new AABB();

/**
 * Voxel traversal (Amanatides & Woo) from (ox, oy, oz) along the normalised direction
 * (dx, dy, dz), testing each visited block's selection boxes for an exact hit.
 */
export function raycast(
  world: RayWorld,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): RayHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;

  let t = 0;
  for (let guard = 0; guard < 1024 && t <= maxDist; guard++) {
    const value = world.getBlock(x, y, z);
    if (value !== 0) {
      let best: RayHit | null = null;
      for (const b of selectionBoxes(value)) {
        scratch.set(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        const hit = scratch.rayIntersect(ox, oy, oz, dx, dy, dz);
        if (hit && hit.t <= maxDist && (!best || hit.t < best.distance)) {
          best = {
            x,
            y,
            z,
            face: hit.face,
            value,
            px: ox + dx * hit.t,
            py: oy + dy * hit.t,
            pz: oz + dz * hit.t,
            distance: hit.t,
          };
        }
      }
      if (best) return best;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
