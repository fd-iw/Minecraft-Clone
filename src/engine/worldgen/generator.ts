import { Rng, hash2, hash3, hashFloat } from '../../shared/rng';
import {
  AIR,
  BEDROCK,
  BIRCH_LEAVES,
  BLUE_FLOWER,
  BROWN_MUSHROOM,
  CACTUS,
  CLAY,
  COAL_ORE,
  DEAD_BUSH,
  DIAMOND_ORE,
  DIRT,
  GOLD_ORE,
  GRASS_BLOCK,
  GRAVEL,
  ICE,
  IRON_ORE,
  LAPIS_ORE,
  LAVA,
  OAK_LEAVES,
  OPAQUE,
  PUMPKIN,
  RED_FLOWER,
  RED_MUSHROOM,
  SAND,
  SANDSTONE,
  SNOW_BLOCK,
  SNOW_LAYER,
  SPRUCE_LEAVES,
  STONE,
  SUGAR_CANE,
  TALL_GRASS,
  WATER,
  YELLOW_FLOWER,
  blockType,
  makeBlock,
} from '../blocks';
import { chunkIndex } from '../chunk';
import { CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from '../constants';
import { Biome, biomeInfo } from './biomes';
import { placeTree, placeVein, type PlaceFn, type TreeKind } from './features';
import { CAVE_XZ_STEP, CAVE_Y_STEP, TerrainSampler } from './terrain';

export interface GeneratedChunk {
  blocks: Uint16Array;
  biomes: Uint8Array;
}

const LAVA_LEVEL = 10;
const LEAVES = new Set([OAK_LEAVES, SPRUCE_LEAVES, BIRCH_LEAVES]);

interface OreSpec {
  block: number;
  count: number;
  size: number;
  minY: number;
  maxY: number;
}

const ORES: OreSpec[] = [
  { block: makeBlock(DIRT), count: 10, size: 24, minY: 0, maxY: 128 },
  { block: makeBlock(GRAVEL), count: 8, size: 24, minY: 0, maxY: 128 },
  { block: makeBlock(COAL_ORE), count: 20, size: 14, minY: 0, maxY: 128 },
  { block: makeBlock(IRON_ORE), count: 20, size: 8, minY: 0, maxY: 64 },
  { block: makeBlock(GOLD_ORE), count: 2, size: 8, minY: 0, maxY: 32 },
  { block: makeBlock(LAPIS_ORE), count: 1, size: 6, minY: 0, maxY: 32 },
  { block: makeBlock(DIAMOND_ORE), count: 1, size: 7, minY: 0, maxY: 16 },
];

/**
 * Deterministic chunk generator. The same (seed, cx, cz) always produces the same blocks
 * regardless of generation order, so unmodified chunks never need to be saved.
 */
export class ChunkGenerator {
  readonly terrain: TerrainSampler;

  constructor(readonly seed: number) {
    this.terrain = new TerrainSampler(seed);
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const t = this.terrain;

    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    let maxH = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const col = t.column(x0 + x, z0 + z);
        heights[z * 16 + x] = col.height;
        biomes[z * 16 + x] = col.biome;
        if (col.height > maxH) maxH = col.height;
      }
    }

    this.fillTerrain(blocks, heights, biomes, x0, z0);
    this.carveCaves(blocks, heights, x0, z0, Math.max(maxH, SEA_LEVEL) + 1);
    this.placeOres(blocks, cx, cz);
    this.placeTrees(blocks, cx, cz);
    this.placeSurfaceDecor(blocks, heights, biomes, x0, z0);
    return { blocks, biomes };
  }

  private fillTerrain(
    blocks: Uint16Array,
    heights: Int32Array,
    biomes: Uint8Array,
    x0: number,
    z0: number,
  ): void {
    const stone = makeBlock(STONE);
    const water = makeBlock(WATER);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const h = heights[z * 16 + x];
        const biome = biomes[z * 16 + x] as Biome;
        const { top, filler, depth } = this.surfaceLayers(wx, wz, h, biome);
        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let v: number;
          if (y === 0 || (y < 5 && hashFloat(this.seed, wx, y, wz) < 0.6 - y * 0.12)) v = makeBlock(BEDROCK);
          else if (y < h - depth) v = stone;
          else if (y < h) v = filler;
          else if (y === h) v = top;
          else v = water;
          blocks[chunkIndex(x, y, z)] = v;
        }
        // Sandstone under desert/beach sand so it doesn't float over caves.
        if (blockType(filler) === SAND) {
          for (let y = h - depth - 3; y < h - depth; y++)
            if (y > 0) blocks[chunkIndex(x, y, z)] = makeBlock(SANDSTONE);
        }
        if (h < SEA_LEVEL && biomeInfo(biome).snowy) blocks[chunkIndex(x, SEA_LEVEL, z)] = makeBlock(ICE);
      }
    }
  }

  private surfaceLayers(
    wx: number,
    wz: number,
    h: number,
    biome: Biome,
  ): { top: number; filler: number; depth: number } {
    const depth = 3 + (hash2(this.seed ^ 0x5eed, wx, wz) & 1);
    const underwater = h < SEA_LEVEL;
    if (underwater) {
      const r = hashFloat(this.seed, wx, 7, wz);
      if (biome === Biome.DeepOcean || biome === Biome.FrozenOcean)
        return { top: makeBlock(GRAVEL), filler: makeBlock(GRAVEL), depth };
      if (h > SEA_LEVEL - 5 && r < 0.08) return { top: makeBlock(CLAY), filler: makeBlock(DIRT), depth };
      return h > SEA_LEVEL - 8
        ? { top: makeBlock(SAND), filler: makeBlock(SAND), depth }
        : { top: makeBlock(DIRT), filler: makeBlock(DIRT), depth };
    }
    switch (biome) {
      case Biome.Desert:
      case Biome.Beach:
        return { top: makeBlock(SAND), filler: makeBlock(SAND), depth };
      case Biome.SnowyMountains:
        if (this.terrain.steepness(wx, wz) > 2)
          return { top: makeBlock(STONE), filler: makeBlock(STONE), depth };
        return { top: makeBlock(SNOW_BLOCK), filler: makeBlock(DIRT), depth };
      case Biome.Mountains:
        if (this.terrain.steepness(wx, wz) > 2)
          return { top: makeBlock(STONE), filler: makeBlock(STONE), depth };
        return { top: makeBlock(GRASS_BLOCK), filler: makeBlock(DIRT), depth };
      default:
        return { top: makeBlock(GRASS_BLOCK), filler: makeBlock(DIRT), depth };
    }
  }

  private carveCaves(blocks: Uint16Array, heights: Int32Array, x0: number, z0: number, maxY: number): void {
    const t = this.terrain;
    const nx = CHUNK_SIZE / CAVE_XZ_STEP + 1;
    const ny = Math.ceil(maxY / CAVE_Y_STEP) + 1;
    const grid = new Float32Array(nx * nx * ny);
    for (let gy = 0; gy < ny; gy++)
      for (let gz = 0; gz < nx; gz++)
        for (let gx = 0; gx < nx; gx++)
          grid[(gy * nx + gz) * nx + gx] = t.caveDensity(
            x0 + gx * CAVE_XZ_STEP,
            gy * CAVE_Y_STEP,
            z0 + gz * CAVE_XZ_STEP,
          );

    const lava = makeBlock(LAVA);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const gz = Math.floor(z / CAVE_XZ_STEP);
      const fz = (z - gz * CAVE_XZ_STEP) / CAVE_XZ_STEP;
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const gx = Math.floor(x / CAVE_XZ_STEP);
        const fx = (x - gx * CAVE_XZ_STEP) / CAVE_XZ_STEP;
        const h = heights[z * 16 + x];
        const top = h < SEA_LEVEL + 1 ? h - 6 : h;
        for (let y = 1; y <= top && y < maxY; y++) {
          const gy = Math.floor(y / CAVE_Y_STEP);
          const fy = (y - gy * CAVE_Y_STEP) / CAVE_Y_STEP;
          const i000 = (gy * nx + gz) * nx + gx;
          const i010 = i000 + nx * nx;
          const d00 = grid[i000] + (grid[i000 + 1] - grid[i000]) * fx;
          const d01 = grid[i000 + nx] + (grid[i000 + nx + 1] - grid[i000 + nx]) * fx;
          const d10 = grid[i010] + (grid[i010 + 1] - grid[i010]) * fx;
          const d11 = grid[i010 + nx] + (grid[i010 + nx + 1] - grid[i010 + nx]) * fx;
          const d0 = d00 + (d10 - d00) * fy;
          const d1 = d01 + (d11 - d01) * fy;
          const d = d0 + (d1 - d0) * fz;
          if (d <= 0) continue;
          const i = chunkIndex(x, y, z);
          const bt = blockType(blocks[i]);
          if (bt === BEDROCK || bt === WATER) continue;
          // Don't expose sand columns to caves from beneath, they'd hang in the air.
          blocks[i] = y <= LAVA_LEVEL ? lava : AIR;
        }
      }
    }
    // Grass that lost the dirt under it to a cave entrance becomes dirt-free grass; fine as is.
  }

  /** Iterates features whose origin is in chunks within `radius` so that they can span borders. */
  private forNearbyChunks(
    cx: number,
    cz: number,
    radius: number,
    fn: (ncx: number, ncz: number) => void,
  ): void {
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) fn(cx + dx, cz + dz);
  }

  private clippedPlacer(blocks: Uint16Array, cx: number, cz: number, onlyReplace?: number): PlaceFn {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    return (x, y, z, value, overwriteSolid) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 1 || y >= WORLD_HEIGHT) return;
      const i = chunkIndex(lx, y, lz);
      const cur = blockType(blocks[i]);
      if (onlyReplace !== undefined) {
        if (cur !== onlyReplace) return;
      } else if (cur !== AIR && cur !== TALL_GRASS && cur !== SNOW_LAYER) {
        if (!overwriteSolid) return;
        if (OPAQUE[cur] && cur !== DIRT && cur !== GRASS_BLOCK) return;
      }
      blocks[i] = value;
    };
  }

  private placeOres(blocks: Uint16Array, cx: number, cz: number): void {
    const place = this.clippedPlacer(blocks, cx, cz, STONE);
    this.forNearbyChunks(cx, cz, 1, (ncx, ncz) => {
      const rng = new Rng(hash3(this.seed, ncx, 0x0e5, ncz));
      for (const ore of ORES) {
        for (let i = 0; i < ore.count; i++) {
          const x = ncx * CHUNK_SIZE + rng.int(CHUNK_SIZE);
          const z = ncz * CHUNK_SIZE + rng.int(CHUNK_SIZE);
          const y = ore.minY + rng.int(ore.maxY - ore.minY);
          placeVein(x, y, z, ore.size, ore.block, rng, place);
        }
      }
    });
  }

  private treeKindFor(biome: Biome, rng: Rng): TreeKind | null {
    switch (biome) {
      case Biome.Forest:
        return rng.chance(0.2) ? 'birch' : 'oak';
      case Biome.BirchForest:
        return rng.chance(0.85) ? 'birch' : 'oak';
      case Biome.Taiga:
      case Biome.SnowyPlains:
      case Biome.SnowyMountains:
        return 'spruce';
      case Biome.Mountains:
        return rng.chance(0.6) ? 'spruce' : 'oak';
      case Biome.Plains:
      case Biome.Swamp:
        return 'oak';
      case Biome.Savanna:
        return rng.chance(0.5) ? 'bush' : 'oak';
      default:
        return null;
    }
  }

  private placeTrees(blocks: Uint16Array, cx: number, cz: number): void {
    const place = this.clippedPlacer(blocks, cx, cz);
    const t = this.terrain;
    this.forNearbyChunks(cx, cz, 1, (ncx, ncz) => {
      const rng = new Rng(hash3(this.seed, ncx, 0x7ee, ncz));
      const centerBiome = t.biome(ncx * CHUNK_SIZE + 8, ncz * CHUNK_SIZE + 8);
      const density = biomeInfo(centerBiome).trees;
      let count = Math.floor(density);
      if (rng.chance(density - count)) count++;
      for (let i = 0; i < count; i++) {
        const x = ncx * CHUNK_SIZE + rng.int(CHUNK_SIZE);
        const z = ncz * CHUNK_SIZE + rng.int(CHUNK_SIZE);
        const treeRng = new Rng(hash3(this.seed, x, 0x7ef, z));
        const col = t.column(x, z);
        if (col.height < SEA_LEVEL || col.height > WORLD_HEIGHT - 20) continue;
        const kind = this.treeKindFor(col.biome, treeRng);
        if (!kind) continue;
        const b = col.biome;
        if ((b === Biome.Mountains || b === Biome.SnowyMountains) && t.steepness(x, z) > 2) continue;
        if (t.caveAt(x, col.height, z) || t.caveAt(x, col.height - 1, z)) continue;
        placeTree(kind, x, col.height + 1, z, treeRng, place);
        // Trees stand on dirt.
        place(x, col.height, z, makeBlock(DIRT), true);
      }
    });
  }

  private placeSurfaceDecor(
    blocks: Uint16Array,
    heights: Int32Array,
    biomes: Uint8Array,
    x0: number,
    z0: number,
  ): void {
    // Pumpkins grow in rare patches rather than scattered everywhere.
    const pumpkinPatch = hash2(this.seed ^ 0x9a3, x0 >> 4, z0 >> 4) % 28 === 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        const biome = biomes[z * 16 + x] as Biome;
        // Find the actual top block (trees may have been added above the terrain height).
        let y = WORLD_HEIGHT - 2;
        while (y > 0 && blockType(blocks[chunkIndex(x, y, z)]) === AIR) y--;
        const topType = blockType(blocks[chunkIndex(x, y, z)]);
        const above = chunkIndex(x, y + 1, z);
        const r = hashFloat(this.seed ^ 0xdec0, wx, y, wz);

        if (biomeInfo(biome).snowy && y >= SEA_LEVEL && (OPAQUE[topType] || LEAVES.has(topType))) {
          if (topType !== ICE) blocks[above] = makeBlock(SNOW_LAYER);
          continue;
        }
        if (topType === GRASS_BLOCK) {
          if (heights[z * 16 + x] !== y) continue;
          const nearWater = this.nearWater(blocks, x, y, z);
          if (nearWater && r < 0.12 && biome !== Biome.Desert) {
            const hgt = 1 + (hash2(this.seed, wx, wz) % 3);
            for (let i = 1; i <= hgt; i++) blocks[chunkIndex(x, y + i, z)] = makeBlock(SUGAR_CANE);
            continue;
          }
          const grassChance =
            biome === Biome.Plains || biome === Biome.Savanna ? 0.2 : biome === Biome.Swamp ? 0.16 : 0.1;
          if (pumpkinPatch && r > 0.96 && biome !== Biome.Swamp)
            blocks[above] = makeBlock(PUMPKIN, hash2(this.seed, wx, wz) & 3);
          else if (r < grassChance) blocks[above] = makeBlock(TALL_GRASS);
          else if (r < grassChance + 0.015)
            blocks[above] = makeBlock(
              biome === Biome.Taiga ? BLUE_FLOWER : r < grassChance + 0.009 ? YELLOW_FLOWER : RED_FLOWER,
            );
          else if (r < grassChance + 0.02 && (biome === Biome.Taiga || biome === Biome.Swamp))
            blocks[above] = makeBlock(r < grassChance + 0.018 ? BROWN_MUSHROOM : RED_MUSHROOM);
        } else if (topType === SAND && biome === Biome.Desert && y >= SEA_LEVEL) {
          if (r < 0.006 && x > 0 && x < 15 && z > 0 && z < 15) {
            const hgt = 1 + (hash2(this.seed, wx, wz) % 3);
            for (let i = 1; i <= hgt; i++) blocks[chunkIndex(x, y + i, z)] = makeBlock(CACTUS);
          } else if (r < 0.014) blocks[above] = makeBlock(DEAD_BUSH);
        } else if (topType === SAND && biome === Biome.Beach && r < 0.1 && this.nearWater(blocks, x, y, z)) {
          const hgt = 1 + (hash2(this.seed, wx, wz) % 3);
          for (let i = 1; i <= hgt; i++) blocks[chunkIndex(x, y + i, z)] = makeBlock(SUGAR_CANE);
        }
      }
    }
  }

  private nearWater(blocks: Uint16Array, x: number, y: number, z: number): boolean {
    const check = (lx: number, lz: number): boolean =>
      lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && blockType(blocks[chunkIndex(lx, y, lz)]) === WATER;
    return check(x + 1, z) || check(x - 1, z) || check(x, z + 1) || check(x, z - 1);
  }
}
