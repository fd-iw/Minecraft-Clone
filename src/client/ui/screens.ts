import type { GameMode } from '../../engine/player';
import { GAME_TITLE, GAME_VERSION } from '../../shared/constants';
import type { Settings } from '../settings';
import type { WorldMeta } from '../storage';
import { button, el } from './dom';

/** Shows at most one full-screen menu at a time inside the UI root. */
export class ScreenStack {
  private current: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  show(screen: HTMLElement): void {
    this.current?.remove();
    this.current = screen;
    this.root.append(screen);
    screen.querySelector<HTMLElement>('input, .btn')?.focus();
  }

  clear(): void {
    this.current?.remove();
    this.current = null;
  }

  get active(): boolean {
    return this.current !== null;
  }
}

export function titleScreen(opts: { onPlay: () => void; onOptions: () => void }): HTMLElement {
  return el(
    'div',
    { class: 'screen backdrop' },
    el('h1', { class: 'title', text: GAME_TITLE.toUpperCase() }),
    el('div', { class: 'subtitle text-shadow', text: 'Dig deep. Build high.' }),
    el(
      'div',
      { class: 'col' },
      button('Singleplayer', opts.onPlay),
      (() => {
        const b = button('Multiplayer (coming later)', () => {});
        b.disabled = true;
        return b;
      })(),
      button('Options', opts.onOptions),
    ),
    el(
      'div',
      { class: 'footer-note' },
      el('span', { text: `${GAME_TITLE} ${GAME_VERSION}` }),
      el('span', { text: 'All textures and sounds are procedurally generated' }),
    ),
  );
}

export function worldListScreen(opts: {
  worlds: WorldMeta[];
  onPlay: (w: WorldMeta) => void;
  onCreate: () => void;
  onDelete: (w: WorldMeta) => void;
  onBack: () => void;
}): HTMLElement {
  let selected: WorldMeta | null = opts.worlds[0] ?? null;
  const items = new Map<WorldMeta, HTMLElement>();
  const play = button('Play Selected World', () => selected && opts.onPlay(selected));
  const del = button(
    'Delete',
    () => {
      if (!selected) return;
      if (confirm(`Delete "${selected.name}"? This cannot be undone.`)) opts.onDelete(selected);
    },
    'small danger',
  );
  const refresh = (): void => {
    for (const [w, e] of items) e.classList.toggle('selected', w === selected);
    play.disabled = !selected;
    del.disabled = !selected;
  };
  const list = el('div', { class: 'world-list' });
  if (opts.worlds.length === 0)
    list.append(el('div', { class: 'empty-note', text: 'No worlds yet. Create one!' }));
  for (const w of opts.worlds) {
    const item = el(
      'div',
      {
        class: 'world-item',
        on: {
          click: () => {
            selected = w;
            refresh();
          },
          dblclick: () => opts.onPlay(w),
        },
      },
      el('div', { class: 'name', text: w.name }),
      el('div', {
        class: 'meta',
        text: `${w.gameMode === 'creative' ? 'Creative' : 'Survival'} · seed ${w.seedText || w.seed} · last played ${new Date(w.lastPlayed).toLocaleString()}`,
      }),
    );
    items.set(w, item);
    list.append(item);
  }
  refresh();
  return el(
    'div',
    { class: 'screen backdrop' },
    el('h2', { class: 'text-shadow', text: 'Select World' }),
    el('div', { class: 'panel' }, list),
    el('div', { class: 'col' }, play, button('Create New World', opts.onCreate)),
    el('div', { class: 'row' }, del, button('Back', opts.onBack, 'small')),
  );
}

export function createWorldScreen(opts: {
  onCreate: (name: string, seed: string, mode: GameMode) => void;
  onCancel: () => void;
}): HTMLElement {
  const name = el('input', { attrs: { type: 'text', value: 'New World', maxlength: '32' } });
  const seed = el('input', {
    attrs: { type: 'text', placeholder: 'Leave blank for a random seed', maxlength: '32' },
  });
  let mode: GameMode = 'creative';
  const modeBtn = button('', () => {
    mode = mode === 'creative' ? 'survival' : 'creative';
    sync();
  });
  const sync = (): void => {
    modeBtn.textContent = `Game Mode: ${mode === 'creative' ? 'Creative' : 'Survival'}`;
  };
  sync();
  const create = (): void => opts.onCreate(name.value.trim() || 'New World', seed.value, mode);
  name.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  return el(
    'div',
    { class: 'screen backdrop' },
    el('h2', { class: 'text-shadow', text: 'Create New World' }),
    el(
      'div',
      { class: 'panel col' },
      el('label', { class: 'field' }, 'World name', name),
      el('label', { class: 'field' }, 'Seed', seed),
      modeBtn,
    ),
    el('div', { class: 'col' }, button('Create World', create), button('Cancel', opts.onCancel)),
  );
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  fmt: (v: number) => string,
  onInput: (v: number) => void,
): HTMLElement {
  const text = el('span', { text: `${label}: ${fmt(value)}` });
  const input = el('input', {
    attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) },
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    text.textContent = `${label}: ${fmt(v)}`;
    onInput(v);
  });
  return el('label', { class: 'field', style: { width: 'min(400px, calc(100vw - 32px))' } }, text, input);
}

export function optionsScreen(opts: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onDone: () => void;
}): HTMLElement {
  const s = { ...opts.settings };
  const upd = (patch: Partial<Settings>): void => {
    Object.assign(s, patch);
    opts.onChange({ ...s });
  };
  const bob = button('', () => {
    upd({ viewBobbing: !s.viewBobbing });
    bob.textContent = `View Bobbing: ${s.viewBobbing ? 'ON' : 'OFF'}`;
  });
  bob.textContent = `View Bobbing: ${s.viewBobbing ? 'ON' : 'OFF'}`;
  const inv = button('', () => {
    upd({ invertY: !s.invertY });
    inv.textContent = `Invert Mouse: ${s.invertY ? 'ON' : 'OFF'}`;
  });
  inv.textContent = `Invert Mouse: ${s.invertY ? 'ON' : 'OFF'}`;
  return el(
    'div',
    { class: 'screen dim' },
    el('h2', { class: 'text-shadow', text: 'Options' }),
    el(
      'div',
      { class: 'panel col' },
      slider(
        'Render Distance',
        2,
        16,
        1,
        s.renderDistance,
        (v) => `${v} chunks`,
        (v) => upd({ renderDistance: v }),
      ),
      slider(
        'FOV',
        50,
        110,
        1,
        s.fov,
        (v) => `${v}`,
        (v) => upd({ fov: v }),
      ),
      slider(
        'Mouse Sensitivity',
        0.05,
        1,
        0.05,
        s.sensitivity,
        (v) => `${Math.round(v * 200)}%`,
        (v) => upd({ sensitivity: v }),
      ),
      bob,
      inv,
    ),
    button('Done', opts.onDone),
  );
}

export function pauseScreen(opts: {
  onResume: () => void;
  onOptions: () => void;
  onQuit: () => void;
}): HTMLElement {
  return el(
    'div',
    { class: 'screen dim' },
    el('h2', { class: 'text-shadow', text: 'Game Paused' }),
    el(
      'div',
      { class: 'col' },
      button('Back to Game', opts.onResume),
      button('Options', opts.onOptions),
      button('Save and Quit to Title', opts.onQuit),
    ),
  );
}

export function loadingScreen(): { root: HTMLElement; set: (text: string, frac: number) => void } {
  const label = el('div', { class: 'text-shadow', text: 'Loading...' });
  const bar = el('div');
  const root = el('div', { class: 'screen backdrop' }, label, el('div', { class: 'progress' }, bar));
  return {
    root,
    set(text, frac) {
      label.textContent = text;
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    },
  };
}

export function errorScreen(message: string, onBack: () => void): HTMLElement {
  return el(
    'div',
    { class: 'screen backdrop' },
    el('h2', { class: 'text-shadow', text: 'Something went wrong' }),
    el('div', { class: 'panel', style: { maxWidth: '640px', whiteSpace: 'pre-wrap' }, text: message }),
    button('Back to Title', onBack),
  );
}
