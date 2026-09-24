import { BLOCKS } from '../../engine/blocks';
import { ITEMS, ItemStack, itemDisplayName, type Inventory } from '../../engine/items';
import { el } from './dom';
import { applyIcon, iconEntries } from './icons';

const SLOT_ICON = 32;

/**
 * Creative inventory: a palette of every block/item plus the hotbar. Click an item to pick it
 * up, then click a hotbar slot to put it there. Hovering an item and pressing 1-9 sends it
 * straight to that hotbar slot; shift-click fills the first empty slot.
 */
export class CreativeInventory {
  readonly root: HTMLDivElement;
  private readonly hotbar: HTMLDivElement[] = [];
  private readonly tooltip: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private cursorStack: ItemStack | null = null;
  private hovered: ItemStack | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    const n = Number(e.key);
    if (this.hovered && n >= 1 && n <= 9) {
      this.inv.set(n - 1, this.hovered.clone());
      this.refresh();
    }
  };
  private readonly onMove = (e: MouseEvent): void => {
    this.tooltip.style.left = `${e.clientX + 14}px`;
    this.tooltip.style.top = `${e.clientY + 14}px`;
    this.cursor.style.left = `${e.clientX - 20}px`;
    this.cursor.style.top = `${e.clientY - 20}px`;
  };

  constructor(
    private readonly inv: Inventory,
    private readonly onClose: () => void,
  ) {
    const palette = el('div', { class: 'grid palette' });
    for (const [id, damage] of iconEntries()) {
      const def = ITEMS[id];
      if (!def || def.hidden) continue;
      const stack = new ItemStack(id, def.maxStack, damage);
      const slot = el('div', { class: 'slot' });
      applyIcon(slot, id, damage, SLOT_ICON);
      slot.addEventListener('mouseenter', () => this.hover(stack));
      slot.addEventListener('mouseleave', () => this.hover(null));
      slot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          let target = inv.slots.slice(0, 9).findIndex((s) => !s);
          if (target < 0) target = inv.selected;
          inv.set(target, stack.clone());
          this.refresh();
        } else {
          this.cursorStack = this.cursorStack ? null : stack.clone();
          this.refresh();
        }
      });
      palette.append(slot);
    }

    const hotbarGrid = el('div', { class: 'grid' });
    for (let i = 0; i < 9; i++) {
      const count = el('span', { class: 'count' });
      const slot = el('div', { class: 'slot' }, count);
      slot.addEventListener('mouseenter', () => this.hover(inv.slots[i]));
      slot.addEventListener('mouseleave', () => this.hover(null));
      slot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.button === 2) {
          inv.set(i, null);
        } else {
          const prev = inv.slots[i];
          inv.set(i, this.cursorStack);
          this.cursorStack = prev;
          inv.selected = i;
        }
        this.refresh();
      });
      this.hotbar.push(slot);
      hotbarGrid.append(slot);
    }

    this.tooltip = el('div', { class: 'tooltip hud-text' });
    this.tooltip.style.display = 'none';
    this.cursor = el('div', { class: 'slot' });
    Object.assign(this.cursor.style, {
      position: 'fixed',
      pointerEvents: 'none',
      background: 'transparent',
      border: 'none',
      zIndex: '9',
    });

    const panel = el(
      'div',
      { class: 'panel inventory' },
      el('h2', { text: `Creative inventory: ${BLOCKS.filter(Boolean).length - 1} blocks` }),
      palette,
      el('h2', { text: 'Hotbar (right-click a slot to clear, 1-9 over an item to assign)' }),
      hotbarGrid,
    );
    this.root = el(
      'div',
      {
        class: 'screen dim',
        on: {
          mousedown: (e) => {
            if (e.target === this.root) this.close();
          },
          contextmenu: (e) => e.preventDefault(),
        },
      },
      panel,
      this.tooltip,
      this.cursor,
    );
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('mousemove', this.onMove);
    this.refresh();
  }

  private hover(stack: ItemStack | null): void {
    this.hovered = stack;
    if (stack) {
      this.tooltip.textContent = itemDisplayName(stack.id, stack.damage);
      this.tooltip.style.display = 'block';
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  private refresh(): void {
    for (let i = 0; i < 9; i++) {
      const s = this.inv.slots[i];
      const slot = this.hotbar[i];
      slot.classList.toggle('selected', i === this.inv.selected);
      if (s) applyIcon(slot, s.id, s.damage, SLOT_ICON);
      else slot.style.backgroundImage = '';
      (slot.firstChild as HTMLElement).textContent = s && s.count > 1 ? String(s.count) : '';
    }
    if (this.cursorStack) {
      applyIcon(this.cursor, this.cursorStack.id, this.cursorStack.damage, SLOT_ICON);
      this.cursor.style.display = 'block';
    } else {
      this.cursor.style.display = 'none';
    }
  }

  close(): void {
    this.dispose();
    this.onClose();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('mousemove', this.onMove);
    this.root.remove();
  }
}
