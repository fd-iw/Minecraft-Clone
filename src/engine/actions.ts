import { canSurvive } from './behavior';
import {
  AIR,
  BLOCKS,
  CHEST,
  FURNACE,
  LADDER,
  PUMPKIN,
  SNOW_LAYER,
  TORCH,
  blockMeta,
  blockType,
  getBlock,
  makeBlock,
} from './blocks';
import { WORLD_HEIGHT } from './constants';
import { FACE_DX, FACE_DY, FACE_DZ, Face, OPPOSITE_FACE, faceFromYaw } from './facing';
import { ItemStack } from './items';
import { AABB } from './physics/aabb';
import type { RayHit } from './physics/raycast';
import type { Player } from './player';
import { collisionBoxes } from './shapes';
import type { World } from './world';

/** Blocks whose "front" texture should face the player when placed (meta 0..3 = S, W, N, E). */
const FACING_BLOCKS = new Set([FURNACE, CHEST, PUMPKIN]);

/** Wall side (S, W, N, E) -> meta index; used by torches and ladders. */
const WALL_INDEX: Record<number, number> = {
  [Face.South]: 0,
  [Face.West]: 1,
  [Face.North]: 2,
  [Face.East]: 3,
};

/** Front facing meta for a block placed by a player looking along `yaw` (front faces the player). */
export function facingMetaTowardsPlayer(yaw: number): number {
  const look = faceFromYaw(yaw);
  return WALL_INDEX[OPPOSITE_FACE[look]];
}

/**
 * Computes the block value to place for `type` when clicking `face` of a block, or null if
 * the block cannot be placed that way (e.g. a torch on a ceiling).
 */
export function stateForPlacement(type: number, damage: number, face: number, yaw: number): number | null {
  const def = getBlock(type);
  if (def.name.endsWith('_log')) {
    const axis =
      face === Face.East || face === Face.West ? 1 : face === Face.South || face === Face.North ? 2 : 0;
    return makeBlock(type, axis);
  }
  if (type === TORCH) {
    if (face === Face.Down) return null;
    if (face === Face.Up) return makeBlock(TORCH, 0);
    return makeBlock(TORCH, 1 + WALL_INDEX[OPPOSITE_FACE[face]]);
  }
  if (type === LADDER) {
    if (face === Face.Up || face === Face.Down) return null;
    return makeBlock(LADDER, WALL_INDEX[OPPOSITE_FACE[face]]);
  }
  if (FACING_BLOCKS.has(type)) return makeBlock(type, facingMetaTowardsPlayer(yaw));
  if (def.variantMeta) return makeBlock(type, damage);
  return makeBlock(type, 0);
}

export interface PlaceResult {
  x: number;
  y: number;
  z: number;
  value: number;
}

/**
 * Attempts to place the held block against a ray hit. Applies all placement rules (replaceable
 * targets, survival rules, not intersecting the player) and consumes the item in survival.
 */
export function placeBlock(world: World, player: Player, hit: RayHit): PlaceResult | null {
  const stack = player.inventory.held;
  if (!stack) return null;
  const blockId = stack.def?.block;
  if (blockId === undefined) return null;

  const hitType = blockType(hit.value);
  let x = hit.x;
  let y = hit.y;
  let z = hit.z;
  let face = hit.face;

  // Stacking snow layers.
  if (blockId === SNOW_LAYER && hitType === SNOW_LAYER && (blockMeta(hit.value) & 7) < 7) {
    const v = makeBlock(SNOW_LAYER, (blockMeta(hit.value) & 7) + 1);
    if (!world.setBlock(x, y, z, v)) return null;
    consume(player);
    return { x, y, z, value: v };
  }

  if (!getBlock(hitType).replaceable || hitType === blockId) {
    x += FACE_DX[face];
    y += FACE_DY[face];
    z += FACE_DZ[face];
  } else {
    // Replacing e.g. tall grass: behave like clicking the top of the block below.
    face = Face.Up;
  }
  if (y < 0 || y >= WORLD_HEIGHT || !world.isLoaded(x, z)) return null;
  const existing = world.getBlock(x, y, z);
  if (!getBlock(blockType(existing)).replaceable) return null;

  const value = stateForPlacement(blockId, stack.damage, face, player.body.yaw);
  if (value === null) return null;
  if (!canSurvive(world, x, y, z, value)) return null;

  // Don't place a solid block inside the player.
  const pbox = player.body.box();
  for (const b of collisionBoxes(value)) {
    const bb = new AABB(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
    if (bb.intersects(pbox)) return null;
  }

  if (!world.setBlock(x, y, z, value)) return null;
  consume(player);
  return { x, y, z, value };
}

function consume(player: Player): void {
  if (player.gameMode !== 'creative') player.inventory.consume(player.inventory.selected, 1);
}

/** Breaks the targeted block. Returns the removed block value, or null if not allowed. */
export function breakBlock(world: World, player: Player, hit: RayHit): number | null {
  const v = world.getBlock(hit.x, hit.y, hit.z);
  const def = BLOCKS[blockType(v)];
  if (!def || blockType(v) === AIR || def.fluid) return null;
  if (def.hardness < 0 && player.gameMode !== 'creative') return null;
  if (!world.setBlock(hit.x, hit.y, hit.z, AIR)) return null;
  return v;
}

/** Middle-click: selects (or in creative, creates) the targeted block in the hotbar. */
export function pickBlock(player: Player, value: number): void {
  const type = blockType(value);
  const def = getBlock(type);
  if (type === AIR || def.fluid) return;
  const id = def.name === 'lit_furnace' ? FURNACE : type;
  const damage = def.variantMeta ? blockMeta(value) : 0;
  const inv = player.inventory;
  const found = inv.findSlot(id, damage);
  if (found >= 0 && found < 9) {
    inv.selected = found;
    inv.version++;
    return;
  }
  if (player.gameMode !== 'creative') return;
  // Prefer an empty hotbar slot, otherwise replace the selected one.
  let slot = inv.held ? -1 : inv.selected;
  for (let i = 0; i < 9 && slot < 0; i++) if (!inv.slots[i]) slot = i;
  if (slot < 0) slot = inv.selected;
  inv.set(slot, new ItemStack(id, 64, damage));
  inv.selected = slot;
}
