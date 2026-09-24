import { SEA_LEVEL } from '../constants';
import { Biome } from './biomes';
import { TerrainSampler } from './terrain';

const BAD = new Set([Biome.Ocean, Biome.DeepOcean, Biome.FrozenOcean]);

/** Spiral search outwards from the origin for dry land to spawn on. */
export function findSpawn(seed: number): [number, number, number] {
  const t = new TerrainSampler(seed);
  let x = 0;
  let z = 0;
  let dx = 0;
  let dz = -1;
  const step = 8;
  for (let i = 0; i < 4096; i++) {
    const wx = x * step;
    const wz = z * step;
    const col = t.column(wx, wz);
    if (!BAD.has(col.biome) && col.height > SEA_LEVEL && col.height < 110 && t.steepness(wx, wz) <= 1) {
      return [wx, col.height + 1, wz];
    }
    // Square spiral.
    if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
      const tmp = dx;
      dx = -dz;
      dz = tmp;
    }
    x += dx;
    z += dz;
  }
  return [0, t.height(0, 0) + 1, 0];
}
