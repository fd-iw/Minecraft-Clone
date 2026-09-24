import * as THREE from 'three';
import { tileLayout } from './layout';
import { paintTile } from './painters';
import { TILE, type Tile } from './tile';

export interface TileImages {
  /** RGBA pixels for each layer (animated tiles contribute one entry per frame). */
  readonly layers: readonly Uint8ClampedArray[];
  /** First frame of each named tile. */
  readonly byName: ReadonlyMap<string, Tile>;
}

let cachedImages: TileImages | null = null;

/** Paints every tile in layout order. Deterministic, runs once at startup. */
export function paintAllTiles(): TileImages {
  if (cachedImages) return cachedImages;
  const layout = tileLayout();
  const layers: Uint8ClampedArray[] = [];
  const byName = new Map<string, Tile>();
  for (const name of layout.names) {
    const frames = paintTile(name);
    const want = layout.framesOf.get(name) ?? 1;
    for (let i = 0; i < want; i++) layers.push(frames[Math.min(i, frames.length - 1)].data);
    byName.set(name, frames[0]);
  }
  cachedImages = { layers, byName };
  return cachedImages;
}

/** Builds a mipmapped texture array (one 16x16 layer per tile frame). */
export function createBlockTextureArray(): THREE.DataArrayTexture {
  const { layers } = paintAllTiles();
  const size = TILE * TILE * 4;
  const data = new Uint8Array(size * layers.length);
  layers.forEach((px, i) => data.set(px, i * size));
  const tex = new THREE.DataArrayTexture(data, TILE, TILE, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
