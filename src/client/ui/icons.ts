import { BLOCKS, GRASS_TINT, getBlock } from '../../engine/blocks';
import { Face } from '../../engine/facing';
import { ITEMS } from '../../engine/items';
import { paintAllTiles } from '../../render/textures/atlas';
import type { Tile } from '../../render/textures/tile';

export const ICON = 32;
const COLS = 16;

export interface IconSheet {
  url: string;
  cols: number;
  rows: number;
  index: Map<string, number>;
}

let sheet: IconSheet | null = null;

const iconKey = (id: number, damage: number): string => `${id}:${damage}`;

/** Every (item, damage) pair that should have an icon: block items and their variants. */
export function iconEntries(): [number, number][] {
  const out: [number, number][] = [];
  for (const item of ITEMS) {
    if (!item) continue;
    const b = item.block !== undefined ? BLOCKS[item.block] : undefined;
    const variants = b && b.variantMeta ? b.variants : 1;
    for (let d = 0; d < variants; d++) out.push([item.id, d]);
  }
  return out;
}

function tileCanvas(tile: Tile, tint: number, mode: 'mask' | 'alpha', shade: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  const img = g.createImageData(16, 16);
  const tr = ((tint >> 16) & 255) / 255;
  const tg = ((tint >> 8) & 255) / 255;
  const tb = (tint & 255) / 255;
  for (let i = 0; i < 256; i++) {
    const a = tile.data[i * 4 + 3] / 255;
    const k = mode === 'mask' ? a : 1;
    for (let ch = 0; ch < 3; ch++) {
      const t = ch === 0 ? tr : ch === 1 ? tg : tb;
      const v = tile.data[i * 4 + ch];
      img.data[i * 4 + ch] = v * (1 - k + k * t) * shade;
    }
    img.data[i * 4 + 3] = mode === 'mask' ? 255 : tile.data[i * 4 + 3];
  }
  g.putImageData(img, 0, 0);
  return c;
}

function drawIcon(g: CanvasRenderingContext2D, ox: number, oy: number, id: number, damage: number): void {
  const tiles = paintAllTiles().byName;
  const item = ITEMS[id];
  if (!item || item.block === undefined) return;
  const def = getBlock(item.block);
  const meta = def.variantMeta ? damage : 0;
  const tex = def.textures(meta);
  const tintFor = (face: number): number => {
    if (def.name === 'grass_block')
      return face === Face.Up ? GRASS_TINT : face === Face.Down ? 0xffffff : GRASS_TINT;
    return def.tint;
  };
  const tileOf = (face: number): Tile | undefined => tiles.get(tex[face]);
  g.save();
  g.imageSmoothingEnabled = false;
  if (def.shape === 'cube' || def.shape === 'fluid') {
    const mode = def.layer === 'opaque' ? 'mask' : 'alpha';
    const top = tileOf(Face.Up);
    const left = tileOf(Face.South);
    const right = tileOf(Face.East);
    if (top) {
      g.setTransform(1, 0.5, -1, 0.5, ox + 16, oy);
      g.drawImage(tileCanvas(top, tintFor(Face.Up), mode, 1), 0, 0);
    }
    if (left) {
      g.setTransform(1, 0.5, 0, 1, ox, oy + 8);
      g.drawImage(tileCanvas(left, tintFor(Face.South), mode, 0.8), 0, 0);
    }
    if (right) {
      g.setTransform(1, -0.5, 0, 1, ox + 16, oy + 16);
      g.drawImage(tileCanvas(right, tintFor(Face.East), mode, 0.62), 0, 0);
    }
  } else {
    const t = tileOf(Face.South);
    if (t) {
      g.setTransform(2, 0, 0, 2, ox, oy);
      g.drawImage(tileCanvas(t, def.tint, 'alpha', 1), 0, 0);
    }
  }
  g.restore();
}

/** Renders all item icons into one sprite sheet (built once, then used via CSS). */
export function iconSheet(): IconSheet {
  if (sheet) return sheet;
  const entries = iconEntries();
  const rows = Math.ceil(entries.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * ICON;
  canvas.height = rows * ICON;
  const g = canvas.getContext('2d')!;
  const index = new Map<string, number>();
  entries.forEach(([id, damage], i) => {
    index.set(iconKey(id, damage), i);
    drawIcon(g, (i % COLS) * ICON, Math.floor(i / COLS) * ICON, id, damage);
  });
  sheet = { url: canvas.toDataURL(), cols: COLS, rows, index };
  return sheet;
}

/** Applies an item icon as the background of an element of the given pixel size. */
export function applyIcon(elm: HTMLElement, id: number, damage: number, size: number): void {
  const s = iconSheet();
  const i = s.index.get(iconKey(id, damage)) ?? s.index.get(iconKey(id, 0));
  if (i === undefined) {
    elm.style.backgroundImage = '';
    return;
  }
  const scale = size / ICON;
  elm.style.backgroundImage = `url(${s.url})`;
  elm.style.backgroundSize = `${s.cols * ICON * scale}px ${s.rows * ICON * scale}px`;
  elm.style.backgroundPosition = `${-(i % s.cols) * size}px ${-Math.floor(i / s.cols) * size}px`;
}
