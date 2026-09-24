import { collisionBoxes } from '../shapes';
import { AABB } from './aabb';

export interface CollisionWorld {
  getBlock(x: number, y: number, z: number): number;
  /** Unloaded columns act as solid walls so nothing falls out of the world while chunks stream. */
  isLoaded(x: number, z: number): boolean;
}

/** Collects collision boxes of all blocks overlapping `region`. */
export function gatherBoxes(world: CollisionWorld, region: AABB, out: AABB[] = []): AABB[] {
  out.length = 0;
  const x0 = Math.floor(region.minX) - 1;
  const y0 = Math.floor(region.minY) - 1;
  const z0 = Math.floor(region.minZ) - 1;
  const x1 = Math.floor(region.maxX) + 1;
  const y1 = Math.floor(region.maxY) + 1;
  const z1 = Math.floor(region.maxZ) + 1;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!world.isLoaded(x, z)) {
        const b = new AABB(x, y0, z, x + 1, y1 + 1, z + 1);
        if (b.intersects(region)) out.push(b);
        continue;
      }
      for (let y = y0; y <= y1; y++) {
        const v = world.getBlock(x, y, z);
        if (v === 0) continue;
        for (const lb of collisionBoxes(v)) {
          const b = new AABB(x + lb[0], y + lb[1], z + lb[2], x + lb[3], y + lb[4], z + lb[5]);
          if (b.intersects(region)) out.push(b);
        }
      }
    }
  }
  return out;
}

export interface MoveResult {
  dx: number;
  dy: number;
  dz: number;
  collidedX: boolean;
  collidedY: boolean;
  collidedZ: boolean;
  onGround: boolean;
}

/**
 * Moves `box` by (dx, dy, dz) against the world, clipping Y first, then X, then Z, with an
 * optional step-up (auto-climb onto slabs/blocks up to `stepHeight` when grounded).
 */
export function moveBox(
  world: CollisionWorld,
  box: AABB,
  dx: number,
  dy: number,
  dz: number,
  stepHeight: number,
  wasOnGround: boolean,
): MoveResult {
  const ox = dx;
  const oy = dy;
  const oz = dz;
  const start = box.clone();
  const boxes = gatherBoxes(world, box.expandTowards(dx, dy, dz));

  for (const b of boxes) dy = b.clipY(box, dy);
  box.offset(0, dy, 0);
  for (const b of boxes) dx = b.clipX(box, dx);
  box.offset(dx, 0, 0);
  for (const b of boxes) dz = b.clipZ(box, dz);
  box.offset(0, 0, dz);

  const landed = oy !== dy && oy < 0;
  let stepped = false;
  if (stepHeight > 0 && (wasOnGround || landed) && (ox !== dx || oz !== dz)) {
    // Retry the move lifted by stepHeight, then settle back down.
    const stepBox = start.clone();
    const stepBoxes = gatherBoxes(world, stepBox.expandTowards(ox, stepHeight, oz));
    let sy = stepHeight;
    for (const b of stepBoxes) sy = b.clipY(stepBox, sy);
    stepBox.offset(0, sy, 0);
    let sx = ox;
    for (const b of stepBoxes) sx = b.clipX(stepBox, sx);
    stepBox.offset(sx, 0, 0);
    let sz = oz;
    for (const b of stepBoxes) sz = b.clipZ(stepBox, sz);
    stepBox.offset(0, 0, sz);
    let down = -sy + (oy < 0 ? oy : 0);
    const downBoxes = gatherBoxes(world, stepBox.expandTowards(0, down, 0));
    for (const b of downBoxes) down = b.clipY(stepBox, down);
    stepBox.offset(0, down, 0);
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-9) {
      box.copy(stepBox);
      dx = sx;
      dz = sz;
      dy = sy + down;
      stepped = true;
    }
  }

  return {
    dx,
    dy,
    dz,
    collidedX: ox !== dx,
    collidedY: oy !== dy,
    collidedZ: oz !== dz,
    onGround: stepped || landed,
  };
}

/** True if any collision box overlaps `box`. */
export function collides(world: CollisionWorld, box: AABB): boolean {
  return gatherBoxes(world, box).length > 0;
}
