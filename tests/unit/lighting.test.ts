import { describe, expect, it } from 'vitest';
import { AIR, GLASS, STONE, TORCH, makeBlock } from '../../src/engine/blocks';
import { Chunk } from '../../src/engine/chunk';
import { World } from '../../src/engine/world';
import { emptyWorld, fillRaw } from './helpers';

describe('lighting', () => {
  it('open sky is fully lit', () => {
    const w = emptyWorld(0);
    expect(w.getSkyLight(3, 10, 3)).toBe(15);
    expect(w.getSkyLight(3, 0, 3)).toBe(15);
  });

  it('a roof shades below and light spreads under it', () => {
    const w = emptyWorld(1);
    // 5x5 roof at y=20 centred on (8, 8).
    for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) w.setBlock(x, 20, z, makeBlock(STONE));
    expect(w.getSkyLight(8, 19, 8)).toBe(12); // 3 steps from the nearest edge of the roof
    expect(w.getSkyLight(6, 19, 6)).toBe(14);
    expect(w.getSkyLight(8, 21, 8)).toBe(15);
    // Removing the roof restores full skylight.
    for (let x = 6; x <= 10; x++) for (let z = 6; z <= 10; z++) w.setBlock(x, 20, z, AIR);
    expect(w.getSkyLight(8, 19, 8)).toBe(15);
  });

  it('torch light falls off by 1 per block and is removed cleanly, across chunk borders', () => {
    const w = emptyWorld(1);
    // Sealed stone box spanning the chunk border at x = 16.
    fillRaw(w, 8, 50, 0, 24, 60, 10, makeBlock(STONE));
    fillRaw(w, 9, 51, 1, 23, 59, 9, AIR);
    // Relight everything after the raw edits.
    for (const c of w.chunks.values()) w.light.lightChunkIsolated(c);
    for (const c of w.chunks.values()) w.light.stitchBorders(c);
    expect(w.getSkyLight(12, 55, 5)).toBe(0);

    w.setBlock(15, 55, 5, makeBlock(TORCH));
    expect(w.getBlockLight(15, 55, 5)).toBe(14);
    expect(w.getBlockLight(16, 55, 5)).toBe(13);
    expect(w.getBlockLight(20, 55, 5)).toBe(9);
    expect(w.getBlockLight(15, 57, 7)).toBe(10);

    w.setBlock(15, 55, 5, AIR);
    for (let x = 9; x <= 23; x++) expect(w.getBlockLight(x, 55, 5)).toBe(0);
  });

  it('glass is transparent to light', () => {
    const w = emptyWorld(0);
    w.setBlock(4, 30, 4, makeBlock(GLASS));
    expect(w.getSkyLight(4, 29, 4)).toBe(15);
  });

  it('stitches light between independently lit chunks', () => {
    const w = new World(1);
    const a = new Chunk(0, 0);
    const b = new Chunk(1, 0);
    // Chunk b is roofed at y=100 everywhere except nothing; chunk a is open.
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) b.setBlock(x, 100, z, makeBlock(STONE));
    w.addChunk(a);
    w.addChunk(b);
    // Under b's roof, light leaks in horizontally from a.
    expect(w.getSkyLight(16, 99, 8)).toBe(14);
    expect(w.getSkyLight(20, 99, 8)).toBe(10);
  });
});
