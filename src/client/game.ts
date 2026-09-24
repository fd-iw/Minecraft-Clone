import { breakBlock, pickBlock, placeBlock } from '../engine/actions';
import {
  BLOCKS,
  BRICKS,
  COBBLESTONE,
  DIRT,
  GLASS,
  GRASS_BLOCK,
  OAK_LOG,
  OAK_PLANKS,
  STONE,
  TORCH,
  WATER,
  blockType,
} from '../engine/blocks';
import { SEA_LEVEL, TICK_SECONDS } from '../engine/constants';
import { FACE_NAMES, faceFromYaw } from '../engine/facing';
import { biomeInfo } from '../engine/worldgen/biomes';
import { findSpawn } from '../engine/worldgen/spawn';
import { raycast, type RayHit } from '../engine/physics/raycast';
import { NO_INPUT, type MoveInput } from '../engine/physics/movement';
import { Player } from '../engine/player';
import { selectionBoxes } from '../engine/shapes';
import { World } from '../engine/world';
import { GAME_TITLE, GAME_VERSION } from '../shared/constants';
import { clamp, lerp } from '../shared/math';
import { Renderer } from '../render/renderer';
import type { WorkerPool } from '../workers/pool';
import { Audio } from './audio';
import { ChunkLoader } from './chunkLoader';
import { Input } from './input';
import type { Settings } from './settings';
import type { Storage, WorldMeta } from './storage';
import { Hud } from './ui/hud';
import { CreativeInventory } from './ui/inventory';

export type GameState = 'loading' | 'playing' | 'paused' | 'inventory' | 'closed';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  storage: Storage | null;
  meta: WorldMeta;
  settings: Settings;
  pool: WorkerPool;
  pointerLock: boolean;
  audio: boolean;
  onPause: () => void;
  onLoadProgress: (text: string, frac: number) => void;
  onReady: () => void;
}

const TICK_MS = TICK_SECONDS * 1000;
const STARTER_KIT = [GRASS_BLOCK, DIRT, STONE, COBBLESTONE, OAK_PLANKS, OAK_LOG, GLASS, BRICKS, TORCH];
const SPAWN_RADIUS = 2;

/**
 * A running singleplayer session: owns the world, the player, chunk streaming, the renderer and
 * the fixed-rate game loop (20 ticks per second with interpolated rendering).
 */
export class Game {
  readonly world: World;
  readonly player = new Player();
  readonly loader: ChunkLoader;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly audio: Audio;
  state: GameState = 'loading';
  settings: Settings;
  target: RayHit | null = null;

  private acc = 0;
  private last = 0;
  private raf = 0;
  private ticks = 0;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private lastJumpTap = -100;
  private lastForwardTap = -100;
  private sprintLatched = false;
  private jumpWasDown = false;
  private forwardWasDown = false;
  private physicsReady = false;
  private needsSurfaceSpawn: boolean;
  private inventoryUi: CreativeInventory | null = null;
  private fovCurrent = 70;
  private bobPhase = 0;
  private bobAmount = 0;
  private stepDistance = 0;
  private frames = 0;
  private fpsTime = 0;
  fps = 0;
  private debugTimer = 0;
  private readonly startedAt = performance.now();
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly opts: GameOptions) {
    const { meta } = opts;
    this.settings = opts.settings;
    this.world = new World(meta.seed);
    this.world.time = meta.time;
    this.world.dayTime = meta.dayTime;
    this.loader = new ChunkLoader(this.world, opts.pool, opts.storage, meta.id);
    this.loader.renderDistance = this.settings.renderDistance;
    this.renderer = new Renderer(opts.canvas, this.world, opts.pool);
    this.renderer.setRenderDistance(this.settings.renderDistance);
    this.input = new Input(opts.canvas, { pointerLock: opts.pointerLock });
    this.hud = new Hud(opts.uiRoot);
    this.hud.setVisible(false);
    this.audio = new Audio(opts.audio);
    this.world.events.on('blockChanged', (e) => {
      if (e.cause !== 'player') return;
      const placed = e.newValue !== 0;
      const def = BLOCKS[blockType(placed ? e.newValue : e.oldValue)];
      if (def) this.audio.play(def.sound, placed ? 'place' : 'break');
    });

    if (meta.player) {
      this.player.load(meta.player);
      this.needsSurfaceSpawn = false;
    } else {
      const spawn = meta.spawn ?? findSpawn(meta.seed);
      meta.spawn = spawn;
      this.player.body.setPosition(spawn[0] + 0.5, spawn[1], spawn[2] + 0.5);
      this.player.gameMode = meta.gameMode;
      if (meta.gameMode === 'creative') this.player.giveStarterKit(STARTER_KIT);
      this.needsSurfaceSpawn = true;
    }
    this.player.gameMode = meta.gameMode;

    const onResize = (): void => this.renderer.resize();
    window.addEventListener('resize', onResize);
    this.listeners.push(() => window.removeEventListener('resize', onResize));
    const onLockChange = (): void => {
      if (this.state === 'playing' && this.input.usePointerLock && !this.input.isLocked) this.pause();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.listeners.push(() => document.removeEventListener('pointerlockchange', onLockChange));
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') {
        if (this.state === 'playing') this.pause();
        void this.save();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    this.listeners.push(() => document.removeEventListener('visibilitychange', onHide));
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      if (this.state === 'closed') return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // --- State transitions ----------------------------------------------------------------------

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.unlock();
    this.opts.onPause();
  }

  resume(): void {
    if (this.state !== 'paused' && this.state !== 'inventory') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.input.clearPresses();
    this.input.consumeMouse();
    this.input.lock();
    this.hud.setVisible(true);
  }

  openInventory(): void {
    if (this.state !== 'playing' || this.player.gameMode !== 'creative') return;
    this.state = 'inventory';
    this.input.enabled = false;
    this.input.unlock();
    this.inventoryUi = new CreativeInventory(this.player.inventory, () => {
      this.inventoryUi = null;
      this.resume();
    });
    this.opts.uiRoot.append(this.inventoryUi.root);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.loader.renderDistance = s.renderDistance;
    this.renderer.setRenderDistance(s.renderDistance);
  }

  // --- Main loop ------------------------------------------------------------------------------

  private frame(now: number): void {
    let dt = now - this.last;
    this.last = now;
    if (dt > 1000) dt = TICK_MS;

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }

    const body = this.player.body;
    this.loader.update(body.x, body.z);

    if (this.state === 'loading') this.updateLoading();

    if (this.state === 'playing') {
      this.handleFrameInput();
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_MS && n < 10) {
        this.tick();
        this.acc -= TICK_MS;
        n++;
      }
      if (n === 10) this.acc = 0;
    }

    const alpha = this.state === 'playing' ? this.acc / TICK_MS : 1;
    this.render(alpha, dt / 1000);
  }

  private updateLoading(): void {
    const body = this.player.body;
    const ccx = Math.floor(body.x / 16);
    const ccz = Math.floor(body.z / 16);
    let meshed = 0;
    let total = 0;
    for (let dz = -SPAWN_RADIUS; dz <= SPAWN_RADIUS; dz++)
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        total++;
        if (this.renderer.chunks.isMeshed(ccx + dx, ccz + dz)) meshed++;
      }
    const loaded = this.world.chunks.size;
    this.opts.onLoadProgress(
      meshed < total ? `Building terrain (${loaded} chunks)` : 'Ready',
      meshed / total,
    );
    if (meshed >= total) {
      this.ensureSafeSpawn();
      this.state = 'playing';
      this.physicsReady = true;
      this.hud.setVisible(true);
      this.hud.setHint(
        this.input.usePointerLock ? 'Click to capture the mouse · E inventory · F3 debug' : '',
      );
      this.input.lock();
      this.opts.onReady();
    }
  }

  /** Puts the player on the surface on first spawn, and never inside a block. */
  private ensureSafeSpawn(): void {
    const b = this.player.body;
    const x = Math.floor(b.x);
    const z = Math.floor(b.z);
    if (this.needsSurfaceSpawn) {
      let best: [number, number] = [x, z];
      search: for (let r = 0; r < 8; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const h = this.world.getHeight(x + dx, z + dz);
            const top = BLOCKS[blockType(this.world.getBlock(x + dx, h, z + dz))];
            if (top && top.opaque && !top.name.endsWith('leaves') && !top.name.endsWith('_log')) {
              best = [x + dx, z + dz];
              break search;
            }
          }
      const h = this.world.getHeight(best[0], best[1]);
      b.setPosition(best[0] + 0.5, Math.max(h + 1, SEA_LEVEL + 1), best[1] + 0.5);
      this.needsSurfaceSpawn = false;
    }
    // Nudge upwards out of any block we might be embedded in.
    for (let i = 0; i < 64; i++) {
      const feet = blockType(this.world.getBlock(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)));
      const head = blockType(this.world.getBlock(Math.floor(b.x), Math.floor(b.y + 1), Math.floor(b.z)));
      if (!BLOCKS[feet]?.solid && !BLOCKS[head]?.solid) break;
      b.setPosition(b.x, Math.floor(b.y) + 1, b.z);
    }
  }

  private handleFrameInput(): void {
    const input = this.input;
    const body = this.player.body;
    const [mdx, mdy] = input.consumeMouse();
    const f = this.settings.sensitivity * 0.6 + 0.2;
    const k = f * f * f * 8 * 0.15 * (Math.PI / 180);
    body.yaw -= mdx * k;
    body.pitch -= mdy * k * (this.settings.invertY ? -1 : 1);
    body.pitch = clamp(body.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);

    const inv = this.player.inventory;
    for (let i = 0; i < 9; i++) {
      if (input.consumePress(`Digit${i + 1}`)) {
        inv.selected = i;
        inv.version++;
      }
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      inv.selected = (((inv.selected + wheel) % 9) + 9) % 9;
      inv.version++;
    }
    if (input.consumePress('F3')) this.hud.showDebug = !this.hud.showDebug;
    if (input.consumePress('KeyE')) this.openInventory();
    if (input.consumePress('Escape') && !input.usePointerLock) this.pause();
  }

  private tick(): void {
    this.ticks++;
    const input = this.input;
    const p = this.player;
    const body = p.body;

    // Movement input.
    const fwdDown = input.isDown('KeyW') || input.isDown('ArrowUp');
    if (fwdDown && !this.forwardWasDown) {
      if (this.ticks - this.lastForwardTap <= 7) this.sprintLatched = true;
      this.lastForwardTap = this.ticks;
    }
    this.forwardWasDown = fwdDown;
    const forward = (fwdDown ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
    const strafe =
      (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) -
      (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0);
    if (forward <= 0 || body.collidedHorizontally) this.sprintLatched = false;
    const jumpDown = input.isDown('Space');
    if (jumpDown && !this.jumpWasDown && p.canFly) {
      if (this.ticks - this.lastJumpTap <= 7) {
        body.flying = !body.flying;
        body.vy = 0;
        this.lastJumpTap = -100;
      } else {
        this.lastJumpTap = this.ticks;
      }
    }
    this.jumpWasDown = jumpDown;
    const move: MoveInput = {
      forward,
      strafe,
      jump: jumpDown,
      sneak: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
      sprint: input.isDown('ControlLeft') || this.sprintLatched,
    };

    const chunkHere = this.world.isLoaded(Math.floor(body.x), Math.floor(body.z));
    if (this.physicsReady && chunkHere) p.tick(this.world, move);
    else p.tick(this.world, { ...NO_INPUT });

    // Walk-cycle for view bobbing and footsteps.
    const speed = Math.hypot(body.x - body.prevX, body.z - body.prevZ);
    if (body.onGround && !body.flying && !move.sneak) {
      this.stepDistance += speed;
      if (this.stepDistance > 1.7) {
        this.stepDistance = 0;
        const under =
          BLOCKS[
            blockType(this.world.getBlock(Math.floor(body.x), Math.floor(body.y - 0.2), Math.floor(body.z)))
          ];
        if (under) this.audio.play(under.sound, 'step');
      }
    }
    this.bobPhase += speed * 2.6;
    this.bobAmount = lerp(this.bobAmount, body.onGround && !body.flying ? Math.min(1, speed * 5) : 0, 0.3);

    this.updateTarget(1);
    this.handleInteraction();
    this.world.tick();
    if (this.ticks % 600 === 0) void this.save();
  }

  private handleInteraction(): void {
    const input = this.input;
    const p = this.player;
    if (this.breakCooldown > 0) this.breakCooldown--;
    if (this.placeCooldown > 0) this.placeCooldown--;

    const leftClick = input.consumeClick(0);
    if ((leftClick || (input.mouseButton(0) && this.breakCooldown === 0)) && this.target) {
      if (breakBlock(this.world, p, this.target) !== null) this.target = null;
      this.breakCooldown = 5;
    }
    const rightClick = input.consumeClick(2);
    if ((rightClick || (input.mouseButton(2) && this.placeCooldown === 0)) && this.target) {
      if (placeBlock(this.world, p, this.target)) this.hud.flashItemName();
      this.placeCooldown = 4;
    }
    if (input.consumeClick(1) && this.target) pickBlock(p, this.target.value);
  }

  private eye(alpha: number): [number, number, number] {
    const b = this.player.body;
    return [
      lerp(b.prevX, b.x, alpha),
      lerp(b.prevY, b.y, alpha) + this.player.eyeHeight,
      lerp(b.prevZ, b.z, alpha),
    ];
  }

  private lookDir(): [number, number, number] {
    const b = this.player.body;
    const cp = Math.cos(b.pitch);
    return [-Math.sin(b.yaw) * cp, Math.sin(b.pitch), -Math.cos(b.yaw) * cp];
  }

  private updateTarget(alpha: number): void {
    const [ex, ey, ez] = this.eye(alpha);
    const [dx, dy, dz] = this.lookDir();
    this.target = raycast(this.world, ex, ey, ez, dx, dy, dz, this.player.reach);
  }

  private render(alpha: number, dt: number): void {
    const body = this.player.body;
    const [ex, ey, ez] = this.eye(alpha);
    if (this.state === 'playing') this.updateTarget(alpha);

    if (this.target) {
      const t = this.target;
      const boxes = selectionBoxes(t.value);
      if (boxes.length) {
        const b = boxes[0];
        this.renderer.setSelection({
          minX: t.x + b[0],
          minY: t.y + b[1],
          minZ: t.z + b[2],
          maxX: t.x + b[3],
          maxY: t.y + b[4],
          maxZ: t.z + b[5],
        });
      } else this.renderer.setSelection(null);
    } else this.renderer.setSelection(null);

    let fovTarget = this.settings.fov;
    if (this.player.sprinting) fovTarget *= body.flying ? 1.15 : 1.1;
    this.fovCurrent = lerp(this.fovCurrent, fovTarget, Math.min(1, dt * 10));

    let bobY = 0;
    let bobX = 0;
    if (this.settings.viewBobbing && this.bobAmount > 0.01) {
      bobY = Math.abs(Math.sin(this.bobPhase * Math.PI)) * 0.06 * this.bobAmount;
      bobX = Math.sin(this.bobPhase * Math.PI) * 0.03 * this.bobAmount;
    }
    const underwater =
      blockType(this.world.getBlock(Math.floor(ex), Math.floor(ey), Math.floor(ez))) === WATER;
    this.renderer.render(
      {
        x: ex + Math.cos(body.yaw) * bobX,
        y: ey + bobY,
        z: ez - Math.sin(body.yaw) * bobX,
        yaw: body.yaw,
        pitch: body.pitch,
        fov: this.fovCurrent,
      },
      this.world.dayTime,
      underwater,
    );
    this.hud.update(this.player.inventory, dt, underwater);
    this.debugTimer -= dt;
    if (this.hud.showDebug && this.debugTimer <= 0) {
      this.debugTimer = 0.25;
      this.hud.setDebug(this.debugLines());
    } else if (!this.hud.showDebug) this.hud.setDebug(null);
  }

  debugLines(): string[] {
    const b = this.player.body;
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bz = Math.floor(b.z);
    const r = this.renderer;
    const t = this.target;
    return [
      `${GAME_TITLE} ${GAME_VERSION}  ${this.fps} fps`,
      `XYZ: ${b.x.toFixed(3)} / ${b.y.toFixed(3)} / ${b.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}   Chunk: ${bx >> 4} ${bz >> 4} [${bx & 15} ${bz & 15}]`,
      `Facing: ${FACE_NAMES[faceFromYaw(b.yaw)]} (${((b.yaw * 180) / Math.PI).toFixed(1)} / ${((b.pitch * 180) / Math.PI).toFixed(1)})`,
      `Biome: ${biomeInfo(this.world.getBiome(bx, bz)).name}`,
      `Light: sky ${this.world.getSkyLight(bx, by, bz)}, block ${this.world.getBlockLight(bx, by, bz)}`,
      `Mode: ${this.player.gameMode}${b.flying ? ' (flying)' : ''}   Ground: ${b.onGround}`,
      `Chunks: ${this.world.chunks.size} loaded, ${r.chunks.meshedCount} meshed, ${this.loader.pendingCount + r.chunks.pending} pending`,
      `Draw calls: ${r.drawCalls}  Quads: ${(r.chunks.quadCount / 1000).toFixed(1)}k`,
      `Time: ${this.world.dayTime}  Seed: ${this.opts.meta.seedText || this.world.seed}`,
      t
        ? `Target: ${BLOCKS[blockType(t.value)]?.name ?? '?'} @ ${t.x} ${t.y} ${t.z} (${FACE_NAMES[t.face]})`
        : 'Target: none',
    ];
  }

  // --- Persistence ----------------------------------------------------------------------------

  async save(): Promise<void> {
    const storage = this.opts.storage;
    if (!storage || this.state === 'loading') return;
    const meta = this.opts.meta;
    meta.player = this.player.save();
    meta.time = this.world.time;
    meta.dayTime = this.world.dayTime;
    meta.lastPlayed = Date.now();
    await storage.saveWorld(meta);
    await this.loader.saveAll();
  }

  async quit(): Promise<void> {
    try {
      await this.save();
    } finally {
      this.dispose();
    }
  }

  dispose(): void {
    this.state = 'closed';
    cancelAnimationFrame(this.raf);
    this.inventoryUi?.dispose();
    this.input.unlock();
    this.input.dispose();
    this.loader.dispose();
    this.renderer.dispose();
    this.audio.dispose();
    this.hud.root.remove();
    for (const l of this.listeners) l();
  }

  // --- Test hooks -----------------------------------------------------------------------------

  stats(): Record<string, number | string> {
    return {
      state: this.state,
      chunksLoaded: this.world.chunks.size,
      chunksMeshed: this.renderer.chunks.meshedCount,
      quads: this.renderer.chunks.quadCount,
      drawCalls: this.renderer.drawCalls,
      fps: this.fps,
      ticks: this.ticks,
      uptime: Math.round(performance.now() - this.startedAt),
    };
  }

  /** Looks straight down and places the held block on the ground under the player. */
  simulatePlaceBelow(): { x: number; y: number; z: number; value: number } | null {
    const b = this.player.body;
    const x = Math.floor(b.x) + 2;
    const z = Math.floor(b.z);
    const h = this.world.getHeight(x, z);
    if (h < 0) return null;
    const held = this.player.inventory.held;
    const ok = this.world.setBlock(x, h + 1, z, (held?.def?.block ?? STONE) << 4);
    return ok ? { x, y: h + 1, z, value: this.world.getBlock(x, h + 1, z) } : null;
  }

  blockAt(x: number, y: number, z: number): number {
    return this.world.getBlock(x, y, z);
  }
}
