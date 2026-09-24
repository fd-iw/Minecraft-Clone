import { allBlockTextureNames } from '../../engine/blocks';

/** Animated tiles and their frame counts (frames occupy consecutive texture-array layers). */
export const ANIMATED_TILES: Readonly<Record<string, number>> = { water: 8, lava: 8 };

/** Tiles that no block references directly but the renderer needs. */
export const EXTRA_TILES: readonly string[] = [];

export interface TileLayout {
  /** Tile names in layer order (animated tiles appear once, at their first frame). */
  readonly names: readonly string[];
  readonly layerOf: ReadonlyMap<string, number>;
  readonly framesOf: ReadonlyMap<string, number>;
  /** Total number of texture-array layers. */
  readonly layerCount: number;
}

let cached: TileLayout | null = null;

/** Deterministic tile -> layer assignment. Pure, so mesh workers compute the same table. */
export function tileLayout(): TileLayout {
  if (cached) return cached;
  const names = [
    ...allBlockTextureNames(),
    ...EXTRA_TILES.filter((n) => !allBlockTextureNames().includes(n)),
  ];
  const layerOf = new Map<string, number>();
  const framesOf = new Map<string, number>();
  let layer = 0;
  for (const n of names) {
    const frames = ANIMATED_TILES[n] ?? 1;
    layerOf.set(n, layer);
    framesOf.set(n, frames);
    layer += frames;
  }
  cached = { names, layerOf, framesOf, layerCount: layer };
  return cached;
}
