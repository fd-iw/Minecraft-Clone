import { Emitter } from '../shared/events';
import { canSurvive } from './behavior';
import { AIR, blockType } from './blocks';
import { Chunk, chunkIndex, chunkKey } from './chunk';
import { CHUNK_SIZE, DAY_LENGTH_TICKS, WORLD_HEIGHT } from './constants';
import { FACE_DX, FACE_DY, FACE_DZ } from './facing';
import { LightEngine, type ChunkSource } from './lighting';

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  oldValue: number;
  newValue: number;
  /** Set when the change was caused by a player action (sounds/particles are handled by the client). */
  cause: 'player' | 'update' | 'load';
}

export interface WorldEvents {
  blockChanged: BlockChange;
  chunkAdded: Chunk;
  chunkRemoved: Chunk;
}

/**
 * Authoritative block world. Holds loaded chunks, keeps light up to date and tracks which
 * chunks need re-meshing. Contains no rendering or DOM code so it can run headless.
 */
export class World implements ChunkSource {
  readonly chunks = new Map<number, Chunk>();
  readonly light: LightEngine;
  readonly events = new Emitter<WorldEvents>();
  /** Chunks whose visual representation is stale. Drained by the renderer. */
  readonly dirty = new Set<Chunk>();
  /** Total ticks since world creation. */
  time = 0;
  /** Time of day in ticks, 0..DAY_LENGTH_TICKS (0 = sunrise, 6000 = noon). */
  dayTime = 1000;

  constructor(readonly seed: number) {
    this.light = new LightEngine(this);
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getChunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(chunkKey(x >> 4, z >> 4));
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    const c = this.getChunkAt(x, z);
    return c ? c.blocks[chunkIndex(x & 15, y, z & 15)] : AIR;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.getChunkAt(x, z);
    return c ? c.light[chunkIndex(x & 15, y, z & 15)] >> 4 : 15;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.getChunkAt(x, z);
    return c ? c.light[chunkIndex(x & 15, y, z & 15)] & 15 : 0;
  }

  getBiome(x: number, z: number): number {
    const c = this.getChunkAt(x, z);
    return c ? c.biomes[((z & 15) << 4) | (x & 15)] : 0;
  }

  /** Highest non-air block in a column, or -1. */
  getHeight(x: number, z: number): number {
    const c = this.getChunkAt(x, z);
    return c ? c.columnHeight(x & 15, z & 15) : -1;
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunk.key, chunk);
    this.light.invalidateCache();
    if (!chunk.lit) this.light.lightChunkIsolated(chunk);
    this.light.stitchBorders(chunk);
    this.dirty.add(chunk);
    for (const c of this.light.takeChanged()) this.dirty.add(c);
    // Neighbours can now cull faces / sample light against this chunk.
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (n) this.dirty.add(n);
      }
    this.events.emit('chunkAdded', chunk);
  }

  removeChunk(cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (!c) return undefined;
    this.chunks.delete(key);
    this.light.invalidateCache();
    this.dirty.delete(c);
    this.events.emit('chunkRemoved', c);
    return c;
  }

  /**
   * Sets a block, updating light and re-mesh flags and notifying neighbours. Returns false if
   * the position is outside the world or in an unloaded chunk.
   */
  setBlock(x: number, y: number, z: number, value: number, cause: BlockChange['cause'] = 'player'): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.getChunkAt(x, z);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const oldValue = c.setBlock(lx, y, lz, value);
    if (oldValue === value) return true;
    c.modified = true;
    this.light.onBlockChanged(x, y, z, oldValue);
    this.markDirtyAround(c, lx, lz);
    for (const lc of this.light.takeChanged()) this.dirty.add(lc);
    this.events.emit('blockChanged', { x, y, z, oldValue, newValue: value, cause });
    this.notifyNeighbours(x, y, z);
    return true;
  }

  private markDirtyAround(c: Chunk, lx: number, lz: number): void {
    this.dirty.add(c);
    const dx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    if (dx) this.markDirty(c.cx + dx, c.cz);
    if (dz) this.markDirty(c.cx, c.cz + dz);
    if (dx && dz) this.markDirty(c.cx + dx, c.cz + dz);
  }

  private markDirty(cx: number, cz: number): void {
    const n = this.getChunk(cx, cz);
    if (n) this.dirty.add(n);
  }

  /** Re-checks the six neighbours of a changed block, removing any that can no longer stay. */
  private notifyNeighbours(x: number, y: number, z: number): void {
    for (let f = 0; f < 6; f++) {
      const nx = x + FACE_DX[f];
      const ny = y + FACE_DY[f];
      const nz = z + FACE_DZ[f];
      const v = this.getBlock(nx, ny, nz);
      if (blockType(v) === AIR) continue;
      if (!canSurvive(this, nx, ny, nz, v)) this.setBlock(nx, ny, nz, AIR, 'update');
    }
  }

  tick(): void {
    this.time++;
    this.dayTime = (this.dayTime + 1) % DAY_LENGTH_TICKS;
  }
}
