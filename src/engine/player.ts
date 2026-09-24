import { Inventory, ItemStack } from './items';
import { Body, travel, type MoveInput } from './physics/movement';
import type { CollisionWorld } from './physics/collision';

export type GameMode = 'survival' | 'creative';

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const SNEAK_EYE_HEIGHT = 1.27;

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  gameMode: GameMode;
  inventory: unknown;
}

export class Player {
  readonly body = new Body(PLAYER_WIDTH, PLAYER_HEIGHT);
  readonly inventory = new Inventory();
  gameMode: GameMode = 'creative';
  sneaking = false;
  sprinting = false;

  get eyeHeight(): number {
    return this.sneaking && !this.body.flying ? SNEAK_EYE_HEIGHT : EYE_HEIGHT;
  }

  get reach(): number {
    return this.gameMode === 'creative' ? 5 : 4.5;
  }

  get canFly(): boolean {
    return this.gameMode === 'creative';
  }

  tick(world: CollisionWorld, input: MoveInput): void {
    this.sneaking = input.sneak;
    this.sprinting = input.sprint && input.forward > 0 && !input.sneak;
    if (!this.canFly) this.body.flying = false;
    travel(world, this.body, input);
    // Landing ends creative flight.
    if (this.body.flying && this.body.onGround) this.body.flying = false;
  }

  /** Fills the hotbar with a starter set of blocks (creative). */
  giveStarterKit(ids: number[]): void {
    ids.slice(0, 9).forEach((id, i) => this.inventory.set(i, new ItemStack(id, 64)));
  }

  save(): PlayerSave {
    const b = this.body;
    return {
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: b.yaw,
      pitch: b.pitch,
      flying: b.flying,
      gameMode: this.gameMode,
      inventory: this.inventory.toJSON(),
    };
  }

  load(s: PlayerSave): void {
    this.body.setPosition(s.x, s.y, s.z);
    this.body.yaw = s.yaw;
    this.body.pitch = s.pitch;
    this.body.flying = s.flying;
    this.gameMode = s.gameMode;
    this.inventory.load(s.inventory);
  }
}
