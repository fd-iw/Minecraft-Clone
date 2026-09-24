import './client/ui/styles.css';
import { Game } from './client/game';
import { loadSettings, saveSettings, type Settings } from './client/settings';
import { DATA_VERSION, Storage, newWorldId, type WorldMeta } from './client/storage';
import {
  ScreenStack,
  createWorldScreen,
  errorScreen,
  loadingScreen,
  optionsScreen,
  pauseScreen,
  titleScreen,
  worldListScreen,
} from './client/ui/screens';
import type { GameMode } from './engine/player';
import { GAME_TITLE } from './shared/constants';
import { seedFromString } from './shared/rng';
import { WorkerPool } from './workers/pool';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');

class App {
  private readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private readonly ui = document.getElementById('ui') as HTMLDivElement;
  private readonly screens = new ScreenStack(this.ui);
  private settings: Settings = loadSettings();
  private storage: Storage | null = null;
  private pool: WorkerPool | null = null;
  game: Game | null = null;
  state: 'menu' | 'loading' | 'playing' | 'paused' | 'error' = 'menu';

  async boot(): Promise<void> {
    document.title = GAME_TITLE;
    try {
      this.storage = await Storage.open();
    } catch (e) {
      console.warn('Saving is unavailable (IndexedDB could not be opened)', e);
    }
    if (params.has('rd'))
      this.settings.renderDistance = Math.max(2, Math.min(16, Number(params.get('rd')) || 8));
    if (params.has('autostart')) {
      await this.autostart();
      return;
    }
    this.showTitle();
  }

  private getPool(): WorkerPool {
    if (!this.pool) {
      const cores = navigator.hardwareConcurrency || 4;
      this.pool = new WorkerPool(Math.max(2, Math.min(4, cores - 1)));
    }
    return this.pool;
  }

  private showTitle(): void {
    this.state = 'menu';
    this.screens.show(
      titleScreen({
        onPlay: () => void this.showWorlds(),
        onOptions: () => this.showOptions(() => this.showTitle()),
      }),
    );
  }

  private async showWorlds(): Promise<void> {
    const worlds = this.storage ? await this.storage.listWorlds() : [];
    this.screens.show(
      worldListScreen({
        worlds,
        onPlay: (w) => void this.play(w),
        onCreate: () => this.showCreate(),
        onDelete: async (w) => {
          await this.storage?.deleteWorld(w.id);
          await this.showWorlds();
        },
        onBack: () => this.showTitle(),
      }),
    );
  }

  private showCreate(): void {
    this.screens.show(
      createWorldScreen({
        onCreate: (name, seedText, mode) => void this.createAndPlay(name, seedText, mode),
        onCancel: () => void this.showWorlds(),
      }),
    );
  }

  private showOptions(onDone: () => void): void {
    this.screens.show(
      optionsScreen({
        settings: this.settings,
        onChange: (s) => {
          this.settings = s;
          saveSettings(s);
          this.game?.applySettings(s);
        },
        onDone,
      }),
    );
  }

  private newMeta(name: string, seedText: string, mode: GameMode, id = newWorldId()): WorldMeta {
    const text = seedText.trim();
    const seed = text === '' ? (Math.random() * 2 ** 31) | 0 : seedFromString(text);
    return {
      id,
      name,
      seed,
      seedText: text === '' ? String(seed) : text,
      gameMode: mode,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      time: 0,
      dayTime: 1000,
      dataVersion: DATA_VERSION,
    };
  }

  private async createAndPlay(name: string, seedText: string, mode: GameMode): Promise<void> {
    const meta = this.newMeta(name, seedText, mode);
    await this.storage?.saveWorld(meta);
    await this.play(meta);
  }

  private async autostart(): Promise<void> {
    const id = params.get('world') ?? 'autostart';
    let meta = this.storage ? await this.storage.getWorld(id) : undefined;
    if (!meta || params.has('fresh')) {
      if (meta) await this.storage?.deleteWorld(id);
      meta = this.newMeta('Autostart World', params.get('seed') ?? 'stratavale', 'creative', id);
      await this.storage?.saveWorld(meta);
    }
    await this.play(meta);
  }

  private async play(meta: WorldMeta): Promise<void> {
    this.state = 'loading';
    const loading = loadingScreen();
    this.screens.show(loading.root);
    try {
      this.game = new Game({
        canvas: this.canvas,
        uiRoot: this.ui,
        storage: this.storage,
        meta,
        settings: this.settings,
        pool: this.getPool(),
        pointerLock: !TEST,
        audio: !TEST,
        onPause: () => this.showPause(),
        onLoadProgress: (text, frac) => loading.set(text, frac),
        onReady: () => {
          this.state = 'playing';
          this.screens.clear();
          document.body.dataset.state = 'playing';
        },
      });
      this.game.start();
    } catch (e) {
      this.fail(e);
    }
  }

  private showPause(): void {
    this.state = 'paused';
    const resume = (): void => {
      window.removeEventListener('keydown', onKey);
      this.screens.clear();
      this.state = 'playing';
      this.game?.resume();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') resume();
    };
    const show = (): void => {
      this.screens.show(
        pauseScreen({
          onResume: resume,
          onOptions: () => this.showOptions(show),
          onQuit: () => {
            window.removeEventListener('keydown', onKey);
            void this.quitToTitle();
          },
        }),
      );
    };
    // Defer so the Escape that released the pointer doesn't immediately resume.
    setTimeout(() => window.addEventListener('keydown', onKey), 0);
    show();
  }

  private async quitToTitle(): Promise<void> {
    const game = this.game;
    this.game = null;
    const saving = loadingScreen();
    saving.set('Saving world...', 1);
    this.screens.show(saving.root);
    try {
      await game?.quit();
    } catch (e) {
      console.error('Save failed', e);
    }
    delete document.body.dataset.state;
    this.showTitle();
  }

  private fail(e: unknown): void {
    console.error(e);
    this.state = 'error';
    this.game?.dispose();
    this.game = null;
    const msg = e instanceof Error ? e.message : String(e);
    this.screens.show(
      errorScreen(
        msg.includes('WebGL')
          ? `${msg}.\nYour browser or GPU does not support WebGL2, which the game needs.`
          : msg,
        () => this.showTitle(),
      ),
    );
  }
}

const app = new App();
void app.boot();

// Test/debug handle.
if (TEST || import.meta.env.DEV) {
  (window as unknown as { __stratavale: unknown }).__stratavale = {
    get state() {
      return app.game?.state ?? app.state;
    },
    stats: () => app.game?.stats() ?? null,
    sampleFrame: () => app.game?.renderer.sampleFrame() ?? 0,
    placeBelow: () => app.game?.simulatePlaceBelow() ?? null,
    blockAt: (x: number, y: number, z: number) => app.game?.blockAt(x, y, z) ?? -1,
    saveNow: () => app.game?.save(),
    player: () => app.game?.player.save() ?? null,
    debug: () => app.game?.debugLines() ?? [],
  };
}
