import { describe, expect, it } from 'vitest';
import {
  AIR,
  COBBLESTONE,
  LAVA,
  OAK_LEAVES,
  OAK_LOG,
  OBSIDIAN,
  SAND,
  STONE,
  WATER,
  blockMeta,
  blockType,
  makeBlock,
} from '../../src/engine/blocks';
import { randomTick } from '../../src/engine/ticks';
import { Rng } from '../../src/shared/rng';
import type { World } from '../../src/engine/world';
import { emptyWorld, fillRaw } from './helpers';

function floorWorld(): World {
  const w = emptyWorld(2);
  fillRaw(w, -32, 0, -32, 47, 10, 47, makeBlock(STONE));
  for (const c of w.chunks.values()) w.light.lightChunkIsolated(c);
  return w;
}

const run = (w: World, ticks: number): void => {
  for (let i = 0; i < ticks; i++) w.tick();
};

describe('fluids', () => {
  it('a water source spreads 7 blocks in a diamond on flat ground', () => {
    const w = floorWorld();
    w.setBlock(0, 11, 0, makeBlock(WATER));
    run(w, 200);
    expect(blockType(w.getBlock(7, 11, 0))).toBe(WATER);
    expect(blockMeta(w.getBlock(7, 11, 0))).toBe(7);
    expect(blockType(w.getBlock(8, 11, 0))).toBe(AIR);
    expect(blockType(w.getBlock(3, 11, 4))).toBe(WATER);
    expect(blockType(w.getBlock(4, 11, 4))).toBe(AIR);
    expect(blockMeta(w.getBlock(0, 11, 0))).toBe(0);
  });

  it('flowing water drains when its source is removed', () => {
    const w = floorWorld();
    w.setBlock(0, 11, 0, makeBlock(WATER));
    run(w, 200);
    w.setBlock(0, 11, 0, AIR);
    run(w, 300);
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) expect(blockType(w.getBlock(x, 11, z))).toBe(AIR);
  });

  it('falls down holes and prefers flowing towards the nearest drop', () => {
    const w = floorWorld();
    // A 1x1 hole three blocks east of the source.
    w.setBlock(3, 10, 0, AIR);
    w.setBlock(3, 9, 0, AIR);
    w.setBlock(0, 11, 0, makeBlock(WATER));
    run(w, 200);
    expect(blockType(w.getBlock(3, 9, 0))).toBe(WATER);
    // With a drop nearby the water heads that way rather than spreading west.
    expect(blockType(w.getBlock(-2, 11, 0))).toBe(AIR);
  });

  it('two adjacent sources make a new source (infinite water)', () => {
    const w = floorWorld();
    w.setBlock(0, 11, 0, makeBlock(WATER));
    w.setBlock(2, 11, 0, makeBlock(WATER));
    run(w, 60);
    expect(w.getBlock(1, 11, 0)).toBe(makeBlock(WATER, 0));
  });

  it('lava hardens next to water', () => {
    const w = floorWorld();
    w.setBlock(0, 11, 0, makeBlock(LAVA));
    w.setBlock(1, 11, 0, makeBlock(WATER));
    run(w, 40);
    expect(blockType(w.getBlock(0, 11, 0))).toBe(OBSIDIAN);

    const w2 = floorWorld();
    w2.setBlock(0, 11, 0, makeBlock(LAVA, 2));
    w2.setBlock(1, 11, 0, makeBlock(WATER));
    run(w2, 40);
    expect(blockType(w2.getBlock(0, 11, 0))).toBe(COBBLESTONE);
  });
});

describe('block ticks', () => {
  it('sand falls when its support is removed', () => {
    const w = floorWorld();
    w.setBlock(5, 15, 5, makeBlock(STONE));
    w.setBlock(5, 16, 5, makeBlock(SAND));
    w.setBlock(5, 15, 5, AIR);
    run(w, 5);
    expect(blockType(w.getBlock(5, 16, 5))).toBe(AIR);
    expect(blockType(w.getBlock(5, 11, 5))).toBe(SAND);
  });

  it('natural leaves decay once no log is nearby; placed leaves persist', () => {
    const w = floorWorld();
    w.setBlock(0, 11, 0, makeBlock(OAK_LOG));
    w.setBlock(1, 11, 0, makeBlock(OAK_LEAVES));
    w.setBlock(2, 11, 0, makeBlock(OAK_LEAVES, 8));
    const rng = new Rng(1);
    randomTick(w, 1, 11, 0, rng);
    expect(blockType(w.getBlock(1, 11, 0))).toBe(OAK_LEAVES);
    w.setBlock(0, 11, 0, AIR);
    randomTick(w, 1, 11, 0, rng);
    randomTick(w, 2, 11, 0, rng);
    expect(blockType(w.getBlock(1, 11, 0))).toBe(AIR);
    expect(blockType(w.getBlock(2, 11, 0))).toBe(OAK_LEAVES);
  });
});
