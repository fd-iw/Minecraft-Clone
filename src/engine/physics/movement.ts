import { ICE, LADDER, LAVA, WATER, blockType } from '../blocks';
import { AABB } from './aabb';
import { gatherBoxes, moveBox, type CollisionWorld } from './collision';

/**
 * Movement constants, in blocks and ticks (20 ticks per second). These reproduce the feel of
 * classic block-game movement: 4.317 m/s walking, 5.612 m/s sprinting, 1.25 block jumps.
 */
export const MOVE = {
  gravity: 0.08,
  verticalDrag: 0.98,
  airFriction: 0.91,
  defaultSlipperiness: 0.6,
  walkSpeed: 0.1,
  sprintMultiplier: 1.3,
  sneakMultiplier: 0.3,
  airAccel: 0.02,
  airAccelSprint: 0.026,
  jumpVelocity: 0.42,
  sprintJumpBoost: 0.2,
  stepHeight: 0.6,
  flyAccel: 0.05,
  flyVertical: 0.15,
  flyDrag: 0.6,
  waterDrag: 0.8,
  waterGravity: 0.02,
  waterAccel: 0.02,
  swimUp: 0.04,
  lavaDrag: 0.5,
  ladderMaxSpeed: 0.15,
  ladderClimb: 0.2,
} as const;

export interface MoveInput {
  /** -1..1, positive = forward. */
  forward: number;
  /** -1..1, positive = right. */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export const NO_INPUT: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

/** Physical state of an entity. Position is at the centre of the bottom face of the box. */
export class Body {
  x = 0;
  y = 0;
  z = 0;
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Radians. 0 looks towards -Z; increases turning left (counter-clockwise from above). */
  yaw = 0;
  pitch = 0;
  onGround = false;
  collidedHorizontally = false;
  collidedVertically = false;
  inWater = false;
  inLava = false;
  onLadder = false;
  fallDistance = 0;
  flying = false;
  noClip = false;

  constructor(
    public width = 0.6,
    public height = 1.8,
  ) {}

  setPosition(x: number, y: number, z: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.z = this.prevZ = z;
  }

  box(out = new AABB()): AABB {
    const hw = this.width / 2;
    return out.set(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw);
  }
}

function slipperinessAt(world: CollisionWorld, body: Body): number {
  const t = blockType(world.getBlock(Math.floor(body.x), Math.floor(body.y - 0.5), Math.floor(body.z)));
  return t === ICE ? 0.98 : MOVE.defaultSlipperiness;
}

/** Adds acceleration in the body's facing frame (strafe right, forward). */
function accelerate(body: Body, strafe: number, forward: number, accel: number): void {
  let len = strafe * strafe + forward * forward;
  if (len < 1e-4) return;
  len = Math.sqrt(len);
  if (len < 1) len = 1;
  const k = accel / len;
  strafe *= k;
  forward *= k;
  const s = Math.sin(body.yaw);
  const c = Math.cos(body.yaw);
  body.vx += strafe * c - forward * s;
  body.vz += -strafe * s - forward * c;
}

function updateFluidState(world: CollisionWorld, body: Body): void {
  const b = body.box();
  // Shrink slightly, as fluids are detected against a contracted box.
  const x0 = Math.floor(b.minX + 0.001);
  const x1 = Math.floor(b.maxX - 0.001);
  const y0 = Math.floor(b.minY + 0.4);
  const y1 = Math.floor(b.maxY - 0.4);
  const z0 = Math.floor(b.minZ + 0.001);
  const z1 = Math.floor(b.maxZ - 0.001);
  let water = false;
  let lava = false;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const t = blockType(world.getBlock(x, y, z));
        if (t === WATER) water = true;
        else if (t === LAVA) lava = true;
      }
  body.inWater = water;
  body.inLava = lava;
  body.onLadder =
    blockType(world.getBlock(Math.floor(body.x), Math.floor(body.y), Math.floor(body.z))) === LADDER;
}

/** Clamps horizontal motion so a sneaking entity doesn't walk off an edge. */
function sneakClamp(world: CollisionWorld, body: Body): void {
  const step = 0.05;
  const test = (dx: number, dz: number): boolean => {
    const b = body.box().offset(dx, -1.0 + 0.4, dz);
    b.minY = body.y - 0.6;
    b.maxY = body.y;
    return gatherBoxes(world, b).length === 0;
  };
  let dx = body.vx;
  let dz = body.vz;
  while (dx !== 0 && test(dx, 0)) {
    if (dx < step && dx >= -step) dx = 0;
    else if (dx > 0) dx -= step;
    else dx += step;
  }
  while (dz !== 0 && test(0, dz)) {
    if (dz < step && dz >= -step) dz = 0;
    else if (dz > 0) dz -= step;
    else dz += step;
  }
  while (dx !== 0 && dz !== 0 && test(dx, dz)) {
    if (dx < step && dx >= -step) dx = 0;
    else if (dx > 0) dx -= step;
    else dx += step;
    if (dz < step && dz >= -step) dz = 0;
    else if (dz > 0) dz -= step;
    else dz += step;
  }
  body.vx = dx;
  body.vz = dz;
}

/** Applies velocity with collision, updating flags. Returns the vertical distance moved. */
export function applyMotion(world: CollisionWorld, body: Body, stepHeight: number): number {
  if (body.noClip) {
    body.x += body.vx;
    body.y += body.vy;
    body.z += body.vz;
    return body.vy;
  }
  const box = body.box();
  const r = moveBox(world, box, body.vx, body.vy, body.vz, stepHeight, body.onGround);
  body.x = (box.minX + box.maxX) / 2;
  body.y = box.minY;
  body.z = (box.minZ + box.maxZ) / 2;
  body.collidedHorizontally = r.collidedX || r.collidedZ;
  body.collidedVertically = r.collidedY;
  body.onGround = r.onGround;
  if (r.collidedX) body.vx = 0;
  if (r.collidedZ) body.vz = 0;
  if (r.collidedY) body.vy = 0;
  return r.dy;
}

/**
 * Advances one tick of player-style movement. Returns the fall distance at the moment of
 * landing (0 if the body did not land this tick) so callers can apply fall damage.
 */
export function travel(world: CollisionWorld, body: Body, input: MoveInput): number {
  body.prevX = body.x;
  body.prevY = body.y;
  body.prevZ = body.z;
  updateFluidState(world, body);

  let strafe = input.strafe * 0.98;
  let forward = input.forward * 0.98;
  if (input.sneak && !body.flying) {
    strafe *= MOVE.sneakMultiplier;
    forward *= MOVE.sneakMultiplier;
  }
  const sprinting = input.sprint && forward > 0 && !input.sneak;

  if (body.flying) {
    if (input.jump) body.vy += MOVE.flyVertical;
    if (input.sneak) body.vy -= MOVE.flyVertical;
    accelerate(body, strafe, forward, MOVE.flyAccel * (sprinting ? 2 : 1));
    applyMotion(world, body, 0);
    body.vy *= MOVE.flyDrag;
    body.vx *= MOVE.airFriction;
    body.vz *= MOVE.airFriction;
    body.fallDistance = 0;
    return 0;
  }

  if (body.inWater || body.inLava) {
    const drag = body.inWater ? MOVE.waterDrag : MOVE.lavaDrag;
    if (input.jump) body.vy += MOVE.swimUp;
    accelerate(body, strafe, forward, MOVE.waterAccel);
    const y0 = body.y;
    applyMotion(world, body, 0);
    body.vx *= drag;
    body.vy *= drag;
    body.vz *= drag;
    body.vy -= MOVE.waterGravity;
    // Hop out of the water onto a ledge.
    if (body.collidedHorizontally) {
      const test = body.box().offset(body.vx, body.vy + 0.6 - body.y + y0, body.vz);
      if (gatherBoxes(world, test).length === 0) body.vy = 0.3;
    }
    body.fallDistance = 0;
    return 0;
  }

  if (input.jump && body.onGround) {
    body.vy = MOVE.jumpVelocity;
    if (sprinting) {
      body.vx -= Math.sin(body.yaw) * MOVE.sprintJumpBoost;
      body.vz -= Math.cos(body.yaw) * MOVE.sprintJumpBoost;
    }
  }

  const friction = body.onGround ? slipperinessAt(world, body) * MOVE.airFriction : MOVE.airFriction;
  const speed = MOVE.walkSpeed * (sprinting ? MOVE.sprintMultiplier : 1);
  const accel = body.onGround
    ? speed * (0.16277136 / (friction * friction * friction))
    : sprinting
      ? MOVE.airAccelSprint
      : MOVE.airAccel;
  accelerate(body, strafe, forward, accel);

  if (body.onLadder) {
    body.vx = Math.max(-MOVE.ladderMaxSpeed, Math.min(MOVE.ladderMaxSpeed, body.vx));
    body.vz = Math.max(-MOVE.ladderMaxSpeed, Math.min(MOVE.ladderMaxSpeed, body.vz));
    body.fallDistance = 0;
    if (body.vy < -MOVE.ladderMaxSpeed) body.vy = -MOVE.ladderMaxSpeed;
    if (input.sneak && body.vy < 0) body.vy = 0;
  }

  if (input.sneak && body.onGround) sneakClamp(world, body);

  const wasOnGround = body.onGround;
  const dy = applyMotion(world, body, MOVE.stepHeight);
  if (body.onLadder && body.collidedHorizontally) body.vy = MOVE.ladderClimb;

  let landedFall = 0;
  if (body.onGround) {
    if (!wasOnGround || body.fallDistance > 0) landedFall = body.fallDistance;
    body.fallDistance = 0;
  } else if (dy < 0) {
    body.fallDistance -= dy;
  }

  body.vy -= MOVE.gravity;
  body.vy *= MOVE.verticalDrag;
  body.vx *= friction;
  body.vz *= friction;
  return landedFall;
}
