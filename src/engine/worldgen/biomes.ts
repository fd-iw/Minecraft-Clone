export const enum Biome {
  Ocean = 0,
  DeepOcean = 1,
  FrozenOcean = 2,
  Beach = 3,
  Plains = 4,
  Forest = 5,
  BirchForest = 6,
  Desert = 7,
  Taiga = 8,
  SnowyPlains = 9,
  Mountains = 10,
  SnowyMountains = 11,
  Swamp = 12,
  Savanna = 13,
}

export interface BiomeInfo {
  readonly name: string;
  /** Grass tint (0xRRGGBB). Palette is original to this project. */
  readonly grass: number;
  readonly foliage: number;
  readonly water: number;
  /** Trees attempted per chunk. */
  readonly trees: number;
  readonly snowy: boolean;
}

export const BIOMES: Record<Biome, BiomeInfo> = {
  [Biome.Ocean]: {
    name: 'Ocean',
    grass: 0x86b86a,
    foliage: 0x68a247,
    water: 0x3a6fdc,
    trees: 0,
    snowy: false,
  },
  [Biome.DeepOcean]: {
    name: 'Deep Ocean',
    grass: 0x86b86a,
    foliage: 0x68a247,
    water: 0x2f4fbf,
    trees: 0,
    snowy: false,
  },
  [Biome.FrozenOcean]: {
    name: 'Frozen Ocean',
    grass: 0x7cae94,
    foliage: 0x5c9c7a,
    water: 0x3a3fc2,
    trees: 0,
    snowy: true,
  },
  [Biome.Beach]: {
    name: 'Beach',
    grass: 0x8fc05a,
    foliage: 0x72a834,
    water: 0x3a74e0,
    trees: 0,
    snowy: false,
  },
  [Biome.Plains]: {
    name: 'Plains',
    grass: 0x8cc257,
    foliage: 0x70ab35,
    water: 0x3a74e0,
    trees: 0.15,
    snowy: false,
  },
  [Biome.Forest]: {
    name: 'Forest',
    grass: 0x74bb55,
    foliage: 0x55a832,
    water: 0x3a74e0,
    trees: 9,
    snowy: false,
  },
  [Biome.BirchForest]: {
    name: 'Birch Forest',
    grass: 0x84b964,
    foliage: 0x68a643,
    water: 0x3a74e0,
    trees: 8,
    snowy: false,
  },
  [Biome.Desert]: {
    name: 'Desert',
    grass: 0xc2b85a,
    foliage: 0xb0a430,
    water: 0x3a74e0,
    trees: 0,
    snowy: false,
  },
  [Biome.Taiga]: {
    name: 'Taiga',
    grass: 0x82b37f,
    foliage: 0x64a062,
    water: 0x3a58d2,
    trees: 8,
    snowy: false,
  },
  [Biome.SnowyPlains]: {
    name: 'Snowy Plains',
    grass: 0x7cae94,
    foliage: 0x5c9c7a,
    water: 0x3a3fc2,
    trees: 0.4,
    snowy: true,
  },
  [Biome.Mountains]: {
    name: 'Mountains',
    grass: 0x86b285,
    foliage: 0x68a068,
    water: 0x3a74e0,
    trees: 1,
    snowy: false,
  },
  [Biome.SnowyMountains]: {
    name: 'Snowy Peaks',
    grass: 0x7cae94,
    foliage: 0x5c9c7a,
    water: 0x3a3fc2,
    trees: 0.3,
    snowy: true,
  },
  [Biome.Swamp]: {
    name: 'Swamp',
    grass: 0x6c7440,
    foliage: 0x66703a,
    water: 0x5c7a62,
    trees: 2,
    snowy: false,
  },
  [Biome.Savanna]: {
    name: 'Savanna',
    grass: 0xbdb45c,
    foliage: 0xa9a034,
    water: 0x3a74e0,
    trees: 1,
    snowy: false,
  },
};

export function biomeInfo(b: number): BiomeInfo {
  return BIOMES[b as Biome] ?? BIOMES[Biome.Plains];
}
