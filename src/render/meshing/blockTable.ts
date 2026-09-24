import {
  BIRCH_LEAVES,
  BLOCKS,
  BLOCK_TYPE_COUNT,
  GRASS_BLOCK,
  OAK_LEAVES,
  SPRUCE_LEAVES,
  SUGAR_CANE,
  TALL_GRASS,
  WATER,
} from '../../engine/blocks';
import { tileLayout } from '../textures/layout';

export const enum Shape {
  None = 0,
  Cube = 1,
  Cross = 2,
  Fluid = 3,
  Torch = 4,
  Layer = 5,
  Crop = 6,
  Cactus = 7,
  Ladder = 8,
}

export const enum Layer {
  None = 0,
  Opaque = 1,
  Cutout = 2,
  Translucent = 3,
}

export const enum TintKind {
  Fixed = 0,
  Grass = 1,
  Foliage = 2,
  Water = 3,
}

/**
 * Flat per-block lookup tables for the mesher. Indexed by block value (type << 4 | meta) for
 * texture layers, by type for everything else. Built from the registry + tile layout only, so
 * the main thread and mesh workers derive identical tables.
 */
export interface BlockTable {
  readonly faceLayer: Uint16Array; // [value * 6 + face]
  readonly faceFrames: Uint8Array; // [value * 6 + face]
  readonly shape: Uint8Array; // [type]
  readonly layer: Uint8Array; // [type]
  readonly opaque: Uint8Array; // [type]
  readonly selfCull: Uint8Array; // [type]
  readonly tintKind: Uint8Array; // [type]
  readonly fixedTint: Uint32Array; // [type]
  readonly waves: Uint8Array; // [type] 1 = leaves sway, 2 = plant tops sway
  readonly fluid: Uint8Array; // [type]
}

let cached: BlockTable | null = null;

export function blockTable(): BlockTable {
  if (cached) return cached;
  const layout = tileLayout();
  const values = BLOCK_TYPE_COUNT * 16;
  const faceLayer = new Uint16Array(values * 6);
  const faceFrames = new Uint8Array(values * 6);
  const shape = new Uint8Array(BLOCK_TYPE_COUNT);
  const layer = new Uint8Array(BLOCK_TYPE_COUNT);
  const opaque = new Uint8Array(BLOCK_TYPE_COUNT);
  const selfCull = new Uint8Array(BLOCK_TYPE_COUNT);
  const tintKind = new Uint8Array(BLOCK_TYPE_COUNT);
  const fixedTint = new Uint32Array(BLOCK_TYPE_COUNT);
  const waves = new Uint8Array(BLOCK_TYPE_COUNT);
  const fluid = new Uint8Array(BLOCK_TYPE_COUNT);

  for (const def of BLOCKS) {
    if (!def) continue;
    const t = def.id;
    for (let meta = 0; meta < 16; meta++) {
      const tex = def.textures(meta);
      for (let f = 0; f < 6; f++) {
        const i = ((t << 4) | meta) * 6 + f;
        faceLayer[i] = layout.layerOf.get(tex[f]) ?? 0;
        faceFrames[i] = layout.framesOf.get(tex[f]) ?? 1;
      }
    }
    shape[t] =
      def.shape === 'none'
        ? Shape.None
        : def.shape === 'cross'
          ? Shape.Cross
          : def.shape === 'fluid'
            ? Shape.Fluid
            : def.shape === 'torch'
              ? Shape.Torch
              : def.shape === 'crop'
                ? Shape.Crop
                : def.shape === 'layer'
                  ? def.name === 'ladder'
                    ? Shape.Ladder
                    : Shape.Layer
                  : def.name === 'cactus'
                    ? Shape.Cactus
                    : Shape.Cube;
    layer[t] =
      def.layer === 'opaque'
        ? Layer.Opaque
        : def.layer === 'cutout'
          ? Layer.Cutout
          : def.layer === 'translucent'
            ? Layer.Translucent
            : Layer.None;
    opaque[t] = def.opaque ? 1 : 0;
    selfCull[t] = def.selfCull ? 1 : 0;
    fixedTint[t] = def.tint;
    fluid[t] = def.fluid ? 1 : 0;
    if (t === GRASS_BLOCK || t === TALL_GRASS || t === SUGAR_CANE) tintKind[t] = TintKind.Grass;
    else if (t === OAK_LEAVES) tintKind[t] = TintKind.Foliage;
    else if (t === WATER) tintKind[t] = TintKind.Water;
    if (t === OAK_LEAVES || t === SPRUCE_LEAVES || t === BIRCH_LEAVES) waves[t] = 1;
    else if (def.shape === 'cross' && t !== SUGAR_CANE) waves[t] = 2;
  }
  cached = { faceLayer, faceFrames, shape, layer, opaque, selfCull, tintKind, fixedTint, waves, fluid };
  return cached;
}
