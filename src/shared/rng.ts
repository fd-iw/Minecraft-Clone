/**
 * Deterministic pseudo-random utilities. Everything that must be reproducible from a world seed
 * (terrain, decoration, procedural textures) goes through these helpers, never Math.random().
 */

/** Mixes a 32-bit integer (murmur3 finalizer). */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes integer coordinates with a seed into a 32-bit unsigned integer. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed | 0;
  h = mix32(h ^ Math.imul(x | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(y | 0, 0x165667b1));
  h = mix32(h ^ Math.imul(z | 0, 0x9e3779b1));
  return h;
}

export function hash2(seed: number, x: number, z: number): number {
  return hash3(seed, x, 0x5bd1e995, z);
}

/** Hash to a float in [0, 1). */
export function hashFloat(seed: number, x: number, y: number, z: number): number {
  return hash3(seed, x, y, z) / 4294967296;
}

/** Converts an arbitrary string (e.g. a user-typed world seed) into a 32-bit seed. */
export function seedFromString(s: string): number {
  const trimmed = s.trim();
  if (trimmed !== '' && /^-?\d+$/.test(trimmed)) return Number(BigInt.asIntN(32, BigInt(trimmed)));
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h) | 0;
}

/** Small, fast, seedable PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}
