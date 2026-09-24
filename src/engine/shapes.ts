import { CACTUS, FARMLAND, LADDER, SNOW_LAYER, blockMeta, blockType, getBlock } from './blocks';

/** A box in block-local coordinates [0, 1]. */
export type LocalBox = readonly [number, number, number, number, number, number];

const FULL: LocalBox = [0, 0, 0, 1, 1, 1];
const NONE: readonly LocalBox[] = [];
const FULL_LIST: readonly LocalBox[] = [FULL];

const px = (n: number): number => n / 16;

/** Torch shape by meta: 0 = standing, 1..4 = attached to the wall on the S/W/N/E side of the block. */
export function torchBox(meta: number): LocalBox {
  switch (meta) {
    case 1: // on north face of block to the south -> hangs from south wall
      return [px(5.5), px(3), px(11), px(10.5), px(13), 1];
    case 2:
      return [0, px(3), px(5.5), px(5), px(13), px(10.5)];
    case 3:
      return [px(5.5), px(3), 0, px(10.5), px(13), px(5)];
    case 4:
      return [px(11), px(3), px(5.5), 1, px(13), px(10.5)];
    default:
      return [px(6), 0, px(6), px(10), px(10), px(10)];
  }
}

/** Ladder by meta (0..3 = attached to S/W/N/E wall). */
export function ladderBox(meta: number): LocalBox {
  switch (meta & 3) {
    case 0:
      return [0, 0, px(13), 1, 1, 1];
    case 1:
      return [0, 0, 0, px(3), 1, 1];
    case 2:
      return [0, 0, 0, 1, 1, px(3)];
    default:
      return [px(13), 0, 0, 1, 1, 1];
  }
}

/** Boxes that entities collide with. */
export function collisionBoxes(value: number): readonly LocalBox[] {
  const type = blockType(value);
  switch (type) {
    case SNOW_LAYER: {
      const layers = blockMeta(value) & 7; // 0 => 1 layer
      return layers === 0 ? NONE : [[0, 0, 0, 1, px(layers * 2), 1]];
    }
    case CACTUS:
      return [[px(1), 0, px(1), px(15), px(15), px(15)]];
    case FARMLAND:
      return [[0, 0, 0, 1, px(15), 1]];
    case LADDER:
      return [ladderBox(blockMeta(value))];
    default:
      return getBlock(type).solid ? FULL_LIST : NONE;
  }
}

/** Boxes used for targeting/outline (non-empty for anything that can be clicked). */
export function selectionBoxes(value: number): readonly LocalBox[] {
  const type = blockType(value);
  const def = getBlock(type);
  if (type === 0 || def.fluid) return NONE;
  switch (def.shape) {
    case 'cross':
      return [[px(2), 0, px(2), px(14), px(13), px(14)]];
    case 'crop':
      return [[0, 0, 0, 1, px(2 + 2 * Math.min(7, blockMeta(value))), 1]];
    case 'torch':
      return [torchBox(blockMeta(value))];
    case 'layer':
      if (type === SNOW_LAYER) return [[0, 0, 0, 1, px(2 * ((blockMeta(value) & 7) + 1)), 1]];
      if (type === LADDER) return [ladderBox(blockMeta(value))];
      return FULL_LIST;
    default:
      if (type === CACTUS) return [[px(1), 0, px(1), px(15), 1, px(15)]];
      if (type === FARMLAND) return [[0, 0, 0, 1, px(15), 1]];
      return FULL_LIST;
  }
}
