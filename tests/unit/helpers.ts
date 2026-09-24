import { Chunk } from '../../src/engine/chunk';
import { World } from '../../src/engine/world';

/** Builds a world of empty (all air) chunks in the given chunk-coordinate range. */
export function emptyWorld(radius = 1): World {
  const w = new World(1);
  for (let cz = -radius; cz <= radius; cz++)
    for (let cx = -radius; cx <= radius; cx++) w.addChunk(new Chunk(cx, cz));
  return w;
}

/** Fills an axis-aligned box of blocks, bypassing light/neighbour updates for speed. */
export function fillRaw(
  w: World,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  v: number,
): void {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const c = w.getChunkAt(x, z)!;
      for (let y = y0; y <= y1; y++) c.setBlock(x & 15, y, z & 15, v);
    }
}
