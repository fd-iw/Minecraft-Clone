import * as THREE from 'three';
import type { World } from '../engine/world';
import type { WorkerPool } from '../workers/pool';
import { createChunkUniforms, type ChunkUniforms } from './chunkMaterial';
import { ChunkRenderer } from './chunkRenderer';
import { Clouds } from './clouds';
import { Sky } from './sky';
import { createBlockTextureArray } from './textures/atlas';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: ChunkUniforms;
  readonly chunks: ChunkRenderer;
  readonly sky: Sky;
  readonly clouds: Clouds;
  private readonly selection: THREE.LineSegments;
  private readonly atlas: THREE.DataArrayTexture;
  private renderDistance = 8;
  private startTime = performance.now();

  constructor(
    readonly canvas: HTMLCanvasElement,
    world: World,
    pool: WorkerPool,
  ) {
    // Lighting is computed in gamma space; skip colour management conversions entirely.
    THREE.ColorManagement.enabled = false;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    if (!this.gl.capabilities.isWebGL2) throw new Error('WebGL2 is required');
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.sortObjects = true;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';

    this.atlas = createBlockTextureArray();
    this.uniforms = createChunkUniforms(this.atlas);
    this.chunks = new ChunkRenderer(world, pool, this.uniforms);
    this.sky = new Sky();
    this.clouds = new Clouds();
    this.scene.add(this.sky.group, this.chunks.group, this.clouds.mesh);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.selection.visible = false;
    this.selection.renderOrder = 5;
    this.scene.add(this.selection);

    this.resize();
  }

  setRenderDistance(chunks: number): void {
    this.renderDistance = chunks;
  }

  setSelection(box: Box | null): void {
    if (!box) {
      this.selection.visible = false;
      return;
    }
    const e = 0.002;
    this.selection.visible = true;
    this.selection.position.set(
      (box.minX + box.maxX) / 2,
      (box.minY + box.maxY) / 2,
      (box.minZ + box.maxZ) / 2,
    );
    this.selection.scale.set(
      box.maxX - box.minX + e * 2,
      box.maxY - box.minY + e * 2,
      box.maxZ - box.minZ + e * 2,
    );
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(pose: CameraPose, dayTime: number, underwater: boolean): void {
    const cam = this.camera;
    cam.position.set(pose.x, pose.y, pose.z);
    cam.rotation.set(pose.pitch, pose.yaw, 0);
    if (cam.fov !== pose.fov) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    const sky = this.sky.update(dayTime, cam);
    const t = (performance.now() - this.startTime) / 1000;
    const u = this.uniforms;
    u.uTime.value = t;
    u.uFrameTime.value = t * 6;
    u.uDaylight.value = sky.daylight;
    u.uSkyLightColor.value.copy(sky.skyLightColor);
    const far = this.renderDistance * 16;
    u.uFogFar.value = far - 4;
    u.uFogNear.value = far * 0.72;
    u.uUnderwater.value = underwater ? 1 : 0;
    if (underwater) u.uFogColor.value.setRGB(0.1, 0.2, 0.5).multiplyScalar(0.3 + 0.7 * sky.daylight);
    else u.uFogColor.value.copy(sky.fogColor);
    this.gl.setClearColor(u.uFogColor.value);

    this.clouds.update(cam, t, sky.daylight, this.renderDistance);
    this.chunks.update(pose.x, pose.z);
    this.gl.render(this.scene, cam);
  }

  /** Test hook: number of distinct colours in a coarse sample of the current frame. */
  sampleFrame(): number {
    // The default framebuffer is cleared once presented, so render and read in the same task.
    this.gl.render(this.scene, this.camera);
    const ctx = this.gl.getContext();
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
    const seen = new Set<number>();
    for (let i = 0; i < px.length; i += 4 * 97) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    return seen.size;
  }

  get drawCalls(): number {
    return this.gl.info.render.calls;
  }

  get triangles(): number {
    return this.gl.info.render.triangles;
  }

  dispose(): void {
    this.chunks.dispose();
    this.atlas.dispose();
    this.gl.dispose();
  }
}
