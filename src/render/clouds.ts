import * as THREE from 'three';
import { SimplexNoise } from '../shared/noise';

const CELLS = 256;
const CELL_SIZE = 12;
export const CLOUD_HEIGHT = 192;

/**
 * Flat blocky cloud layer. A 256 x 256 cell map (each cell 12 x 12 blocks) is generated from
 * noise and sampled in a fragment shader on one large plane that follows the camera.
 */
export class Clouds {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uMap: { value: null as THREE.DataTexture | null },
    uOffset: { value: new THREE.Vector2() },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uCamera: { value: new THREE.Vector3() },
    uFadeFar: { value: 200 },
  };

  constructor() {
    const noise = new SimplexNoise(0xc10d);
    const data = new Uint8Array(CELLS * CELLS);
    for (let y = 0; y < CELLS; y++)
      for (let x = 0; x < CELLS; x++) {
        // Tileable by sampling a torus in 4D-ish via two offset 3D lookups.
        const a = (x / CELLS) * Math.PI * 2;
        const b = (y / CELLS) * Math.PI * 2;
        const n =
          noise.noise3(Math.cos(a) * 6, Math.sin(a) * 6, Math.cos(b) * 6 + Math.sin(b) * 3) * 0.7 +
          noise.noise3(Math.cos(a) * 14 + 40, Math.sin(b) * 14, Math.sin(a) * 7) * 0.3;
        data[y * CELLS + x] = n > 0.18 ? 255 : 0;
      }
    const tex = new THREE.DataTexture(data, CELLS, CELLS, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.uniforms.uMap.value = tex;

    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec2 uOffset;
          uniform vec3 uColor;
          uniform vec3 uCamera;
          uniform float uFadeFar;
          varying vec3 vWorld;
          void main() {
            vec2 cell = floor((vWorld.xz + uOffset) / ${CELL_SIZE.toFixed(1)});
            float c = texture2D(uMap, (cell + 0.5) / ${CELLS.toFixed(1)}).r;
            if (c < 0.5) discard;
            float d = length(vWorld.xz - uCamera.xz);
            float a = 0.8 * (1.0 - smoothstep(uFadeFar * 0.6, uFadeFar, d));
            if (a <= 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Camera, timeSeconds: number, daylight: number, renderDistance: number): void {
    const far = Math.max(160, renderDistance * 16 * 1.6);
    this.mesh.scale.set(far * 2.2, 1, far * 2.2);
    this.mesh.position.set(camera.position.x, CLOUD_HEIGHT, camera.position.z);
    this.uniforms.uCamera.value.copy(camera.position);
    this.uniforms.uFadeFar.value = far;
    this.uniforms.uOffset.value.set(timeSeconds * 0.6, 0);
    const l = 0.25 + 0.75 * daylight;
    this.uniforms.uColor.value.setRGB(l, l, l * 1.02);
  }
}
