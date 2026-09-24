import { WOOL_COLORS } from '../../engine/blocks';
import { Tile, hex, mixRGB, shadeRGB, tileSeed, type RGB } from './tile';

/**
 * Procedural recipes for every block texture. All artwork here is original: textures are
 * generated from palettes and seeded noise at startup, no image files are shipped.
 *
 * Conventions:
 * - Opaque tiles: alpha is a *tint mask* (255 = multiply by the vertex tint, 0 = keep colour).
 *   Untinted blocks have a white tint so the mask is irrelevant for them.
 * - Cutout / translucent tiles: alpha is real transparency.
 * - Tinted foliage (grass, leaves, reeds) is painted in neutral greys and coloured per biome.
 */
export type Painter = (name: string) => Tile | Tile[];

const P = {
  stone: [0x7e7e80, 0x76767a, 0x87878a, 0x6e6e72].map(hex),
  dirt: [0x8a6242, 0x7c573a, 0x967050, 0x6c4a30].map(hex),
  sand: [0xdcd3a2, 0xd3c992, 0xe4dcae, 0xcabf88].map(hex),
  sandstone: [0xd8cc98, 0xcfc28a, 0xe0d5a6].map(hex),
  gravel: [0x8a8580, 0x767270, 0x9c9894, 0x6a625c, 0xa59a8e].map(hex),
  grey: [0xa8a8a8, 0x9c9c9c, 0xb4b4b4, 0x929292].map(hex),
  snow: [0xf4f8fa, 0xeaf0f4, 0xfafdff].map(hex),
  clay: [0x9da3b1, 0x959ba9, 0xa6acb9].map(hex),
  obsidian: [0x14101c, 0x1b1426, 0x0f0c15, 0x261d38].map(hex),
  bedrock: [0x575757, 0x3a3a3a, 0x6e6e6e, 0x2a2a2a, 0x808080].map(hex),
};

const WOOD: Record<string, { plank: RGB; bark: RGB; ring: RGB; heart: RGB }> = {
  oak: { plank: hex(0xa8854f), bark: hex(0x6b5233), ring: hex(0xb89661), heart: hex(0x957446) },
  spruce: { plank: hex(0x76552f), bark: hex(0x3f2d1a), ring: hex(0x86633a), heart: hex(0x644626) },
  birch: { plank: hex(0xc9b77a), bark: hex(0xe3e0d4), ring: hex(0xd6c68d), heart: hex(0xb7a466) },
};

// --- Generic helpers ---------------------------------------------------------------------

function noisyFill(t: Tile, palette: readonly RGB[], smooth = 0.5): Tile {
  const seed = t.rng.nextU32();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const n = Tile.valueNoise(seed, x, y, 4) * smooth + t.rng.next() * (1 - smooth);
      t.set(x, y, palette[Math.min(palette.length - 1, Math.floor(n * palette.length))]);
    }
  return t;
}

function stoneBase(name: string): Tile {
  const t = noisyFill(new Tile(name), P.stone, 0.35);
  // Faint horizontal strata streaks: a nod to the game's layered landscapes.
  for (let i = 0; i < 3; i++) {
    const y = t.rng.int(16);
    const x0 = t.rng.int(16);
    const len = 3 + t.rng.int(5);
    for (let k = 0; k < len; k++) t.shade(x0 + k, y, 0.88);
  }
  return t;
}

/** Wrapping Voronoi cells, used for cobblestone and gravel-like patterns. */
function cells(t: Tile, count: number): { id: Int8Array; edge: Float32Array } {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([t.rng.range(0, 16), t.rng.range(0, 16)]);
  const id = new Int8Array(256);
  const edge = new Float32Array(256);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x + 0.5 - pts[i][0]);
        let dy = Math.abs(y + 0.5 - pts[i][1]);
        if (dx > 8) dx = 16 - dx;
        if (dy > 8) dy = 16 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) d2 = d;
      }
      id[y * 16 + x] = best;
      edge[y * 16 + x] = d2 - d1;
    }
  return { id, edge };
}

function cobble(name: string, moss: boolean): Tile {
  const t = new Tile(name);
  const { id, edge } = cells(t, 9);
  const tones = Array.from({ length: 9 }, () => t.rng.range(0.82, 1.12));
  const mossSeed = t.rng.nextU32();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      let c: RGB = shadeRGB(hex(0x7a7a7c), tones[id[i]] * t.rng.range(0.94, 1.06));
      if (edge[i] < 0.9) c = hex(0x4a4a4e);
      else if (edge[i] < 1.6) c = shadeRGB(c, 0.82);
      if (moss && Tile.valueNoise(mossSeed, x, y, 4) > 0.55) c = mixRGB(c, hex(0x4f7a2e), 0.75);
      t.set(x, y, c);
    }
  return t;
}

function planks(name: string, base: RGB): Tile {
  const t = new Tile(name);
  for (let board = 0; board < 4; board++) {
    const tone = t.rng.range(0.9, 1.08);
    const seam = t.rng.int(16);
    for (let row = 0; row < 4; row++) {
      const y = board * 4 + row;
      for (let x = 0; x < 16; x++) {
        let c = shadeRGB(base, tone * t.rng.range(0.95, 1.04));
        if (row === 3) c = shadeRGB(base, 0.62);
        else if (row === 0) c = shadeRGB(c, 1.06);
        if (x === seam && row < 3) c = shadeRGB(base, 0.7);
        t.set(x, y, c);
      }
      // Grain streaks.
      if (row === 1 && t.rng.chance(0.8)) {
        const x0 = t.rng.int(16);
        for (let k = 0; k < 5; k++) t.shade(x0 + k, y, 0.9);
      }
    }
    // Nail dots near each seam end.
    t.set((seam + 1) & 15, board * 4 + 1, shadeRGB(base, 0.55));
    t.set((seam + 14) & 15, board * 4 + 1, shadeRGB(base, 0.55));
  }
  return t;
}

function logSide(name: string, kind: keyof typeof WOOD): Tile {
  const t = new Tile(name);
  const w = WOOD[kind];
  if (kind === 'birch') {
    t.fill(w.bark).jitter(0.04);
    for (let i = 0; i < 9; i++) {
      const y = t.rng.int(16);
      const x0 = t.rng.int(16);
      const len = 2 + t.rng.int(4);
      for (let k = 0; k < len; k++) t.set(x0 + k, y, hex(k === 0 || k === len - 1 ? 0x4a4a44 : 0x2c2c28));
    }
    return t;
  }
  for (let x = 0; x < 16; x++) {
    const tone = t.rng.range(0.85, 1.12);
    const groove = t.rng.chance(0.25);
    for (let y = 0; y < 16; y++) {
      let c = shadeRGB(w.bark, tone * t.rng.range(0.93, 1.05));
      if (groove && t.rng.chance(0.8)) c = shadeRGB(w.bark, 0.68);
      t.set(x, y, c);
    }
  }
  return t;
}

function logTop(name: string, kind: keyof typeof WOOD): Tile {
  const t = new Tile(name);
  const w = WOOD[kind];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) + Math.hypot(x - 7.5, y - 7.5) * 0.25;
      const ring = Math.floor(d * 0.8) % 2 === 0;
      t.set(x, y, shadeRGB(ring ? w.ring : w.heart, t.rng.range(0.95, 1.04)));
    }
  const bark = kind === 'birch' ? hex(0xd9d6c8) : w.bark;
  t.border(bark);
  return t;
}

function ore(name: string, colors: readonly RGB[], clusters = 4): Tile {
  const t = stoneBase(name);
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + t.rng.int(12);
    const cy = 2 + t.rng.int(12);
    const size = 3 + t.rng.int(3);
    let x = cx;
    let y = cy;
    for (let k = 0; k < size; k++) {
      t.set(x, y, colors[k === 0 ? 0 : 1 + t.rng.int(colors.length - 1)]);
      if (t.rng.chance(0.5)) x += t.rng.chance(0.5) ? 1 : -1;
      else y += t.rng.chance(0.5) ? 1 : -1;
    }
    // Highlight pixel for a crystalline look.
    t.set(cx, cy - 1, shadeRGB(colors[0], 1.25));
  }
  return t;
}

function metalBlock(name: string, base: RGB, pattern: 'plate' | 'gem' | 'coal'): Tile {
  const t = new Tile(name).fill(base).jitter(0.035);
  if (pattern === 'plate') {
    for (let i = 3; i < 13; i += 4) for (let k = 2; k < 14; k++) t.shade(k, i, 1.08);
  } else if (pattern === 'gem') {
    for (let y = 2; y < 14; y++)
      for (let x = 2; x < 14; x++) if ((x + y) % 6 === 0 || (x - y + 16) % 6 === 0) t.shade(x, y, 1.15);
  } else {
    for (let i = 0; i < 20; i++) t.shade(t.rng.int(16), t.rng.int(16), t.rng.chance(0.5) ? 1.6 : 0.7);
  }
  return t.bevel(1.25, 0.7);
}

function plant(name: string, draw: (t: Tile) => void): Tile {
  const t = new Tile(name).clear();
  draw(t);
  return t;
}

function stem(t: Tile, x: number, y0: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) t.set(x, y, shadeRGB(c, 0.9 + 0.2 * ((y * 7) % 3) * 0.3));
}

function flower(name: string, petal: RGB, center: RGB, shape: 'round' | 'cup' | 'bell'): Tile {
  return plant(name, (t) => {
    const green = hex(0x3f8a2a);
    stem(t, 7, 8, 15, green);
    t.set(6, 12, green);
    t.set(5, 11, green);
    t.set(8, 13, green);
    t.set(9, 12, green);
    if (shape === 'round') {
      for (let y = 3; y <= 7; y++)
        for (let x = 5; x <= 9; x++) {
          const d = Math.hypot(x - 7, y - 5);
          if (d <= 2.3) t.set(x, y, shadeRGB(petal, 1 - d * 0.06));
        }
      t.set(7, 5, center);
      t.set(7, 4, shadeRGB(center, 1.2));
    } else if (shape === 'cup') {
      for (let y = 3; y <= 7; y++)
        for (let x = 5; x <= 9; x++) {
          if (y === 3 && (x === 6 || x === 8)) continue;
          if (y > 5 && (x === 5 || x === 9)) continue;
          t.set(x, y, shadeRGB(petal, y < 5 ? 1.12 : 0.9));
        }
      t.set(7, 6, center);
    } else {
      for (let y = 4; y <= 8; y++) {
        const half = y < 6 ? 1 : 2;
        for (let x = 7 - half; x <= 7 + half; x++) t.set(x, y, shadeRGB(petal, x === 7 - half ? 0.85 : 1.05));
      }
      t.set(6, 9, petal);
      t.set(8, 9, petal);
      t.set(7, 9, center);
    }
  });
}

function wool(name: string, color: RGB): Tile {
  const t = new Tile(name).fill(color);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) t.shade(x, y, ((x + (y >> 1)) & 3) === 0 ? 0.92 : t.rng.range(0.97, 1.04));
  return t;
}

const WOOL_RGB: Record<(typeof WOOL_COLORS)[number], number> = {
  white: 0xe9ecec,
  orange: 0xe8741a,
  magenta: 0xb54bb0,
  light_blue: 0x4fb0da,
  yellow: 0xf6c83a,
  lime: 0x72bc1f,
  pink: 0xee91ab,
  gray: 0x40474b,
  light_gray: 0x8f8f88,
  cyan: 0x178d92,
  purple: 0x7a2eaa,
  blue: 0x363a9c,
  brown: 0x754a2a,
  green: 0x566e1d,
  red: 0xa62a26,
  black: 0x18181c,
};

function frames(n: number, make: (i: number) => Tile): Tile[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function fluidFrame(name: string, i: number, n: number, base: readonly RGB[], alpha: number): Tile {
  const t = new Tile(`${name}`);
  const s1 = tileSeed(name);
  const s2 = tileSeed(name + '2');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const phase = (i / n) * 16;
      const a = Tile.valueNoise(s1, x + phase, y + phase * 0.5, 4);
      const b = Tile.valueNoise(s2, x - phase * 0.5, y + phase, 8);
      const v = (a + b) / 2;
      t.set(x, y, base[Math.min(base.length - 1, Math.floor(v * base.length))], alpha);
    }
  return t;
}

// --- Recipes -------------------------------------------------------------------------------

const PAINTERS: Record<string, Painter> = {
  stone: stoneBase,
  smooth_stone: (n) => new Tile(n).fill(hex(0xa0a0a2)).jitter(0.03).bevel(1.05, 0.8),
  cobblestone: (n) => cobble(n, false),
  mossy_cobblestone: (n) => cobble(n, true),
  stone_bricks: (n) => {
    const t = noisyFill(new Tile(n), P.stone, 0.5);
    for (let x = 0; x < 16; x++) {
      t.set(x, 7, hex(0x55555a));
      t.set(x, 15, hex(0x55555a));
    }
    for (let y = 0; y < 7; y++) t.set(7, y, hex(0x55555a));
    for (let y = 8; y < 15; y++) t.set(15, y, hex(0x55555a));
    for (let x = 0; x < 16; x++) {
      t.shade(x, 0, 1.15);
      t.shade(x, 8, 1.15);
    }
    return t;
  },
  dirt: (n) => {
    const t = noisyFill(new Tile(n), P.dirt, 0.4);
    for (let i = 0; i < 5; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x9a8a78));
    return t;
  },
  farmland: (n) => {
    const t = noisyFill(
      new Tile(n),
      P.dirt.map((c) => shadeRGB(c, 0.72)),
      0.4,
    );
    for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) t.shade(x, y, 0.7);
    return t;
  },
  grass_top: (n) => {
    const t = noisyFill(new Tile(n), [0xa6a6a6, 0x999999, 0xb3b3b3, 0x8c8c8c].map(hex), 0.3);
    for (let i = 0; i < 10; i++) t.shade(t.rng.int(16), t.rng.int(16), 1.12);
    return t;
  },
  grass_side: (n) => {
    const t = PAINTERS.dirt(n) as Tile;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.setAlpha(x, y, 0);
    for (let x = 0; x < 16; x++) {
      const depth = 2 + t.rng.int(3) + (t.rng.chance(0.15) ? 2 : 0);
      for (let y = 0; y < depth; y++) {
        const g = [0xa6a6a6, 0x999999, 0xb0b0b0][t.rng.int(3)];
        t.set(x, y, shadeRGB(hex(g), y === depth - 1 ? 0.85 : 1), 255);
      }
    }
    return t;
  },
  sand: (n) => noisyFill(new Tile(n), P.sand, 0.3),
  gravel: (n) => {
    const t = new Tile(n);
    const { id, edge } = cells(t, 14);
    const tones = Array.from({ length: 14 }, () => P.gravel[t.rng.int(P.gravel.length)]);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const i = y * 16 + x;
        t.set(x, y, edge[i] < 0.6 ? hex(0x5a5550) : shadeRGB(tones[id[i]], t.rng.range(0.92, 1.06)));
      }
    return t;
  },
  bedrock: (n) => noisyFill(new Tile(n), P.bedrock, 0.2),
  clay: (n) => noisyFill(new Tile(n), P.clay, 0.5),
  snow: (n) => noisyFill(new Tile(n), P.snow, 0.5),
  ice: (n) => {
    const t = new Tile(n).fill(hex(0x9cc2f5), 190).jitter(0.03);
    for (let i = 0; i < 3; i++) {
      let x = t.rng.int(16);
      let y = t.rng.int(16);
      for (let k = 0; k < 6; k++) {
        t.set(x, y, hex(0xdbeaff), 220);
        x += t.rng.chance(0.5) ? 1 : 0;
        y += 1;
      }
    }
    return t;
  },
  obsidian: (n) => {
    const t = noisyFill(new Tile(n), P.obsidian, 0.4);
    for (let i = 0; i < 6; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0x5a4280));
    return t;
  },
  sandstone: (n) => {
    const t = noisyFill(new Tile(n), P.sandstone, 0.6);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 3; y++) t.shade(x, y, 1.06);
      t.shade(x, 3, 0.86);
      t.shade(x, 11, 0.9);
    }
    return t;
  },
  sandstone_top: (n) => noisyFill(new Tile(n), P.sandstone, 0.7).bevel(1.04, 0.92),
  sandstone_bottom: (n) =>
    noisyFill(
      new Tile(n),
      P.sandstone.map((c) => shadeRGB(c, 0.94)),
      0.3,
    ),

  coal_ore: (n) => ore(n, [0x3a3a3a, 0x222222, 0x2e2e30, 0x4a4a4a].map(hex)),
  iron_ore: (n) => ore(n, [0xe6c3a4, 0xc79a78, 0xd8ae8c, 0xb08466].map(hex)),
  gold_ore: (n) => ore(n, [0xfff27a, 0xf2c62a, 0xe0a818, 0xfadc4a].map(hex), 3),
  diamond_ore: (n) => ore(n, [0xb4fff4, 0x4ee6d4, 0x2bbfb0, 0x7df2e6].map(hex), 3),
  lapis_ore: (n) => ore(n, [0x5a7ff0, 0x1f45b8, 0x2d57d4, 0x183a9a].map(hex), 4),
  iron_block: (n) => metalBlock(n, hex(0xd8d8d8), 'plate'),
  gold_block: (n) => metalBlock(n, hex(0xf5cf3a), 'plate'),
  diamond_block: (n) => metalBlock(n, hex(0x62e3d6), 'gem'),
  coal_block: (n) => metalBlock(n, hex(0x1c1c1e), 'coal'),

  oak_planks: (n) => planks(n, WOOD.oak.plank),
  spruce_planks: (n) => planks(n, WOOD.spruce.plank),
  birch_planks: (n) => planks(n, WOOD.birch.plank),
  oak_log: (n) => logSide(n, 'oak'),
  spruce_log: (n) => logSide(n, 'spruce'),
  birch_log: (n) => logSide(n, 'birch'),
  oak_log_top: (n) => logTop(n, 'oak'),
  spruce_log_top: (n) => logTop(n, 'spruce'),
  birch_log_top: (n) => logTop(n, 'birch'),
  leaves: (n) => {
    const t = new Tile(n);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const r = t.rng.next();
        if (r < 0.16) t.set(x, y, hex(0), 0);
        else t.set(x, y, hex([0x9a9a9a, 0x8a8a8a, 0xaaaaaa, 0x767676][t.rng.int(4)]));
      }
    return t;
  },
  glass: (n) => {
    const t = new Tile(n).clear();
    const frame = hex(0xdcecf0);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, frame, 230);
      t.set(i, 15, frame, 230);
      t.set(0, i, frame, 230);
      t.set(15, i, frame, 230);
    }
    for (let k = 0; k < 4; k++) {
      t.set(3 + k, 6 - k, hex(0xffffff), 170);
      t.set(9 + k, 12 - k, hex(0xffffff), 150);
    }
    return t;
  },
  bricks: (n) => {
    const t = new Tile(n);
    const mortar = hex(0xb9b1a6);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 === 0 ? 0 : 4;
      for (let y = row * 4; y < row * 4 + 4; y++)
        for (let x = 0; x < 16; x++) {
          const bx = (x + off) % 8;
          if (y % 4 === 3 || bx === 7) t.set(x, y, shadeRGB(mortar, t.rng.range(0.92, 1.05)));
          else t.set(x, y, shadeRGB(hex(0x9a4a38), t.rng.range(0.85, 1.12) * (y % 4 === 0 ? 1.08 : 1)));
        }
    }
    return t;
  },
  bookshelf: (n) => {
    const t = planks(n, WOOD.oak.plank);
    const spines = [0x7a2626, 0x28508a, 0x2e6a33, 0x8a6a1e, 0x5a2d6e, 0x3e3e3e].map(hex);
    for (const top of [1, 9]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + t.rng.int(2);
        const c = spines[t.rng.int(spines.length)];
        const h = 5 + t.rng.int(2);
        for (let k = 0; k < w && x < 15; k++, x++)
          for (let y = top + (6 - h); y < top + 6; y++) t.set(x, y, shadeRGB(c, k === 0 ? 1.15 : 1));
        if (t.rng.chance(0.2)) x++;
      }
    }
    return t;
  },
  tnt_side: (n) => {
    // "Blast keg": a banded wooden keg with a hazard stripe.
    const t = new Tile(n);
    for (let x = 0; x < 16; x++) {
      const stave = shadeRGB(hex(0x8a5a32), x % 4 === 0 ? 0.75 : t.rng.range(0.92, 1.08));
      for (let y = 0; y < 16; y++) t.set(x, y, stave);
    }
    for (const y of [1, 2, 13, 14])
      for (let x = 0; x < 16; x++) t.set(x, y, hex(y === 1 || y === 13 ? 0x5d5f63 : 0x44464a));
    for (let y = 6; y <= 9; y++)
      for (let x = 0; x < 16; x++) t.set(x, y, (x + y) % 4 < 2 ? hex(0xd23a2a) : hex(0xf0d060));
    return t;
  },
  tnt_top: (n) => {
    const t = new Tile(n).fill(hex(0x8a5a32)).jitter(0.06);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (Math.hypot(x - 7.5, y - 7.5) > 6.5) t.set(x, y, hex(0x44464a));
    t.rect(7, 6, 2, 4, hex(0x2c2c2c));
    t.set(7, 5, hex(0xe0d0b0));
    return t;
  },
  tnt_bottom: (n) => {
    const t = new Tile(n).fill(hex(0x7a4e2a)).jitter(0.06);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (Math.hypot(x - 7.5, y - 7.5) > 6.5) t.set(x, y, hex(0x44464a));
    return t;
  },
  torch: (n) =>
    plant(n, (t) => {
      for (let y = 7; y < 16; y++) {
        t.set(7, y, hex(0x7a5530));
        t.set(8, y, hex(0x5e4024));
      }
      t.set(7, 6, hex(0xffe27a));
      t.set(8, 6, hex(0xffb840));
      t.set(7, 5, hex(0xfff6c0));
      t.set(8, 5, hex(0xffd060));
    }),
  chest_side: (n) => {
    const t = planks(n, hex(0x9a6a36));
    t.border(hex(0x4a3218));
    for (let x = 0; x < 16; x++) t.set(x, 5, hex(0x4a3218));
    return t;
  },
  chest_front: (n) => {
    const t = PAINTERS.chest_side(n) as Tile;
    t.rect(7, 4, 2, 3, hex(0xc8c8d0));
    t.set(7, 6, hex(0x6a6a70));
    return t;
  },
  chest_top: (n) => {
    const t = planks(n, hex(0x9a6a36));
    return t.border(hex(0x4a3218));
  },
  crafting_table_top: (n) => {
    const t = planks(n, WOOD.oak.plank);
    t.border(hex(0x5a3e22));
    for (let i = 1; i < 15; i++) {
      t.set(i, 5, hex(0x7a5a34));
      t.set(i, 10, hex(0x7a5a34));
      t.set(5, i, hex(0x7a5a34));
      t.set(10, i, hex(0x7a5a34));
    }
    return t;
  },
  crafting_table_side: (n) => {
    const t = planks(n, WOOD.oak.plank);
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, hex(0x5a3e22));
      t.set(x, 1, hex(0x6e4c2a));
    }
    // A mallet.
    t.rect(3, 4, 4, 3, hex(0x6a6a70));
    for (let y = 7; y < 13; y++) t.set(5, y, hex(0x5e4024));
    // A hand drill.
    for (let y = 4; y < 12; y++) t.set(11, y, hex(0x9a9aa0));
    t.rect(10, 12, 3, 2, hex(0x5e4024));
    return t;
  },
  crafting_table_front: (n) => {
    const t = planks(n, WOOD.oak.plank);
    for (let x = 0; x < 16; x++) {
      t.set(x, 0, hex(0x5a3e22));
      t.set(x, 1, hex(0x6e4c2a));
    }
    // A square and a chisel.
    for (let i = 3; i < 10; i++) {
      t.set(i, 11, hex(0xa0a0a8));
      t.set(3, i + 1, hex(0xa0a0a8));
    }
    for (let y = 4; y < 9; y++) t.set(12, y, hex(0xb8b8c0));
    t.rect(11, 9, 3, 4, hex(0x7a2e1e));
    return t;
  },
  furnace_top: (n) => noisyFill(new Tile(n), P.stone, 0.5).bevel(1.1, 0.85),
  furnace_side: (n) => {
    const t = noisyFill(new Tile(n), P.stone, 0.5);
    for (let x = 0; x < 16; x++) t.shade(x, 7, 0.75);
    return t.bevel(1.1, 0.8);
  },
  furnace_front: (n) => furnaceFront(n, false),
  furnace_front_lit: (n) => furnaceFront(n, true),
  ladder: (n) =>
    plant(n, (t) => {
      const wood = hex(0x8a6436);
      for (let y = 0; y < 16; y++) {
        t.set(2, y, wood);
        t.set(3, y, shadeRGB(wood, 0.8));
        t.set(12, y, wood);
        t.set(13, y, shadeRGB(wood, 0.8));
      }
      for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) t.set(x, y, shadeRGB(wood, 1.1));
    }),
  cactus_side: (n) => {
    const t = new Tile(n);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const rib = x % 4 === 1;
        t.set(x, y, shadeRGB(hex(0x3a8a3a), rib ? 0.75 : t.rng.range(0.95, 1.08)));
      }
    for (let i = 0; i < 8; i++) t.set(t.rng.int(16), t.rng.int(16), hex(0xe6e2b0));
    return t;
  },
  cactus_top: (n) => {
    const t = new Tile(n);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        t.set(x, y, shadeRGB(hex(0x44983f), d > 5 ? 0.8 : d < 2 ? 1.15 : 1));
      }
    return t;
  },
  pumpkin_side: (n) => {
    const t = new Tile(n);
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++)
        t.set(x, y, shadeRGB(hex(0xd6801c), x % 5 === 0 ? 0.78 : t.rng.range(0.94, 1.06)));
    return t;
  },
  pumpkin_top: (n) => {
    const t = PAINTERS.pumpkin_side(n) as Tile;
    t.rect(7, 7, 2, 2, hex(0x5a4a1c));
    return t;
  },
  pumpkin_face: (n) => {
    const t = PAINTERS.pumpkin_side(n) as Tile;
    const dark = hex(0x3a220c);
    // Diamond eyes.
    for (const cx of [4, 11]) {
      t.set(cx, 4, dark);
      t.rect(cx - 1, 5, 3, 1, dark);
      t.set(cx, 6, dark);
    }
    // Zig-zag grin.
    for (let x = 3; x <= 12; x++) {
      t.set(x, 10, dark);
      t.set(x, 11 + (x % 2), dark);
    }
    return t;
  },
  glowstone: (n) => {
    const t = new Tile(n);
    const { id, edge } = cells(t, 10);
    const tones = Array.from({ length: 10 }, () => t.rng.range(0.75, 1.15));
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const i = y * 16 + x;
        const glow = Math.min(1, edge[i] / 3);
        t.set(x, y, shadeRGB(mixRGB(hex(0x9a6a2a), hex(0xffe6a0), glow), tones[id[i]]));
      }
    return t;
  },
  tall_grass: (n) =>
    plant(n, (t) => {
      for (let b = 0; b < 7; b++) {
        let x = 2 + t.rng.int(12);
        const h = 5 + t.rng.int(9);
        for (let k = 0; k < h; k++) {
          t.set(x, 15 - k, hex([0xa0a0a0, 0x8e8e8e, 0xb4b4b4][t.rng.int(3)]));
          if (k > 3 && t.rng.chance(0.25)) x += t.rng.chance(0.5) ? 1 : -1;
        }
      }
    }),
  dead_bush: (n) =>
    plant(n, (t) => {
      const c = hex(0x8a6a3a);
      const branch = (x: number, y: number, dx: number, len: number): void => {
        for (let k = 0; k < len; k++) {
          t.set(x, y, shadeRGB(c, t.rng.range(0.85, 1.1)));
          y--;
          if (k % 2 === 1) x += dx;
        }
      };
      branch(7, 15, 0, 5);
      branch(7, 11, -1, 6);
      branch(8, 11, 1, 6);
      branch(7, 9, 1, 5);
    }),
  sugar_cane: (n) =>
    plant(n, (t) => {
      for (const x of [3, 8, 12]) {
        for (let y = 0; y < 16; y++) {
          const joint = (y + x) % 5 === 0;
          t.set(x, y, hex(joint ? 0x7e7e7e : 0xb8b8b8));
          t.set(x + 1, y, hex(joint ? 0x6a6a6a : 0x9c9c9c));
        }
        t.set(x - 1, (x * 3) % 16, hex(0xa8a8a8));
        t.set(x + 2, (x * 5 + 7) % 16, hex(0xa8a8a8));
      }
    }),
  yellow_flower: (n) => flower(n, hex(0xf6d13a), hex(0xd87a1a), 'round'),
  red_flower: (n) => flower(n, hex(0xd8342a), hex(0x3a1a12), 'cup'),
  blue_flower: (n) => flower(n, hex(0x8cc8f0), hex(0xf0f4ff), 'bell'),
  brown_mushroom: (n) =>
    plant(n, (t) => {
      t.rect(7, 10, 2, 5, hex(0xd8d0c0));
      t.rect(4, 8, 8, 2, hex(0x8a6446));
      t.rect(5, 7, 6, 1, hex(0x9c7454));
    }),
  red_mushroom: (n) =>
    plant(n, (t) => {
      t.rect(7, 10, 2, 5, hex(0xe0dace));
      t.rect(4, 6, 8, 4, hex(0xc42a22));
      t.rect(5, 5, 6, 1, hex(0xd83a30));
      t.set(6, 7, hex(0xf4f0e8));
      t.set(9, 6, hex(0xf4f0e8));
      t.set(10, 8, hex(0xf4f0e8));
    }),
  oak_sapling: (n) => sapling(n, hex(0x4e9a2e), 'round'),
  birch_sapling: (n) => sapling(n, hex(0x7aa84a), 'round'),
  spruce_sapling: (n) => sapling(n, hex(0x2e5a34), 'cone'),
  water: (n) => frames(8, (i) => fluidFrame(n, i, 8, [0x9ab4e8, 0xa8c0f0, 0xb8ccf6, 0xc8d8fa].map(hex), 170)),
  lava: (n) => frames(8, (i) => fluidFrame(n, i, 8, [0xc83a0a, 0xe25a12, 0xf08a1c, 0xffc040].map(hex), 255)),
};

for (let stage = 0; stage < 8; stage++) {
  PAINTERS[`wheat_${stage}`] = (n) =>
    plant(n, (t) => {
      const h = 3 + stage * 1.6;
      const col = mixRGB(hex(0x4e9a2e), hex(0xc9a84a), stage / 7);
      for (const x of [2, 5, 9, 13]) {
        for (let k = 0; k < h; k++) t.set(x, 15 - k, shadeRGB(col, 0.9 + (k % 3) * 0.06));
        if (stage >= 5) {
          t.set(x - 1, 16 - h, hex(0xd8b85a));
          t.set(x + 1, 17 - h, hex(0xc8a44a));
        }
      }
    });
}

for (const color of WOOL_COLORS) PAINTERS[`wool_${color}`] = (n) => wool(n, hex(WOOL_RGB[color]));

function sapling(name: string, leaf: RGB, shape: 'round' | 'cone'): Tile {
  return plant(name, (t) => {
    stem(t, 7, 9, 15, hex(0x6b4a2a));
    if (shape === 'round') {
      for (let y = 3; y <= 10; y++)
        for (let x = 3; x <= 12; x++)
          if (Math.hypot(x - 7.5, y - 6.5) < 4 && t.rng.chance(0.85))
            t.set(x, y, shadeRGB(leaf, t.rng.range(0.8, 1.15)));
    } else {
      for (let y = 2; y <= 11; y++) {
        const half = Math.floor((y - 2) / 2) + 1;
        for (let x = 8 - half; x < 8 + half; x++)
          if (t.rng.chance(0.9)) t.set(x, y, shadeRGB(leaf, t.rng.range(0.8, 1.2)));
      }
    }
  });
}

function furnaceFront(name: string, lit: boolean): Tile {
  const t = PAINTERS.furnace_side(name) as Tile;
  t.rect(4, 9, 8, 5, hex(0x1e1e20));
  for (let x = 4; x < 12; x++) t.set(x, 8, hex(0x4a4a4e));
  for (let x = 5; x < 12; x += 2) t.set(x, 3, hex(0x3a3a3e));
  if (lit) {
    for (let y = 10; y < 14; y++)
      for (let x = 5; x < 11; x++) {
        const hot = (14 - y) / 4 + t.rng.range(-0.2, 0.2);
        t.set(x, y, hot > 0.6 ? hex(0xffd84a) : hot > 0.3 ? hex(0xf08a1c) : hex(0xb8360e));
      }
  }
  return t;
}

/** Tint mask default: opaque tiles are fully tintable unless the recipe set alpha itself. */
export function paintTile(name: string): Tile[] {
  const painter = PAINTERS[name];
  if (!painter) return [missingTile(name)];
  const out = painter(name);
  return Array.isArray(out) ? out : [out];
}

export function hasPainter(name: string): boolean {
  return name in PAINTERS;
}

/** Magenta/black checkerboard for unknown textures. */
export function missingTile(name: string): Tile {
  const t = new Tile(name);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 3) ^ (y >> 3)) & 1 ? hex(0xf800f8) : hex(0));
  return t;
}
