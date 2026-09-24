import * as THREE from 'three';
import { STONE, makeBlock } from '../engine/blocks';
import { Chunk, chunkIndex, chunkKey } from '../engine/chunk';
import { WORLD_HEIGHT } from '../engine/constants';
import type { World } from '../engine/world';
import type { WorkerPool } from '../workers/pool';
import { createChunkMaterial, type ChunkPass, type ChunkUniforms } from './chunkMaterial';
import { PAD, type MeshInput, type MeshOutput } from './meshing/mesher';

const PASSES: readonly ChunkPass[] = ['opaque', 'cutout', 'translucent'];
const BELOW_WORLD = makeBlock(STONE);

interface ColumnMeshes {
  chunk: Chunk;
  meshes: (THREE.Mesh | null)[];
  /** Incremented on every change; results for older versions are discarded. */
  version: number;
  meshedVersion: number;
  inFlight: boolean;
}

interface PendingResult {
  key: number;
  version: number;
  minY: number;
  height: number;
  out: MeshOutput;
}

/**
 * Owns the Three.js meshes for chunk columns: schedules re-meshing in workers, uploads results
 * within a per-frame budget and disposes meshes of unloaded chunks.
 */
export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[];
  private readonly columns = new Map<number, ColumnMeshes>();
  private readonly queue = new Set<number>();
  private readonly results: PendingResult[] = [];
  private index: THREE.BufferAttribute | null = null;
  private indexQuads = 0;
  private disposed = false;

  /** Stats for the debug overlay. */
  meshedCount = 0;
  quadCount = 0;

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool,
    uniforms: ChunkUniforms,
  ) {
    this.materials = PASSES.map((p) => createChunkMaterial(p, uniforms));
    this.group.name = 'chunks';
    this.group.matrixAutoUpdate = false;
    world.events.on('chunkRemoved', (c) => this.removeColumn(c));
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Called every frame. Collects dirty chunks, dispatches meshing jobs and applies results. */
  update(camX: number, camZ: number, uploadBudgetMs = 4): void {
    for (const c of this.world.dirty) {
      let col = this.columns.get(c.key);
      if (!col) {
        col = { chunk: c, meshes: [null, null, null], version: 0, meshedVersion: -1, inFlight: false };
        this.columns.set(c.key, col);
      }
      col.chunk = c;
      col.version++;
      this.queue.add(c.key);
    }
    this.world.dirty.clear();
    this.dispatch(camX, camZ);
    this.applyResults(uploadBudgetMs);
  }

  private hasAllNeighbours(c: Chunk): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if (!this.world.getChunk(c.cx + dx, c.cz + dz)) return false;
    return true;
  }

  private dispatch(camX: number, camZ: number): void {
    const maxInFlight = this.pool.size * 2;
    if (this.pool.inFlight >= maxInFlight || this.queue.size === 0) return;
    const ccx = Math.floor(camX / 16);
    const ccz = Math.floor(camZ / 16);
    const ready: ColumnMeshes[] = [];
    for (const key of this.queue) {
      const col = this.columns.get(key);
      if (!col || !this.world.chunks.has(key)) {
        this.queue.delete(key);
        continue;
      }
      if (col.inFlight || !this.hasAllNeighbours(col.chunk)) continue;
      ready.push(col);
    }
    ready.sort((a, b) => {
      const da = (a.chunk.cx - ccx) ** 2 + (a.chunk.cz - ccz) ** 2;
      const db = (b.chunk.cx - ccx) ** 2 + (b.chunk.cz - ccz) ** 2;
      return da - db;
    });
    for (const col of ready) {
      if (this.pool.inFlight >= maxInFlight) break;
      this.queue.delete(col.chunk.key);
      const input = buildMeshInput(this.world, col.chunk);
      const version = col.version;
      const key = col.chunk.key;
      if (!input) {
        this.results.push({ key, version, minY: 0, height: 0, out: EMPTY_OUTPUT });
        continue;
      }
      col.inFlight = true;
      this.pool
        .mesh(input)
        .then((out) => {
          col.inFlight = false;
          if (!this.disposed)
            this.results.push({ key, version, minY: input.minY, height: input.height, out });
        })
        .catch((e) => {
          col.inFlight = false;
          if (!this.disposed) console.error('Meshing failed', e);
        });
    }
  }

  private applyResults(budgetMs: number): void {
    const start = performance.now();
    while (this.results.length > 0 && performance.now() - start < budgetMs) {
      const r = this.results.shift()!;
      const col = this.columns.get(r.key);
      if (!col || !this.world.chunks.has(r.key)) continue;
      if (r.version < col.meshedVersion) continue;
      col.meshedVersion = r.version;
      if (col.meshes.every((m) => m === null)) this.meshedCount++;
      const outs = [r.out.opaque, r.out.cutout, r.out.translucent];
      for (let p = 0; p < 3; p++) this.setMesh(col, p, outs[p], r.minY, r.height);
      if (r.version < col.version && !col.inFlight) this.queue.add(r.key);
    }
  }

  private quadIndex(quads: number): THREE.BufferAttribute {
    if (!this.index || quads > this.indexQuads) {
      let n = Math.max(16384, this.indexQuads);
      while (n < quads) n *= 2;
      const idx = new Uint32Array(n * 6);
      for (let q = 0; q < n; q++) {
        const v = q * 4;
        idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
      }
      // Existing geometries keep the old attribute; new ones share the larger buffer.
      this.index = new THREE.BufferAttribute(idx, 1);
      this.indexQuads = n;
    }
    return this.index;
  }

  private setMesh(col: ColumnMeshes, pass: number, data: Uint32Array, minY: number, height: number): void {
    const old = col.meshes[pass];
    if (old) {
      this.quadCount -= (old.geometry.getAttribute('aData').count / 4) | 0;
      disposeGeometry(old.geometry);
      this.group.remove(old);
      col.meshes[pass] = null;
    }
    const quads = data.length / 12;
    if (quads === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aData', new THREE.BufferAttribute(data, 3));
    geo.setIndex(this.quadIndex(quads));
    geo.setDrawRange(0, quads * 6);
    const cy = minY + height / 2;
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(0, minY - 1, 0),
      new THREE.Vector3(16, minY + height + 1, 16),
    );
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(8, cy, 8),
      Math.sqrt(128 + (height / 2 + 1) ** 2),
    );
    const mesh = new THREE.Mesh(geo, this.materials[pass]);
    mesh.position.set(col.chunk.cx * 16, 0, col.chunk.cz * 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.renderOrder = pass;
    this.group.add(mesh);
    col.meshes[pass] = mesh;
    this.quadCount += quads;
  }

  private removeColumn(c: Chunk): void {
    const col = this.columns.get(c.key);
    if (!col) return;
    for (let p = 0; p < 3; p++) {
      const m = col.meshes[p];
      if (m) {
        this.quadCount -= (m.geometry.getAttribute('aData').count / 4) | 0;
        disposeGeometry(m.geometry);
        this.group.remove(m);
      }
    }
    if (col.meshes.some((m) => m)) this.meshedCount--;
    this.columns.delete(c.key);
    this.queue.delete(c.key);
  }

  isMeshed(cx: number, cz: number): boolean {
    const col = this.columns.get(chunkKey(cx, cz));
    return !!col && col.meshedVersion >= 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const col of this.columns.values()) for (const m of col.meshes) if (m) disposeGeometry(m.geometry);
    this.columns.clear();
    for (const m of this.materials) m.dispose();
  }
}

const EMPTY_OUTPUT: MeshOutput = {
  opaque: new Uint32Array(0),
  cutout: new Uint32Array(0),
  translucent: new Uint32Array(0),
};

/** The shared index buffer must not be deleted with a single geometry. */
function disposeGeometry(g: THREE.BufferGeometry): void {
  g.setIndex(null);
  g.dispose();
}

/**
 * Copies a chunk column plus a 1-block border from its neighbours into flat arrays for the
 * mesher. Returns null if the column is empty.
 */
export function buildMeshInput(world: World, chunk: Chunk): MeshInput | null {
  const hi = chunk.highestNonAirY();
  if (hi < 0) return null;
  const lo = chunk.lowestNonAirY();
  const minY = lo;
  const height = hi - lo + 1;
  const layers = height + 2;
  const blocks = new Uint16Array(PAD * PAD * layers);
  const light = new Uint8Array(PAD * PAD * layers);
  const biomes = new Uint8Array(PAD * PAD);

  const neighbours: (Chunk | undefined)[] = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) neighbours.push(world.getChunk(chunk.cx + dx, chunk.cz + dz));
  const chunkFor = (px: number, pz: number): Chunk | undefined => {
    const dx = px === 0 ? 0 : px === 17 ? 2 : 1;
    const dz = pz === 0 ? 0 : pz === 17 ? 2 : 1;
    return neighbours[dz * 3 + dx];
  };

  for (let pz = 0; pz < PAD; pz++)
    for (let px = 0; px < PAD; px++) {
      const c = chunkFor(px, pz);
      biomes[pz * PAD + px] = c ? c.biomes[(((pz - 1) & 15) << 4) | ((px - 1) & 15)] : chunk.biomes[0];
    }

  for (let py = 0; py < layers; py++) {
    const wy = minY - 1 + py;
    const base = py * PAD * PAD;
    if (wy < 0) {
      blocks.fill(BELOW_WORLD, base, base + PAD * PAD);
      continue;
    }
    if (wy >= WORLD_HEIGHT) {
      light.fill(0xf0, base, base + PAD * PAD);
      continue;
    }
    for (let pz = 0; pz < PAD; pz++) {
      const lz = (pz - 1) & 15;
      const row = base + pz * PAD;
      // The middle 16 blocks of a row come from one chunk (this one or a z-neighbour).
      const mid = chunkFor(1, pz);
      if (mid) {
        const src = chunkIndex(0, wy, lz);
        blocks.set(mid.blocks.subarray(src, src + 16), row + 1);
        light.set(mid.light.subarray(src, src + 16), row + 1);
      }
      const west = chunkFor(0, pz);
      if (west) {
        const i = chunkIndex(15, wy, lz);
        blocks[row] = west.blocks[i];
        light[row] = west.light[i];
      }
      const east = chunkFor(17, pz);
      if (east) {
        const i = chunkIndex(0, wy, lz);
        blocks[row + 17] = east.blocks[i];
        light[row + 17] = east.light[i];
      }
    }
  }
  return { minY, height, blocks, light, biomes };
}
