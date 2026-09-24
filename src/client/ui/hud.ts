import { itemDisplayName, type Inventory } from '../../engine/items';
import { applyIcon } from './icons';
import { el } from './dom';

export interface DebugInfo {
  lines: string[];
}

/** In-game overlay: crosshair, hotbar, held item name, debug screen. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly counts: HTMLSpanElement[] = [];
  private readonly itemName: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly underwater: HTMLDivElement;
  private invVersion = -1;
  private selected = -1;
  private nameTimer = 0;
  showDebug = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'hud' });
    const hotbar = el('div', { class: 'hotbar' });
    for (let i = 0; i < 9; i++) {
      const count = el('span', { class: 'count' });
      const slot = el('div', { class: 'slot' }, count);
      this.slots.push(slot);
      this.counts.push(count);
      hotbar.append(slot);
    }
    this.itemName = el('div', { class: 'item-name hud-text' });
    this.debug = el('div', { class: 'debug hud-text' });
    this.debug.style.display = 'none';
    this.hint = el('div', { class: 'hint hud-text' });
    this.underwater = el('div', { class: 'underwater' });
    this.root.append(
      this.underwater,
      el('div', { class: 'crosshair' }),
      hotbar,
      this.itemName,
      this.debug,
      this.hint,
    );
    parent.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }

  update(inv: Inventory, dt: number, underwater: boolean): void {
    if (inv.version !== this.invVersion) {
      this.invVersion = inv.version;
      for (let i = 0; i < 9; i++) {
        const s = inv.slots[i];
        if (s) {
          applyIcon(this.slots[i], s.id, s.damage, 32);
          this.counts[i].textContent = s.count > 1 ? String(s.count) : '';
        } else {
          this.slots[i].style.backgroundImage = '';
          this.counts[i].textContent = '';
        }
      }
    }
    if (inv.selected !== this.selected || this.nameTimer === -1) {
      if (this.selected >= 0) this.slots[this.selected].classList.remove('selected');
      this.selected = inv.selected;
      this.slots[this.selected].classList.add('selected');
      const held = inv.held;
      this.itemName.textContent = held ? itemDisplayName(held.id, held.damage) : '';
      this.nameTimer = 2;
      this.itemName.style.opacity = '1';
    }
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.itemName.style.opacity = '0';
    }
    this.underwater.style.display = underwater ? 'block' : 'none';
  }

  /** Forces the held-item name to show again (e.g. after the held stack changed). */
  flashItemName(): void {
    this.nameTimer = -1;
  }

  setDebug(lines: string[] | null): void {
    if (!lines || !this.showDebug) {
      this.debug.style.display = 'none';
      return;
    }
    this.debug.style.display = 'block';
    this.debug.textContent = lines.join('\n');
  }
}
