import { Fbm2, SimplexNoise } from '../../shared/noise';
import { clamp, lerp, smoothstep } from '../../shared/math';
import { SEA_LEVEL, WORLD_HEIGHT } from '../constants';
import { Biome } from './biomes';

/** Piecewise-linear spline through sorted [x, y] control points. */
function spline(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

const CONTINENT_SPLINE = [
  [-1, 24],
  [-0.45, 30],
  [-0.3, 42],
  [-0.18, 52],
  [-0.1, 58],
  [-0.04, 62],
  [0.0, 64],
  [0.12, 67],
  [0.3, 72],
  [0.55, 80],
  [1, 92],
] as const;

export interface ColumnInfo {
  height: number;
  biome: Biome;
  /** Continentalness, erosion, temperature, humidity, weirdness samples. */
  c: number;
  e: number;
  t: number;
  h: number;
  w: number;
}

/** Cave field grid spacing (blocks). */
export const CAVE_XZ_STEP = 4;
export const CAVE_Y_STEP = 4;

/**
 * Pure, seed-deterministic terrain sampling shared by the chunk generator and feature placement.
 */
export class TerrainSampler {
  private readonly continental: Fbm2;
  private readonly erosion: Fbm2;
  private readonly weird: Fbm2;
  private readonly temperature: Fbm2;
  private readonly humidity: Fbm2;
  private readonly detail: Fbm2;
  private readonly caveA: SimplexNoise;
  private readonly caveB: SimplexNoise;
  private readonly caveC: SimplexNoise;
  private readonly caveWidth: SimplexNoise;
  private readonly columnCache = new Map<number, ColumnInfo>();

  constructor(readonly seed: number) {
    this.continental = new Fbm2(seed ^ 0x1a2b3c, 5, 900, 0.5);
    this.erosion = new Fbm2(seed ^ 0x2b3c4d, 4, 600, 0.5);
    this.weird = new Fbm2(seed ^ 0x3c4d5e, 4, 260, 0.5);
    this.temperature = new Fbm2(seed ^ 0x4d5e6f, 3, 1100, 0.5);
    this.humidity = new Fbm2(seed ^ 0x5e6f70, 3, 900, 0.5);
    this.detail = new Fbm2(seed ^ 0x6f7081, 4, 64, 0.5);
    this.caveA = new SimplexNoise(seed ^ 0x708192);
    this.caveB = new SimplexNoise(seed ^ 0x8192a3);
    this.caveC = new SimplexNoise(seed ^ 0x92a3b4);
    this.caveWidth = new SimplexNoise(seed ^ 0xa3b4c5);
  }

  column(x: number, z: number): ColumnInfo {
    const key = (x + 0x8000) * 0x10000 + (z + 0x8000);
    const cached = this.columnCache.get(key);
    if (cached) return cached;
    if (this.columnCache.size > 20000) this.columnCache.clear();
    const info = this.computeColumn(x, z);
    this.columnCache.set(key, info);
    return info;
  }

  private computeColumn(x: number, z: number): ColumnInfo {
    const c = this.continental.sample(x, z) * 1.6;
    const e = this.erosion.sample(x, z) * 1.6;
    const w = this.weird.sample(x, z) * 1.5;
    const t = this.temperature.sample(x, z) * 1.6;
    const hum = this.humidity.sample(x, z) * 1.6;
    const d = this.detail.sample(x, z);

    let height = spline(CONTINENT_SPLINE, c);

    // Mountains rise inland where erosion is low; ridges follow the zero-crossings of `weird`.
    const inland = smoothstep(-0.02, 0.35, c);
    const rugged = smoothstep(0.15, -0.45, e);
    const ridge = 1 - Math.abs(w);
    const mountain = inland * rugged;
    height += mountain * (ridge * ridge * 75 + 12);

    // Hills and local detail; flatter where erosion is high.
    const hilliness = lerp(2.5, 9, smoothstep(0.5, -0.3, e)) * (0.4 + 0.6 * inland);
    height += d * hilliness;

    // Swamps flatten towards sea level in humid, low, flat areas.
    const swampiness = smoothstep(0.25, 0.45, hum) * smoothstep(0.2, -0.1, t - 0.1) * smoothstep(0.3, 0.6, e);
    if (swampiness > 0 && height > SEA_LEVEL - 2 && height < SEA_LEVEL + 8) {
      height = lerp(height, SEA_LEVEL + d * 1.5, swampiness * 0.8);
    }

    const h = clamp(Math.floor(height), 4, WORLD_HEIGHT - 20);
    return { height: h, biome: this.pickBiome(h, c, e, t, hum, w, swampiness), c, e, t, h: hum, w };
  }

  private pickBiome(
    h: number,
    c: number,
    _e: number,
    t: number,
    hum: number,
    w: number,
    swamp: number,
  ): Biome {
    const cold = t < -0.42;
    if (h < SEA_LEVEL - 14) return cold ? Biome.FrozenOcean : Biome.DeepOcean;
    if (h < SEA_LEVEL - 1) return cold ? Biome.FrozenOcean : Biome.Ocean;
    if (h > 118) return Biome.SnowyMountains;
    if (h > 96) return t < -0.1 ? Biome.SnowyMountains : Biome.Mountains;
    if (h <= SEA_LEVEL + 2 && c < 0.06 && swamp < 0.5) return cold ? Biome.SnowyPlains : Biome.Beach;
    if (swamp > 0.5) return Biome.Swamp;
    if (cold) return hum > -0.1 ? Biome.Taiga : Biome.SnowyPlains;
    if (t < -0.18) return Biome.Taiga;
    if (t > 0.35) return hum < 0.05 ? Biome.Desert : Biome.Savanna;
    if (hum > 0.12) return w > 0.25 ? Biome.BirchForest : Biome.Forest;
    if (hum > 0.0 && w < -0.3) return Biome.Forest;
    return Biome.Plains;
  }

  height(x: number, z: number): number {
    return this.column(x, z).height;
  }

  biome(x: number, z: number): Biome {
    return this.column(x, z).biome;
  }

  /** Max height difference to the 4 neighbours; large values expose bare stone on cliffs. */
  steepness(x: number, z: number): number {
    const h = this.height(x, z);
    return Math.max(
      Math.abs(this.height(x + 1, z) - h),
      Math.abs(this.height(x - 1, z) - h),
      Math.abs(this.height(x, z + 1) - h),
      Math.abs(this.height(x, z - 1) - h),
    );
  }

  /**
   * Raw cave density at a grid point (positive = air). Combines winding "noodle" tunnels
   * (intersection of two noise zero-sets) with larger caverns deep underground.
   */
  caveDensity(x: number, y: number, z: number): number {
    if (y <= 4) return -1;
    const sx = x / 48;
    const sy = y / 30;
    const sz = z / 48;
    const a = this.caveA.noise3(sx, sy, sz);
    const b = this.caveB.noise3(sx + 31.7, sy, sz - 17.3);
    const width = 0.075 + 0.045 * this.caveWidth.noise3(x / 90, y / 60, z / 90);
    const tunnel = width - Math.sqrt(a * a + b * b);
    const cav = this.caveC.noise3(x / 70, y / 36, z / 70);
    const depthBias = smoothstep(52, 18, y);
    const cavern = (cav - 0.58) * depthBias;
    return Math.max(tunnel, cavern);
  }

  /** Trilinearly interpolated cave density identical to what the chunk generator uses. */
  caveAt(x: number, y: number, z: number): boolean {
    const gx = Math.floor(x / CAVE_XZ_STEP) * CAVE_XZ_STEP;
    const gy = Math.floor(y / CAVE_Y_STEP) * CAVE_Y_STEP;
    const gz = Math.floor(z / CAVE_XZ_STEP) * CAVE_XZ_STEP;
    const fx = (x - gx) / CAVE_XZ_STEP;
    const fy = (y - gy) / CAVE_Y_STEP;
    const fz = (z - gz) / CAVE_XZ_STEP;
    const d000 = this.caveDensity(gx, gy, gz);
    const d100 = this.caveDensity(gx + CAVE_XZ_STEP, gy, gz);
    const d010 = this.caveDensity(gx, gy + CAVE_Y_STEP, gz);
    const d110 = this.caveDensity(gx + CAVE_XZ_STEP, gy + CAVE_Y_STEP, gz);
    const d001 = this.caveDensity(gx, gy, gz + CAVE_XZ_STEP);
    const d101 = this.caveDensity(gx + CAVE_XZ_STEP, gy, gz + CAVE_XZ_STEP);
    const d011 = this.caveDensity(gx, gy + CAVE_Y_STEP, gz + CAVE_XZ_STEP);
    const d111 = this.caveDensity(gx + CAVE_XZ_STEP, gy + CAVE_Y_STEP, gz + CAVE_XZ_STEP);
    const d = lerp(
      lerp(lerp(d000, d100, fx), lerp(d010, d110, fx), fy),
      lerp(lerp(d001, d101, fx), lerp(d011, d111, fx), fy),
      fz,
    );
    return d > 0 && this.caveAllowed(x, y, z);
  }

  /** Caves may not breach the sea floor or the top couple of blocks of a submerged column. */
  caveAllowed(x: number, y: number, z: number): boolean {
    const h = this.height(x, z);
    if (h < SEA_LEVEL + 1) return y < h - 5;
    return y <= h;
  }
}
