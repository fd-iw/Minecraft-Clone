import { BLOCKS, LAVA, LIT_FURNACE, WATER, WHEAT, type ToolKind } from './blocks';

/** Item ids below this are block items whose id equals the block type id. */
export const FIRST_PURE_ITEM_ID = 1024;

export interface ToolInfo {
  kind: ToolKind;
  /** 0 wood, 1 stone, 2 iron, 3 diamond, 4 gold (gold mines like wood but fast). */
  tier: number;
  speed: number;
}

export interface ItemDef {
  readonly id: number;
  readonly name: string;
  readonly displayName: string;
  readonly maxStack: number;
  /** Block type placed by this item, if any. */
  readonly block?: number;
  readonly maxDamage: number;
  readonly tool?: ToolInfo;
  /** Hidden from the creative palette. */
  readonly hidden: boolean;
  /** Texture used for flat item icons (pure items). */
  readonly icon?: string;
}

export const ITEMS: ItemDef[] = [];
const byName = new Map<string, ItemDef>();

function add(def: ItemDef): ItemDef {
  if (ITEMS[def.id]) throw new Error(`Duplicate item id ${def.id}`);
  ITEMS[def.id] = def;
  byName.set(def.name, def);
  return def;
}

const NOT_ITEMS = new Set([0, WATER, LAVA, LIT_FURNACE, WHEAT]);

for (const b of BLOCKS) {
  if (!b || NOT_ITEMS.has(b.id)) continue;
  add({
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    maxStack: 64,
    block: b.id,
    maxDamage: 0,
    hidden: false,
  });
}

export function getItem(id: number): ItemDef | undefined {
  return ITEMS[id];
}

export function itemByName(name: string): ItemDef | undefined {
  return byName.get(name);
}

export function itemDisplayName(id: number, damage: number): string {
  const def = ITEMS[id];
  if (!def) return 'Unknown';
  if (def.block !== undefined) {
    const b = BLOCKS[def.block];
    if (b.variantNames && b.variantMeta) return b.variantNames[damage & 15] ?? def.displayName;
  }
  return def.displayName;
}

export class ItemStack {
  constructor(
    public id: number,
    public count = 1,
    public damage = 0,
  ) {}

  get def(): ItemDef | undefined {
    return ITEMS[this.id];
  }

  get maxStack(): number {
    return this.def?.maxStack ?? 64;
  }

  clone(): ItemStack {
    return new ItemStack(this.id, this.count, this.damage);
  }

  canStackWith(o: ItemStack): boolean {
    return o.id === this.id && o.damage === this.damage && (this.def?.maxDamage ?? 0) === 0;
  }

  toJSON(): [number, number, number] {
    return [this.id, this.count, this.damage];
  }

  static fromJSON(j: unknown): ItemStack | null {
    if (!Array.isArray(j) || typeof j[0] !== 'number') return null;
    if (!ITEMS[j[0]]) return null;
    return new ItemStack(j[0], j[1] ?? 1, j[2] ?? 0);
  }
}

/** Player inventory: 36 main slots, of which 0..8 are the hotbar. */
export class Inventory {
  static readonly SIZE = 36;
  readonly slots: (ItemStack | null)[] = new Array(Inventory.SIZE).fill(null);
  selected = 0;
  /** Bumped whenever contents change, so UIs can cheaply detect updates. */
  version = 0;

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  set(slot: number, stack: ItemStack | null): void {
    this.slots[slot] = stack && stack.count > 0 ? stack : null;
    this.version++;
  }

  /** Adds a stack, merging into existing ones first. Returns the leftover count. */
  add(stack: ItemStack): number {
    let left = stack.count;
    for (let i = 0; i < Inventory.SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.canStackWith(stack) && s.count < s.maxStack) {
        const n = Math.min(left, s.maxStack - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < Inventory.SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, stack.maxStack);
        this.slots[i] = new ItemStack(stack.id, n, stack.damage);
        left -= n;
      }
    }
    this.version++;
    return left;
  }

  /** Removes `n` items from a slot. */
  consume(slot: number, n = 1): void {
    const s = this.slots[slot];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[slot] = null;
    this.version++;
  }

  findSlot(id: number, damage: number): number {
    for (let i = 0; i < Inventory.SIZE; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.damage === damage) return i;
    }
    return -1;
  }

  toJSON(): unknown {
    return { selected: this.selected, slots: this.slots.map((s) => (s ? s.toJSON() : null)) };
  }

  load(j: unknown): void {
    const o = j as { selected?: number; slots?: unknown[] } | null;
    if (!o || !Array.isArray(o.slots)) return;
    for (let i = 0; i < Inventory.SIZE; i++) this.slots[i] = ItemStack.fromJSON(o.slots[i]);
    this.selected = Math.max(0, Math.min(8, o.selected ?? 0));
    this.version++;
  }
}
