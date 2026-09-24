import { LIGHT_EMISSION, LIGHT_OPACITY } from './blocks';
import { Chunk, chunkIndex } from './chunk';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';

/** Anything that can hand out loaded chunks by chunk coordinate. */
export interface ChunkSource {
  getChunk(cx: number, cz: number): Chunk | undefined;
}

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;

/** Growable FIFO of packed (x, y, z, level) entries. */
class LightQueue {
  private buf = new Int32Array(4 * 4096);
  head = 0;
  tail = 0;

  push(x: number, y: number, z: number, level: number): void {
    if (this.tail + 4 > this.buf.length) {
      if (this.head > 0) {
        this.buf.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + 4 > this.buf.length) {
        const next = new Int32Array(this.buf.length * 2);
        next.set(this.buf.subarray(0, this.tail));
        this.buf = next;
      }
    }
    const b = this.buf;
    b[this.tail] = x;
    b[this.tail + 1] = y;
    b[this.tail + 2] = z;
    b[this.tail + 3] = level;
    this.tail += 4;
  }

  get empty(): boolean {
    return this.head >= this.tail;
  }

  get data(): Int32Array {
    return this.buf;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }
}

/**
 * Flood-fill light engine for sky and block light (two 4-bit channels stored in Chunk.light).
 *
 * Sky light: 15 travels straight down undiminished through fully transparent blocks, and loses
 * max(1, opacity) per step in every other direction. Block light: emitted by blocks, loses
 * max(1, opacity) per step. Removal uses the classic two-queue "unlight then relight" approach.
 */
export class LightEngine {
  private readonly addQueue = new LightQueue();
  private readonly removeQueue = new LightQueue();
  /** Chunks whose light changed since the last `takeChanged()`. */
  private readonly changed = new Set<Chunk>();

  // Single-entry chunk cache for the hot loop.
  private cacheCx = Number.NaN;
  private cacheCz = Number.NaN;
  private cacheChunk: Chunk | undefined;

  constructor(private readonly source: ChunkSource) {}

  takeChanged(): Set<Chunk> {
    const out = new Set(this.changed);
    this.changed.clear();
    return out;
  }

  private chunkAt(x: number, z: number): Chunk | undefined {
    const cx = x >> 4;
    const cz = z >> 4;
    if (cx !== this.cacheCx || cz !== this.cacheCz) {
      this.cacheCx = cx;
      this.cacheCz = cz;
      this.cacheChunk = this.source.getChunk(cx, cz);
    }
    return this.cacheChunk;
  }

  invalidateCache(): void {
    this.cacheCx = Number.NaN;
    this.cacheCz = Number.NaN;
    this.cacheChunk = undefined;
  }

  // --- Initial lighting ---------------------------------------------------------------------

  /**
   * Computes light for a freshly generated/loaded chunk considering only its own blocks.
   * Cross-chunk flow is handled later by `stitchBorders`.
   */
  lightChunkIsolated(chunk: Chunk): void {
    const { blocks, light } = chunk;
    light.fill(0);
    const top = Math.min(WORLD_HEIGHT - 1, chunk.highestNonAirY() + 1);
    // Everything above the highest block is fully sky-lit.
    if (top < WORLD_HEIGHT - 1) light.fill(0xf0, (top + 1) << 8);

    // Straight-down skylight per column.
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let level = 15;
        for (let y = top; y >= 0; y--) {
          const i = chunkIndex(x, y, z);
          const op = LIGHT_OPACITY[blocks[i] >> 4];
          if (op > 0) level = Math.max(0, level - Math.max(1, op));
          if (level === 0) break;
          light[i] = level << 4;
        }
      }
    }

    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    const q = this.addQueue;
    q.reset();
    // Seed horizontal spreading from lit cells next to darker transparent neighbours.
    for (let y = top; y >= 0; y--) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const i = chunkIndex(x, y, z);
          const l = light[i] >> 4;
          if (l <= 1) continue;
          let seed = false;
          for (let f = 0; f < 6 && !seed; f++) {
            if (f === 2 || f === 3) continue;
            const nx = x + DX[f];
            const nz = z + DZ[f];
            if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16) continue;
            const ni = chunkIndex(nx, y, nz);
            if (light[ni] >> 4 < l - 1 && LIGHT_OPACITY[blocks[ni] >> 4] < 15) seed = true;
          }
          if (!seed && y > 0) {
            const bi = i - 256;
            if (light[bi] >> 4 < l - 1 && LIGHT_OPACITY[blocks[bi] >> 4] < 15) seed = true;
          }
          if (seed) q.push(x0 + x, y, z0 + z, l);
        }
      }
    }
    this.propagateSkyWithin(chunk);

    // Block light from emitters.
    q.reset();
    for (let s = 0; s < chunk.sectionCounts.length; s++) {
      if (chunk.sectionCounts[s] === 0) continue;
      const start = s << 12;
      for (let i = start; i < start + 4096; i++) {
        const em = LIGHT_EMISSION[blocks[i] >> 4];
        if (em > 0) {
          light[i] = (light[i] & 0xf0) | em;
          q.push(x0 + (i & 15), i >> 8, z0 + ((i >> 4) & 15), em);
        }
      }
    }
    this.propagateBlockWithin(chunk);
    chunk.lit = true;
  }

  private propagateSkyWithin(chunk: Chunk): void {
    const q = this.addQueue;
    const { blocks, light } = chunk;
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    while (!q.empty) {
      const d = q.data;
      const x = d[q.head] - x0;
      const y = d[q.head + 1];
      const z = d[q.head + 2] - z0;
      q.head += 4;
      const l = light[chunkIndex(x, y, z)] >> 4;
      for (let f = 0; f < 6; f++) {
        const nx = x + DX[f];
        const ny = y + DY[f];
        const nz = z + DZ[f];
        if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16 || ny < 0 || ny >= WORLD_HEIGHT) continue;
        const ni = chunkIndex(nx, ny, nz);
        const op = LIGHT_OPACITY[blocks[ni] >> 4];
        if (op >= 15) continue;
        const nl = f === DOWN && l === 15 && op === 0 ? 15 : l - Math.max(1, op);
        if (nl > light[ni] >> 4) {
          light[ni] = (nl << 4) | (light[ni] & 15);
          q.push(nx + x0, ny, nz + z0, nl);
        }
      }
    }
  }

  private propagateBlockWithin(chunk: Chunk): void {
    const q = this.addQueue;
    const { blocks, light } = chunk;
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    while (!q.empty) {
      const d = q.data;
      const x = d[q.head] - x0;
      const y = d[q.head + 1];
      const z = d[q.head + 2] - z0;
      q.head += 4;
      const l = light[chunkIndex(x, y, z)] & 15;
      for (let f = 0; f < 6; f++) {
        const nx = x + DX[f];
        const ny = y + DY[f];
        const nz = z + DZ[f];
        if (nx < 0 || nx >= 16 || nz < 0 || nz >= 16 || ny < 0 || ny >= WORLD_HEIGHT) continue;
        const ni = chunkIndex(nx, ny, nz);
        const op = LIGHT_OPACITY[blocks[ni] >> 4];
        if (op >= 15) continue;
        const nl = l - Math.max(1, op);
        if (nl > (light[ni] & 15)) {
          light[ni] = (light[ni] & 0xf0) | nl;
          q.push(nx + x0, ny, nz + z0, nl);
        }
      }
    }
  }

  /**
   * Lets light flow between `chunk` and each loaded horizontal neighbour, in both directions.
   * Call once when a chunk becomes available in the world.
   */
  stitchBorders(chunk: Chunk): void {
    this.invalidateCache();
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    const neighbours: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const sky of [true, false]) {
      this.addQueue.reset();
      for (const [dx, dz] of neighbours) {
        const n = this.source.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (!n) continue;
        // Seed with both sides of the shared boundary.
        const lxSelf = dx === 1 ? 15 : dx === -1 ? 0 : -1;
        const lzSelf = dz === 1 ? 15 : dz === -1 ? 0 : -1;
        const top = Math.min(WORLD_HEIGHT - 1, Math.max(chunk.highestNonAirY(), n.highestNonAirY()) + 1);
        for (let y = 0; y <= top; y++) {
          for (let k = 0; k < 16; k++) {
            const sx = lxSelf >= 0 ? lxSelf : k;
            const sz = lzSelf >= 0 ? lzSelf : k;
            const nx = lxSelf >= 0 ? 15 - lxSelf : k;
            const nz = lzSelf >= 0 ? 15 - lzSelf : k;
            const si = chunkIndex(sx, y, sz);
            const ni = chunkIndex(nx, y, nz);
            const sl = sky ? chunk.light[si] >> 4 : chunk.light[si] & 15;
            const nl = sky ? n.light[ni] >> 4 : n.light[ni] & 15;
            if (sl > 1) this.addQueue.push(x0 + sx, y, z0 + sz, sl);
            if (nl > 1) this.addQueue.push(n.cx * CHUNK_SIZE + nx, y, n.cz * CHUNK_SIZE + nz, nl);
          }
        }
      }
      this.propagateAdd(sky);
    }
  }

  // --- World-space propagation -------------------------------------------------------------

  getSky(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.light[chunkIndex(x & 15, y, z & 15)] >> 4 : 0;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.light[chunkIndex(x & 15, y, z & 15)] & 15 : 0;
  }

  private markChanged(c: Chunk, lx: number, lz: number): void {
    this.changed.add(c);
    // Meshes sample neighbouring light for smooth lighting, so border changes affect neighbours.
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
      const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
      const dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (dx) this.addNeighbour(c.cx + dx, c.cz);
      if (dz) this.addNeighbour(c.cx, c.cz + dz);
      if (dx && dz) this.addNeighbour(c.cx + dx, c.cz + dz);
    }
  }

  private addNeighbour(cx: number, cz: number): void {
    const n = this.source.getChunk(cx, cz);
    if (n) this.changed.add(n);
  }

  private propagateAdd(sky: boolean): void {
    const q = this.addQueue;
    while (!q.empty) {
      const d = q.data;
      const x = d[q.head];
      const y = d[q.head + 1];
      const z = d[q.head + 2];
      q.head += 4;
      const c0 = this.chunkAt(x, z);
      if (!c0) continue;
      const cur = c0.light[chunkIndex(x & 15, y, z & 15)];
      const l = sky ? cur >> 4 : cur & 15;
      if (l <= 1) continue;
      for (let f = 0; f < 6; f++) {
        const nx = x + DX[f];
        const ny = y + DY[f];
        const nz = z + DZ[f];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const c = this.chunkAt(nx, nz);
        if (!c) continue;
        const lx = nx & 15;
        const lz = nz & 15;
        const ni = chunkIndex(lx, ny, lz);
        const op = LIGHT_OPACITY[c.blocks[ni] >> 4];
        if (op >= 15) continue;
        const nl = sky && f === DOWN && l === 15 && op === 0 ? 15 : l - Math.max(1, op);
        const nv = c.light[ni];
        const ncur = sky ? nv >> 4 : nv & 15;
        if (nl > ncur) {
          c.light[ni] = sky ? (nl << 4) | (nv & 15) : (nv & 0xf0) | nl;
          this.markChanged(c, lx, lz);
          q.push(nx, ny, nz, nl);
        }
      }
    }
  }

  private propagateRemove(sky: boolean): void {
    const rq = this.removeQueue;
    const aq = this.addQueue;
    while (!rq.empty) {
      const d = rq.data;
      const x = d[rq.head];
      const y = d[rq.head + 1];
      const z = d[rq.head + 2];
      const l = d[rq.head + 3];
      rq.head += 4;
      for (let f = 0; f < 6; f++) {
        const nx = x + DX[f];
        const ny = y + DY[f];
        const nz = z + DZ[f];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const c = this.chunkAt(nx, nz);
        if (!c) continue;
        const lx = nx & 15;
        const lz = nz & 15;
        const ni = chunkIndex(lx, ny, lz);
        const nv = c.light[ni];
        const nl = sky ? nv >> 4 : nv & 15;
        if (nl === 0) continue;
        const fedByUs = nl < l || (sky && f === DOWN && l === 15 && nl === 15);
        if (fedByUs) {
          c.light[ni] = sky ? nv & 15 : nv & 0xf0;
          this.markChanged(c, lx, lz);
          rq.push(nx, ny, nz, nl);
        } else {
          aq.push(nx, ny, nz, nl);
        }
      }
    }
  }

  /**
   * Updates lighting after the block at (x, y, z) changed from `oldValue` to the value
   * currently stored in the world.
   */
  onBlockChanged(x: number, y: number, z: number, oldValue: number): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const lx = x & 15;
    const lz = z & 15;
    const i = chunkIndex(lx, y, lz);
    const newType = c.blocks[i] >> 4;
    const oldType = oldValue >> 4;
    const oldOp = LIGHT_OPACITY[oldType];
    const newOp = LIGHT_OPACITY[newType];
    const oldEm = LIGHT_EMISSION[oldType];
    const newEm = LIGHT_EMISSION[newType];
    if (oldOp === newOp && oldEm === newEm) return;
    this.markChanged(c, lx, lz);

    for (const sky of [false, true]) {
      this.addQueue.reset();
      this.removeQueue.reset();
      const v = c.light[i];
      const cur = sky ? v >> 4 : v & 15;
      if (cur > 0) {
        c.light[i] = sky ? v & 15 : v & 0xf0;
        this.removeQueue.push(x, y, z, cur);
        this.propagateRemove(sky);
      }
      if (!sky && newEm > 0) {
        c.light[i] = (c.light[i] & 0xf0) | newEm;
        this.addQueue.push(x, y, z, newEm);
      }
      if (newOp < 15) {
        // Pull light in from neighbours.
        for (let f = 0; f < 6; f++) {
          const nx = x + DX[f];
          const ny = y + DY[f];
          const nz = z + DZ[f];
          if (ny >= WORLD_HEIGHT) {
            if (sky) {
              c.light[i] = (15 << 4) | (c.light[i] & 15);
              this.addQueue.push(x, y, z, 15);
            }
            continue;
          }
          if (ny < 0) continue;
          const nlv = sky ? this.getSky(nx, ny, nz) : this.getBlockLight(nx, ny, nz);
          if (nlv > 1) this.addQueue.push(nx, ny, nz, nlv);
        }
      }
      this.propagateAdd(sky);
    }
  }
}
