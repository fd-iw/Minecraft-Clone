import * as THREE from 'three';
import { DAY_LENGTH_TICKS } from '../engine/constants';
import { Rng } from '../shared/rng';
import { clamp, smoothstep } from '../shared/math';

const DAY_ZENITH = new THREE.Color(0x6f9ff5);
const DAY_HORIZON = new THREE.Color(0xb9d3fb);
const NIGHT_ZENITH = new THREE.Color(0x020308);
const NIGHT_HORIZON = new THREE.Color(0x0b1020);
const SUNSET = new THREE.Color(0xf08a4a);

export interface SkyState {
  /** 0..1 multiplier for sky light on terrain. */
  daylight: number;
  fogColor: THREE.Color;
  skyLightColor: THREE.Color;
  /** Radians; 0 = sunrise in the east. */
  celestialAngle: number;
}

/**
 * Gradient sky dome with a sun, moon and stars that follow the camera. The sun and moon are
 * original square designs drawn procedurally.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunset: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunsetAmount: { value: 0 },
  };
  private readonly celestial = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  readonly state: SkyState = {
    daylight: 1,
    fogColor: new THREE.Color(),
    skyLightColor: new THREE.Color(1, 1, 1),
    celestialAngle: 0,
  };

  constructor() {
    this.group.name = 'sky';
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uSunset;
          uniform vec3 uSunDir;
          uniform float uSunsetAmount;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -1.0, 1.0);
            vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
            if (h < 0.0) c = mix(uHorizon, uHorizon * 0.6, smoothstep(0.0, -0.3, h));
            float toward = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
            float band = (1.0 - smoothstep(0.0, 0.45, abs(h - 0.05))) * toward * toward;
            c = mix(c, uSunset, band * uSunsetAmount);
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const sun = (this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({
        map: this.makeSunTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    ));
    const moon = (this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({
        map: this.makeMoonTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    ));
    this.celestial.add(sun, moon);

    const starGeo = new THREE.BufferGeometry();
    const rng = new Rng(1337);
    const pos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = rng.next() * 2 - 1;
      const th = rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.push(r * Math.cos(th) * 450, u * 450, r * Math.sin(th) * 450);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMaterial);
    this.celestial.add(this.stars);
    for (const o of this.celestial.children) {
      o.renderOrder = -9;
      o.frustumCulled = false;
    }
    this.group.add(this.celestial);
  }

  private makeSunTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255, 220, 140, 0.25)';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(255, 236, 170, 0.6)';
    g.fillRect(4, 4, 24, 24);
    g.fillStyle = '#fff6d8';
    g.fillRect(9, 9, 14, 14);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  private makeMoonTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d')!;
    g.fillStyle = '#dfe4ee';
    g.fillRect(3, 3, 10, 10);
    g.fillStyle = '#b7bfcf';
    for (const [x, y, s] of [
      [5, 5, 2],
      [9, 8, 3],
      [6, 10, 1],
      [10, 4, 1],
    ])
      g.fillRect(x, y, s, s);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  /** Updates sky colours and celestial bodies for a time of day, centred on the camera. */
  update(dayTime: number, camera: THREE.Camera): SkyState {
    const angle = (dayTime / DAY_LENGTH_TICKS) * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    const day = smoothstep(-0.22, 0.25, sunHeight);
    const s = this.state;
    s.celestialAngle = angle;
    s.daylight = 0.18 + 0.82 * day;

    const zenith = NIGHT_ZENITH.clone().lerp(DAY_ZENITH, day);
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, day);
    const sunset = clamp(1 - Math.abs(sunHeight) * 3.2, 0, 1);
    this.domeUniforms.uZenith.value.copy(zenith);
    this.domeUniforms.uHorizon.value.copy(horizon);
    this.domeUniforms.uSunset.value.copy(SUNSET);
    this.domeUniforms.uSunsetAmount.value = sunset * 0.85;
    // Sun rises in the east (+X) and sets in the west.
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.15).normalize();
    this.domeUniforms.uSunDir.value.copy(sunDir);

    s.fogColor.copy(horizon);
    s.skyLightColor.setRGB(1, 1, 1).lerp(new THREE.Color(0.55, 0.6, 0.85), 1 - day);

    this.group.position.copy(camera.position);
    this.sun.position.copy(sunDir).multiplyScalar(400);
    this.sun.lookAt(0, 0, 0);
    this.moon.position.copy(sunDir).multiplyScalar(-400);
    this.moon.lookAt(0, 0, 0);
    this.stars.rotation.set(0.15, 0, angle);
    this.starMaterial.opacity = clamp(1 - day * 1.6, 0, 1);
    return s;
  }
}
