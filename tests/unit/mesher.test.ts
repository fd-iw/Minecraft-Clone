import { describe, expect, it } from 'vitest';
import { GLASS, STONE, TALL_GRASS, makeBlock } from '../../src/engine/blocks';
import { buildMeshInput } from '../../src/render/chunkRenderer';
import { meshColumn } from '../../src/render/meshing/mesher';
import { emptyWorld } from './helpers';

const quads = (a: Uint32Array): number => a.length / 12;

describe('mesher', () => {
  it('emits 6 faces for a lone block and culls shared faces', () => {
    const w = emptyWorld(1);
    w.setBlock(4, 40, 4, makeBlock(STONE));
    let out = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    expect(quads(out.opaque)).toBe(6);
    w.setBlock(5, 40, 4, makeBlock(STONE));
    out = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    expect(quads(out.opaque)).toBe(10);
  });

  it('culls faces across chunk borders', () => {
    const w = emptyWorld(1);
    w.setBlock(15, 40, 4, makeBlock(STONE));
    w.setBlock(16, 40, 4, makeBlock(STONE));
    const a = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    const b = meshColumn(buildMeshInput(w, w.getChunk(1, 0)!)!);
    expect(quads(a.opaque) + quads(b.opaque)).toBe(10);
  });

  it('puts glass in the cutout pass and culls glass against glass', () => {
    const w = emptyWorld(1);
    w.setBlock(4, 40, 4, makeBlock(GLASS));
    w.setBlock(5, 40, 4, makeBlock(GLASS));
    const out = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    expect(quads(out.opaque)).toBe(0);
    expect(quads(out.cutout)).toBe(10);
  });

  it('draws plants as two double-sided crossed quads', () => {
    const w = emptyWorld(1);
    w.setBlock(4, 40, 4, makeBlock(TALL_GRASS));
    const out = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    expect(quads(out.cutout)).toBe(4);
  });

  it('darkens corners with ambient occlusion', () => {
    const w = emptyWorld(1);
    // A floor with one block on it: the floor's top face next to the block gets occluded corners.
    for (let x = 2; x <= 6; x++) for (let z = 2; z <= 6; z++) w.setBlock(x, 39, z, makeBlock(STONE));
    w.setBlock(4, 40, 4, makeBlock(STONE));
    const out = meshColumn(buildMeshInput(w, w.getChunk(0, 0)!)!);
    const aos = new Set<number>();
    for (let i = 0; i < out.opaque.length; i += 3) aos.add((out.opaque[i + 2] >>> 28) & 3);
    expect(aos.has(3)).toBe(true);
    expect([...aos].some((a) => a < 3)).toBe(true);
  });
});
