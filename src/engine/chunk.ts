import { CHUNK_SIZE, CHUNK_VOLUME, SECTION_COUNT, WORLD_HEIGHT } from './constants';
import { blockType } from './blocks';

/** Index into a chunk's flat arrays. Layout is Y-major so horizontal slices are contiguous. */
export const chunkIndex = (x: number, y: number, z: number): number => (y << 8) | (z << 4) | x;

/** Numeric chunk key, safe for |cx|, |cz| < 2^20. */
export const chunkKey = (cx: number, cz: number): number => (cx + 0x100000) * 0x200000 + (cz + 0x100000);

/**
 * A 16 x 256 x 16 column of blocks.
 *
 * - `blocks`: uint16 block values (see blocks.ts encoding).
 * - `light`: packed nibbles, high = sky light, low = block light.
 * - `sectionCounts`: number of non-air blocks per 16-high section, used to skip empty space.
 */
export class Chunk {
  readonly blocks: Uint16Array;
  readonly light: Uint8Array;
  readonly biomes: Uint8Array;
  readonly sectionCounts = new Uint16Array(SECTION_COUNT);
  /** Changed since last save (generation output is reproducible and need not be stored). */
  modified = false;
  /** Initial lighting has been computed. */
  lit = false;
  /** Has had its light seeded across each neighbour boundary (bitmask of the 4 horizontal neighbours). */
  borderLit = 0;

  constructor(
    readonly cx: number,
    readonly cz: number,
    blocks?: Uint16Array,
    biomes?: Uint8Array,
    light?: Uint8Array,
  ) {
    this.blocks = blocks ?? new Uint16Array(CHUNK_VOLUME);
    this.biomes = biomes ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.light = light ?? new Uint8Array(CHUNK_VOLUME);
    this.recountSections();
  }

  get key(): number {
    return chunkKey(this.cx, this.cz);
  }

  recountSections(): void {
    this.sectionCounts.fill(0);
    const b = this.blocks;
    for (let s = 0; s < SECTION_COUNT; s++) {
      let n = 0;
      const start = s << 12;
      const end = start + 4096;
      for (let i = start; i < end; i++) if (b[i] !== 0) n++;
      this.sectionCounts[s] = n;
    }
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[chunkIndex(x, y, z)];
  }

  /** Sets a block, keeping section counts up to date. Returns the previous value. */
  setBlock(x: number, y: number, z: number, value: number): number {
    const i = chunkIndex(x, y, z);
    const prev = this.blocks[i];
    if (prev === value) return prev;
    this.blocks[i] = value;
    const s = y >> 4;
    if (prev === 0) this.sectionCounts[s]++;
    else if (value === 0) this.sectionCounts[s]--;
    return prev;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    return this.light[chunkIndex(x, y, z)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[chunkIndex(x, y, z)] & 15;
  }

  /** Highest y containing a non-air block, or -1. */
  highestNonAirY(): number {
    for (let s = SECTION_COUNT - 1; s >= 0; s--) {
      if (this.sectionCounts[s] === 0) continue;
      for (let y = s * CHUNK_SIZE + 15; y >= s * CHUNK_SIZE; y--) {
        const base = y << 8;
        for (let i = 0; i < 256; i++) if (this.blocks[base + i] !== 0) return y;
      }
    }
    return -1;
  }

  /** Lowest y containing a non-air block, or WORLD_HEIGHT. */
  lowestNonAirY(): number {
    for (let s = 0; s < SECTION_COUNT; s++) {
      if (this.sectionCounts[s] !== 0) return s * CHUNK_SIZE;
    }
    return WORLD_HEIGHT;
  }

  /** Surface height (y of the topmost block that is not air) in a column. */
  columnHeight(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (blockType(this.blocks[chunkIndex(x, y, z)]) !== 0) return y;
    }
    return -1;
  }
}
