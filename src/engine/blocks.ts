import { Face } from './facing';

/**
 * Block storage encoding: a block value is a uint16 `(type << 4) | meta`.
 * `type` indexes the registry (up to 4096 types) and `meta` (0..15) holds per-block state
 * such as log axis, fluid level, wool colour or facing.
 */
export const blockType = (value: number): number => value >> 4;
export const blockMeta = (value: number): number => value & 15;
export const makeBlock = (type: number, meta = 0): number => (type << 4) | (meta & 15);

export type RenderLayer = 'none' | 'opaque' | 'cutout' | 'translucent';
export type BlockShape = 'none' | 'cube' | 'cross' | 'fluid' | 'torch' | 'layer' | 'crop';
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type SoundGroup = 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'glass' | 'wool' | 'snow' | 'none';

/** Texture names per face, indexed by Face (east, west, up, down, south, north). */
export type FaceTextures = readonly [string, string, string, string, string, string];

export interface BlockDef {
  readonly id: number;
  readonly name: string;
  readonly displayName: string;
  readonly shape: BlockShape;
  readonly layer: RenderLayer;
  /** Has a collision box. */
  readonly solid: boolean;
  /** Full opaque cube: hides neighbouring faces and casts ambient occlusion. */
  readonly opaque: boolean;
  /** How much light is lost when passing through (0 = transparent, 15 = fully blocks). */
  readonly lightOpacity: number;
  readonly lightEmission: number;
  /** Seconds-scale hardness as in the classic formula; -1 = unbreakable. */
  readonly hardness: number;
  readonly tool?: ToolKind;
  /** Minimum tool tier required to get drops (0 = wood/any, 1 = stone, 2 = iron, 3 = diamond). */
  readonly harvestLevel: number;
  readonly requiresTool: boolean;
  /** Can be replaced directly by placing another block into it (air, tall grass, fluids). */
  readonly replaceable: boolean;
  readonly fluid: boolean;
  /** Placed meta comes from the item's damage value (e.g. wool colour). */
  readonly variantMeta: boolean;
  readonly sound: SoundGroup;
  /** Per-(meta, face) texture resolver. */
  readonly textures: (meta: number) => FaceTextures;
  /** Names of all textures this block may use (for atlas building). */
  readonly allTextures: readonly string[];
  /** Tint applied to the texture (grass/leaf/water colouring), 0xRRGGBB. */
  readonly tint: number;
  /** Tint applies only to the top face (grass block). */
  readonly tintTopOnly: boolean;
  /** Does not cull faces against other blocks of the same type (leaves in fancy mode). */
  readonly selfCull: boolean;
  /** Number of sub-variants (meta values) exposed as creative items. */
  readonly variants: number;
  readonly variantNames?: readonly string[];
}

interface BlockSpec {
  name: string;
  displayName?: string;
  shape?: BlockShape;
  layer?: RenderLayer;
  solid?: boolean;
  opaque?: boolean;
  lightOpacity?: number;
  lightEmission?: number;
  hardness?: number;
  tool?: ToolKind;
  harvestLevel?: number;
  requiresTool?: boolean;
  replaceable?: boolean;
  fluid?: boolean;
  variantMeta?: boolean;
  sound?: SoundGroup;
  /** Single texture for all faces. */
  tex?: string;
  /** top / bottom / side textures. */
  top?: string;
  bottom?: string;
  side?: string;
  /** Front face texture (for blocks with a facing, meta 0..3 = S, W, N, E). */
  front?: string;
  /** Explicit resolver. */
  textures?: (meta: number) => FaceTextures;
  extraTextures?: string[];
  tint?: number;
  tintTopOnly?: boolean;
  selfCull?: boolean;
  variants?: number;
  variantNames?: string[];
}

const all6 = (t: string): FaceTextures => [t, t, t, t, t, t];
const tbs = (top: string, bottom: string, side: string): FaceTextures => [
  side,
  side,
  top,
  bottom,
  side,
  side,
];

const FACING_TO_FACE = [Face.South, Face.West, Face.North, Face.East];

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();

function register(id: number, spec: BlockSpec): BlockDef {
  if (BLOCKS[id]) throw new Error(`Duplicate block id ${id}`);
  const shape = spec.shape ?? 'cube';
  const layer = spec.layer ?? (shape === 'none' ? 'none' : 'opaque');
  const opaque = spec.opaque ?? (shape === 'cube' && layer === 'opaque');
  let textures = spec.textures;
  let names: string[];
  if (!textures) {
    if (spec.front) {
      const top = spec.top ?? spec.tex!;
      const bottom = spec.bottom ?? top;
      const side = spec.side ?? spec.tex!;
      const front = spec.front;
      textures = (meta) => {
        const f: string[] = [side, side, top, bottom, side, side];
        f[FACING_TO_FACE[meta & 3]] = front;
        return f as unknown as FaceTextures;
      };
      names = [top, bottom, side, front];
    } else if (spec.top || spec.bottom || spec.side) {
      const side = spec.side ?? spec.tex!;
      const t = tbs(spec.top ?? side, spec.bottom ?? spec.top ?? side, side);
      textures = () => t;
      names = [...new Set(t)];
    } else if (spec.tex) {
      const t = all6(spec.tex);
      textures = () => t;
      names = [spec.tex];
    } else {
      textures = () => all6('missing');
      names = [];
    }
  } else {
    names = [];
    for (let m = 0; m < 16; m++) for (const t of textures(m)) if (!names.includes(t)) names.push(t);
  }
  if (spec.extraTextures) names.push(...spec.extraTextures);
  const def: BlockDef = {
    id,
    name: spec.name,
    displayName: spec.displayName ?? titleCase(spec.name),
    shape,
    layer,
    solid: spec.solid ?? (shape === 'cube' || shape === 'layer'),
    opaque,
    lightOpacity: spec.lightOpacity ?? (opaque ? 15 : 0),
    lightEmission: spec.lightEmission ?? 0,
    hardness: spec.hardness ?? 1,
    tool: spec.tool,
    harvestLevel: spec.harvestLevel ?? 0,
    requiresTool: spec.requiresTool ?? false,
    replaceable: spec.replaceable ?? false,
    fluid: spec.fluid ?? false,
    variantMeta: spec.variantMeta ?? false,
    sound: spec.sound ?? 'stone',
    textures,
    allTextures: names.filter((n) => n !== 'missing'),
    tint: spec.tint ?? 0xffffff,
    tintTopOnly: spec.tintTopOnly ?? false,
    selfCull: spec.selfCull ?? true,
    variants: spec.variants ?? 1,
    variantNames: spec.variantNames,
  };
  BLOCKS[id] = def;
  byName.set(def.name, def);
  return def;
}

function titleCase(s: string): string {
  return s
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export const WOOL_COLORS = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;

/** Colour of grass and foliage (baked into the textures as grayscale and tinted per vertex). */
export const GRASS_TINT = 0x7cbd4a;
export const FOLIAGE_TINT = 0x5fa832;
export const SPRUCE_TINT = 0x5b8a5b;
export const BIRCH_TINT = 0x86a85a;
export const WATER_TINT = 0x3f6fe0;

const logTextures =
  (top: string, side: string) =>
  (meta: number): FaceTextures => {
    // meta: 0 = Y axis, 1 = X axis, 2 = Z axis
    const axis = meta & 3;
    if (axis === 1) return [top, top, side, side, side, side];
    if (axis === 2) return [side, side, side, side, top, top];
    return [side, side, top, top, side, side];
  };

// --- Registry --------------------------------------------------------------------------------
// IDs are part of the save format: never renumber, only append.

export const AIR = register(0, {
  name: 'air',
  shape: 'none',
  solid: false,
  replaceable: true,
  hardness: 0,
  sound: 'none',
}).id;
export const STONE = register(1, {
  name: 'stone',
  tex: 'stone',
  hardness: 1.5,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const GRASS_BLOCK = register(2, {
  name: 'grass_block',
  top: 'grass_top',
  bottom: 'dirt',
  side: 'grass_side',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'grass',
  tint: GRASS_TINT,
  tintTopOnly: true,
}).id;
export const DIRT = register(3, {
  name: 'dirt',
  tex: 'dirt',
  hardness: 0.5,
  tool: 'shovel',
  sound: 'gravel',
}).id;
export const COBBLESTONE = register(4, {
  name: 'cobblestone',
  tex: 'cobblestone',
  hardness: 2,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const OAK_PLANKS = register(5, {
  name: 'oak_planks',
  tex: 'oak_planks',
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
export const SPRUCE_PLANKS = register(6, {
  name: 'spruce_planks',
  tex: 'spruce_planks',
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
export const BIRCH_PLANKS = register(7, {
  name: 'birch_planks',
  tex: 'birch_planks',
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
export const BEDROCK = register(8, { name: 'bedrock', tex: 'bedrock', hardness: -1 }).id;
export const WATER = register(9, {
  name: 'water',
  shape: 'fluid',
  layer: 'translucent',
  solid: false,
  opaque: false,
  lightOpacity: 2,
  hardness: 100,
  replaceable: true,
  fluid: true,
  tex: 'water',
  tint: WATER_TINT,
  sound: 'none',
}).id;
export const LAVA = register(10, {
  name: 'lava',
  shape: 'fluid',
  layer: 'opaque',
  solid: false,
  opaque: false,
  lightOpacity: 0,
  lightEmission: 15,
  hardness: 100,
  replaceable: true,
  fluid: true,
  tex: 'lava',
  sound: 'none',
}).id;
export const SAND = register(11, {
  name: 'sand',
  tex: 'sand',
  hardness: 0.5,
  tool: 'shovel',
  sound: 'sand',
}).id;
export const GRAVEL = register(12, {
  name: 'gravel',
  tex: 'gravel',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'gravel',
}).id;
export const GOLD_ORE = register(13, {
  name: 'gold_ore',
  tex: 'gold_ore',
  hardness: 3,
  tool: 'pickaxe',
  harvestLevel: 2,
  requiresTool: true,
}).id;
export const IRON_ORE = register(14, {
  name: 'iron_ore',
  tex: 'iron_ore',
  hardness: 3,
  tool: 'pickaxe',
  harvestLevel: 1,
  requiresTool: true,
}).id;
export const COAL_ORE = register(15, {
  name: 'coal_ore',
  tex: 'coal_ore',
  hardness: 3,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const OAK_LOG = register(16, {
  name: 'oak_log',
  textures: logTextures('oak_log_top', 'oak_log'),
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
export const SPRUCE_LOG = register(17, {
  name: 'spruce_log',
  textures: logTextures('spruce_log_top', 'spruce_log'),
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
export const BIRCH_LOG = register(18, {
  name: 'birch_log',
  textures: logTextures('birch_log_top', 'birch_log'),
  hardness: 2,
  tool: 'axe',
  sound: 'wood',
}).id;
const leaves = (id: number, name: string, tint: number): number =>
  register(id, {
    name,
    tex: 'leaves',
    layer: 'cutout',
    opaque: false,
    lightOpacity: 1,
    hardness: 0.2,
    tool: 'shears',
    sound: 'grass',
    tint,
    selfCull: false,
  }).id;
export const OAK_LEAVES = leaves(19, 'oak_leaves', FOLIAGE_TINT);
export const SPRUCE_LEAVES = leaves(20, 'spruce_leaves', SPRUCE_TINT);
export const BIRCH_LEAVES = leaves(21, 'birch_leaves', BIRCH_TINT);
export const GLASS = register(22, {
  name: 'glass',
  tex: 'glass',
  layer: 'cutout',
  opaque: false,
  hardness: 0.3,
  sound: 'glass',
}).id;
export const LAPIS_ORE = register(23, {
  name: 'lapis_ore',
  tex: 'lapis_ore',
  hardness: 3,
  tool: 'pickaxe',
  harvestLevel: 1,
  requiresTool: true,
}).id;
export const SANDSTONE = register(24, {
  name: 'sandstone',
  top: 'sandstone_top',
  bottom: 'sandstone_bottom',
  side: 'sandstone',
  hardness: 0.8,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const WOOL = register(25, {
  name: 'wool',
  textures: (meta) => all6(`wool_${WOOL_COLORS[meta & 15]}`),
  hardness: 0.8,
  tool: 'shears',
  sound: 'wool',
  variantMeta: true,
  variants: 16,
  variantNames: WOOL_COLORS.map((c) => `${titleCase(c)} Wool`),
}).id;
const plant = (id: number, name: string, tex: string, extra: Partial<BlockSpec> = {}): number =>
  register(id, {
    name,
    tex,
    shape: 'cross',
    layer: 'cutout',
    solid: false,
    opaque: false,
    hardness: 0,
    sound: 'grass',
    ...extra,
  }).id;
export const YELLOW_FLOWER = plant(26, 'yellow_flower', 'yellow_flower', { displayName: 'Sunbloom' });
export const RED_FLOWER = plant(27, 'red_flower', 'red_flower', { displayName: 'Emberpetal' });
export const BROWN_MUSHROOM = plant(28, 'brown_mushroom', 'brown_mushroom', { lightEmission: 1 });
export const RED_MUSHROOM = plant(29, 'red_mushroom', 'red_mushroom');
export const GOLD_BLOCK = register(30, {
  name: 'gold_block',
  displayName: 'Block of Gold',
  tex: 'gold_block',
  hardness: 3,
  tool: 'pickaxe',
  harvestLevel: 2,
  requiresTool: true,
}).id;
export const IRON_BLOCK = register(31, {
  name: 'iron_block',
  displayName: 'Block of Iron',
  tex: 'iron_block',
  hardness: 5,
  tool: 'pickaxe',
  harvestLevel: 1,
  requiresTool: true,
}).id;
export const BRICKS = register(32, {
  name: 'bricks',
  tex: 'bricks',
  hardness: 2,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const TNT = register(33, {
  name: 'tnt',
  displayName: 'Blast Barrel',
  top: 'tnt_top',
  bottom: 'tnt_bottom',
  side: 'tnt_side',
  hardness: 0,
  sound: 'grass',
}).id;
export const BOOKSHELF = register(34, {
  name: 'bookshelf',
  top: 'oak_planks',
  side: 'bookshelf',
  hardness: 1.5,
  tool: 'axe',
  sound: 'wood',
}).id;
export const MOSSY_COBBLESTONE = register(35, {
  name: 'mossy_cobblestone',
  tex: 'mossy_cobblestone',
  hardness: 2,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const OBSIDIAN = register(36, {
  name: 'obsidian',
  tex: 'obsidian',
  hardness: 50,
  tool: 'pickaxe',
  harvestLevel: 3,
  requiresTool: true,
}).id;
export const TORCH = register(37, {
  name: 'torch',
  tex: 'torch',
  shape: 'torch',
  layer: 'cutout',
  solid: false,
  opaque: false,
  lightEmission: 14,
  hardness: 0,
  sound: 'wood',
}).id;
export const CHEST = register(38, {
  name: 'chest',
  top: 'chest_top',
  side: 'chest_side',
  front: 'chest_front',
  hardness: 2.5,
  tool: 'axe',
  sound: 'wood',
}).id;
export const DIAMOND_ORE = register(39, {
  name: 'diamond_ore',
  tex: 'diamond_ore',
  hardness: 3,
  tool: 'pickaxe',
  harvestLevel: 2,
  requiresTool: true,
}).id;
export const DIAMOND_BLOCK = register(40, {
  name: 'diamond_block',
  displayName: 'Block of Diamond',
  tex: 'diamond_block',
  hardness: 5,
  tool: 'pickaxe',
  harvestLevel: 2,
  requiresTool: true,
}).id;
export const CRAFTING_TABLE = register(41, {
  name: 'crafting_table',
  textures: () => [
    'crafting_table_side',
    'crafting_table_side',
    'crafting_table_top',
    'oak_planks',
    'crafting_table_front',
    'crafting_table_front',
  ],
  hardness: 2.5,
  tool: 'axe',
  sound: 'wood',
}).id;
export const FARMLAND = register(42, {
  name: 'farmland',
  top: 'farmland',
  bottom: 'dirt',
  side: 'dirt',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'gravel',
}).id;
export const FURNACE = register(43, {
  name: 'furnace',
  top: 'furnace_top',
  side: 'furnace_side',
  front: 'furnace_front',
  hardness: 3.5,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const LIT_FURNACE = register(44, {
  name: 'lit_furnace',
  displayName: 'Furnace',
  top: 'furnace_top',
  side: 'furnace_side',
  front: 'furnace_front_lit',
  hardness: 3.5,
  tool: 'pickaxe',
  requiresTool: true,
  lightEmission: 13,
}).id;
export const LADDER = register(45, {
  name: 'ladder',
  tex: 'ladder',
  shape: 'layer',
  layer: 'cutout',
  opaque: false,
  solid: false,
  hardness: 0.4,
  tool: 'axe',
  sound: 'wood',
}).id;
export const SNOW_LAYER = register(46, {
  name: 'snow_layer',
  displayName: 'Snow',
  tex: 'snow',
  shape: 'layer',
  opaque: false,
  solid: false,
  replaceable: true,
  hardness: 0.1,
  tool: 'shovel',
  sound: 'snow',
}).id;
export const ICE = register(47, {
  name: 'ice',
  tex: 'ice',
  layer: 'translucent',
  opaque: false,
  lightOpacity: 2,
  hardness: 0.5,
  tool: 'pickaxe',
  sound: 'glass',
}).id;
export const SNOW_BLOCK = register(48, {
  name: 'snow_block',
  tex: 'snow',
  hardness: 0.2,
  tool: 'shovel',
  sound: 'snow',
}).id;
export const CACTUS = register(49, {
  name: 'cactus',
  top: 'cactus_top',
  bottom: 'cactus_top',
  side: 'cactus_side',
  layer: 'cutout',
  opaque: false,
  hardness: 0.4,
  sound: 'wool',
}).id;
export const CLAY = register(50, {
  name: 'clay',
  tex: 'clay',
  hardness: 0.6,
  tool: 'shovel',
  sound: 'gravel',
}).id;
export const SUGAR_CANE = plant(51, 'sugar_cane', 'sugar_cane', { displayName: 'Reeds', tint: GRASS_TINT });
export const PUMPKIN = register(52, {
  name: 'pumpkin',
  top: 'pumpkin_top',
  side: 'pumpkin_side',
  front: 'pumpkin_face',
  hardness: 1,
  tool: 'axe',
  sound: 'wood',
}).id;
export const GLOWSTONE = register(53, {
  name: 'glowstone',
  displayName: 'Glowrock',
  tex: 'glowstone',
  hardness: 0.3,
  lightEmission: 15,
  sound: 'glass',
}).id;
export const TALL_GRASS = plant(54, 'tall_grass', 'tall_grass', {
  displayName: 'Grass',
  replaceable: true,
  tint: GRASS_TINT,
});
export const DEAD_BUSH = plant(55, 'dead_bush', 'dead_bush', { replaceable: true });
export const WHEAT = register(56, {
  name: 'wheat',
  shape: 'crop',
  layer: 'cutout',
  solid: false,
  opaque: false,
  hardness: 0,
  sound: 'grass',
  textures: (meta) => all6(`wheat_${Math.min(7, meta)}`),
}).id;
export const OAK_SAPLING = plant(57, 'oak_sapling', 'oak_sapling');
export const SPRUCE_SAPLING = plant(58, 'spruce_sapling', 'spruce_sapling');
export const BIRCH_SAPLING = plant(59, 'birch_sapling', 'birch_sapling');
export const COAL_BLOCK = register(60, {
  name: 'coal_block',
  displayName: 'Block of Coal',
  tex: 'coal_block',
  hardness: 5,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const STONE_BRICKS = register(61, {
  name: 'stone_bricks',
  tex: 'stone_bricks',
  hardness: 1.5,
  tool: 'pickaxe',
  requiresTool: true,
}).id;
export const BLUE_FLOWER = plant(62, 'blue_flower', 'blue_flower', { displayName: 'Frostbell' });
export const SMOOTH_STONE = register(63, {
  name: 'smooth_stone',
  tex: 'smooth_stone',
  hardness: 2,
  tool: 'pickaxe',
  requiresTool: true,
}).id;

export function getBlock(type: number): BlockDef {
  return BLOCKS[type] ?? BLOCKS[0];
}

export function blockByName(name: string): BlockDef | undefined {
  return byName.get(name);
}

/** Number of registered block type slots (max id + 1). */
export const BLOCK_TYPE_COUNT = BLOCKS.length;

// --- Flat lookup tables indexed by block type for hot loops (meshing, lighting, physics) ---------

export const OPAQUE = new Uint8Array(BLOCK_TYPE_COUNT);
export const SOLID = new Uint8Array(BLOCK_TYPE_COUNT);
export const LIGHT_OPACITY = new Uint8Array(BLOCK_TYPE_COUNT);
export const LIGHT_EMISSION = new Uint8Array(BLOCK_TYPE_COUNT);
for (const def of BLOCKS) {
  if (!def) continue;
  OPAQUE[def.id] = def.opaque ? 1 : 0;
  SOLID[def.id] = def.solid ? 1 : 0;
  LIGHT_OPACITY[def.id] = def.lightOpacity;
  LIGHT_EMISSION[def.id] = def.lightEmission;
}

/** Every texture name referenced by the registry, in stable order. */
export function allBlockTextureNames(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const def of BLOCKS) {
    if (!def) continue;
    for (const t of def.allTextures) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}
