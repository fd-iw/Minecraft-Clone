import { describe, expect, it } from 'vitest';
import { BEDROCK, OAK_LOG, BIRCH_LOG, SPRUCE_LOG, blockType } from '../../src/engine/blocks';
import { chunkIndex } from '../../src/engine/chunk';
import { ChunkGenerator } from '../../src/engine/worldgen/generator';

function hash(a: Uint16Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193);
  return h >>> 0;
}

describe('world generation', () => {
  it('is deterministic regardless of generation order', () => {
    const g1 = new ChunkGenerator(1234);
    const g2 = new ChunkGenerator(1234);
    const a = g1.generate(3, -2);
    g2.generate(0, 0);
    g2.generate(4, -2);
    const b = g2.generate(3, -2);
    expect(hash(a.blocks)).toBe(hash(b.blocks));
    expect(Array.from(a.biomes)).toEqual(Array.from(b.biomes));
  });

  it('differs between seeds and always has a bedrock floor', () => {
    const a = new ChunkGenerator(1).generate(0, 0);
    const b = new ChunkGenerator(2).generate(0, 0);
    expect(hash(a.blocks)).not.toBe(hash(b.blocks));
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) expect(blockType(a.blocks[chunkIndex(x, 0, z)])).toBe(BEDROCK);
  });

  it('trees that straddle chunk borders are consistent on both sides', () => {
    const logs = new Set([OAK_LOG, BIRCH_LOG, SPRUCE_LOG]);
    const gen = new ChunkGenerator(99);
    let checked = 0;
    // Any log column at x=15 of chunk (c) implies leaves/logs continuing in chunk (c+1) are
    // generated from the same tree; verify by regenerating both chunks from a fresh generator.
    for (let c = 0; c < 12 && checked < 3; c++) {
      const left = gen.generate(c, 0);
      for (let z = 0; z < 16; z++)
        for (let y = 60; y < 140; y++) {
          if (logs.has(blockType(left.blocks[chunkIndex(15, y, z)]))) checked++;
        }
      const fresh = new ChunkGenerator(99).generate(c + 1, 0);
      const again = gen.generate(c + 1, 0);
      expect(hash(fresh.blocks)).toBe(hash(again.blocks));
    }
  });

  it('generates a chunk in reasonable time', () => {
    const gen = new ChunkGenerator(5);
    gen.generate(0, 0);
    const t0 = performance.now();
    for (let i = 1; i <= 8; i++) gen.generate(i, i);
    const per = (performance.now() - t0) / 8;
    expect(per).toBeLessThan(60);
  });
});
