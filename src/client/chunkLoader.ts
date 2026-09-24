import { Chunk, chunkKey } from '../engine/chunk';
import { decodeChunk, encodeChunk } from '../engine/codec';
import type { World } from '../engine/world';
import type { WorkerPool } from '../workers/pool';
import type { Storage } from './storage';

interface Ready {
  chunk: Chunk;
}

/**
 * Streams chunk columns around the player: loads saved chunks from storage, generates the
 * rest in workers, integrates results under a per-frame time budget, and unloads (saving
 * modified chunks) when they fall out of range.
 */
export class ChunkLoader {
  renderDistance = 8;
  private readonly requested = new Set<number>();
  private readonly ready: Ready[] = [];
  private readonly saving = new Map<number, Chunk>();
  private lastCenter = '';
  private order: [number, number][] = [];
  private disposed = false;

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool,
    private readonly storage: Storage | null,
    private readonly worldId: string,
  ) {}

  /** Chunks kept loaded beyond the visible radius (so edge columns can be meshed). */
  get loadRadius(): number {
    return this.renderDistance + 1;
  }

  get pendingCount(): number {
    return this.requested.size + this.ready.length;
  }

  update(px: number, pz: number, budgetMs = 6): void {
    const ccx = Math.floor(px / 16);
    const ccz = Math.floor(pz / 16);
    const center = `${ccx},${ccz},${this.renderDistance}`;
    if (center !== this.lastCenter) {
      this.lastCenter = center;
      this.rebuildOrder(ccx, ccz);
      this.unloadFar(ccx, ccz);
    }
    this.requestMissing();
    this.integrate(budgetMs);
  }

  private rebuildOrder(ccx: number, ccz: number): void {
    const r = this.loadRadius;
    const out: [number, number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz;
        if (d <= r * r + r) out.push([ccx + dx, ccz + dz, d]);
      }
    out.sort((a, b) => a[2] - b[2]);
    this.order = out.map(([x, z]) => [x, z]);
  }

  private requestMissing(): void {
    const maxInFlight = this.pool.size * 3;
    for (const [cx, cz] of this.order) {
      if (this.requested.size >= maxInFlight) break;
      const key = chunkKey(cx, cz);
      if (this.world.chunks.has(key) || this.requested.has(key)) continue;
      this.requested.add(key);
      this.load(cx, cz).then(
        (chunk) => {
          if (this.disposed || !this.requested.has(key)) return;
          this.ready.push({ chunk });
        },
        (err) => {
          console.error(`Failed to load chunk ${cx},${cz}`, err);
          this.requested.delete(key);
        },
      );
    }
  }

  private async load(cx: number, cz: number): Promise<Chunk> {
    const key = chunkKey(cx, cz);
    // A chunk unloaded moments ago may still be waiting to be written.
    const unsaved = this.saving.get(key);
    if (unsaved) {
      const c = new Chunk(cx, cz, unsaved.blocks, unsaved.biomes, unsaved.light);
      c.lit = true;
      c.modified = true;
      return c;
    }
    const saved = this.storage ? await this.storage.loadChunk(this.worldId, cx, cz) : undefined;
    if (saved) {
      const { blocks, biomes } = decodeChunk(saved);
      const { light } = await this.pool.light({ cx, cz, blocks: blocks.slice() });
      const c = new Chunk(cx, cz, blocks, biomes, light);
      c.lit = true;
      return c;
    }
    const g = await this.pool.generate({ seed: this.world.seed, cx, cz });
    const c = new Chunk(cx, cz, g.blocks, g.biomes, g.light);
    c.lit = true;
    return c;
  }

  private integrate(budgetMs: number): void {
    const start = performance.now();
    while (this.ready.length > 0 && performance.now() - start < budgetMs) {
      const { chunk } = this.ready.shift()!;
      this.requested.delete(chunk.key);
      if (this.world.chunks.has(chunk.key)) continue;
      this.world.addChunk(chunk);
    }
  }

  private unloadFar(ccx: number, ccz: number): void {
    const r = this.loadRadius + 2;
    const toSave: Chunk[] = [];
    for (const c of [...this.world.chunks.values()]) {
      const dx = c.cx - ccx;
      const dz = c.cz - ccz;
      if (dx * dx + dz * dz <= r * r + r) continue;
      this.world.removeChunk(c.cx, c.cz);
      if (c.modified) toSave.push(c);
    }
    // Drop queued results that are now out of range.
    for (const key of [...this.requested]) {
      const cx = Math.floor(key / 0x200000) - 0x100000;
      const cz = (key % 0x200000) - 0x100000;
      const dx = cx - ccx;
      const dz = cz - ccz;
      if (dx * dx + dz * dz > r * r + r) this.requested.delete(key);
    }
    if (toSave.length) void this.persist(toSave);
  }

  private async persist(chunks: Chunk[]): Promise<void> {
    if (!this.storage) return;
    for (const c of chunks) this.saving.set(c.key, c);
    try {
      await this.storage.saveChunks(
        this.worldId,
        chunks.map((c) => encodeChunk(c.cx, c.cz, c.blocks, c.biomes)),
      );
    } finally {
      for (const c of chunks) if (this.saving.get(c.key) === c) this.saving.delete(c.key);
    }
  }

  /** Saves every modified loaded chunk. */
  async saveAll(): Promise<number> {
    const modified = [...this.world.chunks.values()].filter((c) => c.modified);
    for (const c of modified) c.modified = false;
    try {
      await this.persist(modified);
    } catch (e) {
      for (const c of modified) c.modified = true;
      throw e;
    }
    return modified.length;
  }

  dispose(): void {
    this.disposed = true;
    this.ready.length = 0;
    this.requested.clear();
  }
}
