import { describe, expect, it } from 'vitest';
import { Fbm2, SimplexNoise } from '../../src/shared/noise';
import { Rng, seedFromString } from '../../src/shared/rng';
import { mod } from '../../src/shared/math';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32());
  });

  it('parses numeric seeds and hashes text seeds', () => {
    expect(seedFromString('12345')).toBe(12345);
    expect(seedFromString('-7')).toBe(-7);
    expect(seedFromString('hello')).toBe(seedFromString('hello'));
    expect(seedFromString('hello')).not.toBe(seedFromString('world'));
  });
});

describe('noise', () => {
  it('is deterministic and bounded', () => {
    const a = new SimplexNoise(7);
    const b = new SimplexNoise(7);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const z = i * -0.61;
      expect(a.noise2(x, z)).toBe(b.noise2(x, z));
      const v = a.noise3(x, i * 0.13, z);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it('fbm differs between seeds', () => {
    const a = new Fbm2(1, 4, 50);
    const b = new Fbm2(2, 4, 50);
    let diff = 0;
    for (let i = 0; i < 50; i++) diff += Math.abs(a.sample(i * 3, i * 5) - b.sample(i * 3, i * 5));
    expect(diff).toBeGreaterThan(0.5);
  });
});

describe('math', () => {
  it('mod handles negatives', () => {
    expect(mod(-1, 16)).toBe(15);
    expect(mod(-16, 16)).toBe(0);
    expect(mod(17, 16)).toBe(1);
  });
});
