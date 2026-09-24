import { Rng, mix32 } from '../../shared/rng';

export type RGB = readonly [number, number, number];

export const TILE = 16;

export const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export function shadeRGB(c: RGB, f: number): RGB {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Seed for a tile from its name, independent of any world seed. */
export function tileSeed(name: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < name.length; i++) h = mix32(h ^ name.charCodeAt(i));
  return h;
}

/** A 16x16 RGBA pixel buffer with small drawing helpers used by texture recipes. */
export class Tile {
  readonly data = new Uint8ClampedArray(TILE * TILE * 4);
  readonly rng: Rng;

  constructor(seed: number | string) {
    this.rng = new Rng(typeof seed === 'string' ? tileSeed(seed) : seed);
  }

  set(x: number, y: number, c: RGB, a = 255): void {
    x &= 15;
    y &= 15;
    const i = (y * TILE + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }

  get(x: number, y: number): RGB {
    const i = ((y & 15) * TILE + (x & 15)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  alpha(x: number, y: number): number {
    return this.data[((y & 15) * TILE + (x & 15)) * 4 + 3];
  }

  setAlpha(x: number, y: number, a: number): void {
    this.data[((y & 15) * TILE + (x & 15)) * 4 + 3] = a;
  }

  fill(c: RGB, a = 255): this {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, c, a);
    return this;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  /** Random per-pixel choice from a palette (optionally weighted). */
  speckle(palette: readonly RGB[], weights?: readonly number[]): this {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, this.pick(palette, weights));
    return this;
  }

  pick(palette: readonly RGB[], weights?: readonly number[]): RGB {
    if (!weights) return palette[this.rng.int(palette.length)];
    let total = 0;
    for (const w of weights) total += w;
    let r = this.rng.next() * total;
    for (let i = 0; i < palette.length; i++) {
      r -= weights[i];
      if (r <= 0) return palette[i];
    }
    return palette[palette.length - 1];
  }

  /** Multiplies brightness of a pixel. */
  shade(x: number, y: number, f: number): void {
    const a = this.alpha(x, y);
    this.set(x, y, shadeRGB(this.get(x, y), f), a);
  }

  /** Adds per-pixel brightness jitter of +-amount. */
  jitter(amount: number): this {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        if (this.alpha(x, y) === 0) continue;
        this.shade(x, y, 1 + (this.rng.next() * 2 - 1) * amount);
      }
    return this;
  }

  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255): this {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
    return this;
  }

  /** Light top/left edge and dark bottom/right edge. */
  bevel(light: number, dark: number, inset = 0): this {
    const lo = inset;
    const hi = 15 - inset;
    for (let i = lo; i <= hi; i++) {
      this.shade(i, lo, light);
      this.shade(lo, i, light);
      this.shade(i, hi, dark);
      this.shade(hi, i, dark);
    }
    return this;
  }

  border(c: RGB): this {
    for (let i = 0; i < TILE; i++) {
      this.set(i, 0, c);
      this.set(i, 15, c);
      this.set(0, i, c);
      this.set(15, i, c);
    }
    return this;
  }

  copyFrom(o: Tile): this {
    this.data.set(o.data);
    return this;
  }

  /** Smooth, tileable value noise in [0, 1) sampled at pixel (x, y) with the given cell size. */
  static valueNoise(seed: number, x: number, y: number, cell: number): number {
    const n = TILE / cell;
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const h = (ix: number, iy: number): number =>
      mix32(seed ^ Math.imul(((ix % n) + n) % n, 0x27d4eb2d) ^ Math.imul(((iy % n) + n) % n, 0x165667b1)) /
      4294967296;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
    const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  }
}
