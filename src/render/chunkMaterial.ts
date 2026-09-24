import * as THREE from 'three';

const vertexShader = /* glsl */ `
precision highp sampler2DArray;
in uvec3 aData;

uniform float uTime;
uniform float uFrameTime;

out vec3 vUvl;
out float vSky;
out float vBlock;
out float vShade;
out vec3 vTint;
out float vFogDist;

const float SHADE[7] = float[7](0.6, 0.6, 1.0, 0.5, 0.8, 0.8, 0.9);
const float AO[4] = float[4](0.42, 0.62, 0.8, 1.0);

void main() {
  uint w0 = aData.x;
  uint w1 = aData.y;
  uint w2 = aData.z;
  vec3 pos = vec3(float(w0 & 511u), float(w0 >> 18u), float((w0 >> 9u) & 511u)) / 16.0;

  uint layer = w1 & 2047u;
  float u = float((w1 >> 11u) & 31u) / 16.0;
  float v = float((w1 >> 16u) & 31u) / 16.0;
  uint face = (w1 >> 21u) & 7u;
  uint frames = ((w1 >> 24u) & 15u) + 1u;
  uint wave = (w1 >> 28u) & 3u;

  uint tint = w2 & 65535u;
  vTint = vec3(float((tint >> 11u) & 31u) / 31.0, float((tint >> 5u) & 63u) / 63.0, float(tint & 31u) / 31.0);
  vSky = float((w2 >> 16u) & 63u) / 60.0;
  vBlock = float((w2 >> 22u) & 63u) / 60.0;
  vShade = SHADE[face] * AO[(w2 >> 28u) & 3u];

  vec4 world = modelMatrix * vec4(pos, 1.0);
  if (wave == 1u) {
    world.x += sin(uTime * 1.6 + world.x * 0.7 + world.y * 0.4) * 0.025;
    world.z += cos(uTime * 1.3 + world.z * 0.6 + world.y * 0.3) * 0.025;
  } else if (wave == 2u) {
    world.x += sin(uTime * 2.1 + world.x * 0.9 + world.z * 0.5) * 0.06;
    world.z += cos(uTime * 1.7 + world.z * 0.8 + world.x * 0.4) * 0.05;
  } else if (wave == 3u) {
    world.y += sin(uTime * 1.5 + world.x * 0.8 + world.z * 0.6) * 0.03 - 0.03;
  }

  float frame = frames > 1u ? mod(floor(uFrameTime), float(frames)) : 0.0;
  vUvl = vec3(u, v, float(layer) + frame);

  vec4 mv = viewMatrix * world;
  vFogDist = length(mv.xz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform vec3 uSkyLightColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uGamma;
uniform float uUnderwater;

in vec3 vUvl;
in float vSky;
in float vBlock;
in float vShade;
in vec3 vTint;
in float vFogDist;

layout(location = 0) out highp vec4 fragColor;

float curve(float l) {
  // Perceptual light falloff: dark levels fall off quickly, bright levels are flat.
  float b = l / (4.0 - 3.0 * l);
  return mix(b, sqrt(b), uGamma);
}

void main() {
  vec4 tex = texture(uAtlas, vUvl);
#ifdef CUTOUT
  if (textureLod(uAtlas, vUvl, 0.0).a < 0.5) discard;
  vec3 albedo = tex.rgb * vTint;
  float alpha = 1.0;
#elif defined(TRANSLUCENT)
  vec3 albedo = tex.rgb * vTint;
  float alpha = tex.a;
#else
  // Opaque tiles use alpha as a tint mask (e.g. only the grass fringe on grass block sides).
  vec3 albedo = mix(tex.rgb, tex.rgb * vTint, tex.a);
  float alpha = 1.0;
#endif
  float sky = curve(vSky) * uDaylight;
  float blk = curve(vBlock);
  vec3 light = max(uSkyLightColor * sky, vec3(1.0, 0.86, 0.66) * blk);
  light = max(light, vec3(0.035));
  vec3 color = albedo * light * vShade;

  float fog = smoothstep(uFogNear, uFogFar, vFogDist);
  if (uUnderwater > 0.5) fog = smoothstep(0.0, 24.0, vFogDist);
  color = mix(color, uFogColor, fog);
  fragColor = vec4(color, alpha);
}
`;

export type ChunkPass = 'opaque' | 'cutout' | 'translucent';

export interface ChunkUniforms {
  [uniform: string]: THREE.IUniform;
  uAtlas: THREE.IUniform<THREE.Texture | null>;
  uTime: THREE.IUniform<number>;
  uFrameTime: THREE.IUniform<number>;
  uDaylight: THREE.IUniform<number>;
  uSkyLightColor: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogNear: THREE.IUniform<number>;
  uFogFar: THREE.IUniform<number>;
  uGamma: THREE.IUniform<number>;
  uUnderwater: THREE.IUniform<number>;
}

export function createChunkUniforms(atlas: THREE.Texture): ChunkUniforms {
  return {
    uAtlas: { value: atlas },
    uTime: { value: 0 },
    uFrameTime: { value: 0 },
    uDaylight: { value: 1 },
    uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color(0.7, 0.8, 1) },
    uFogNear: { value: 80 },
    uFogFar: { value: 120 },
    uGamma: { value: 0.35 },
    uUnderwater: { value: 0 },
  };
}

/** One material per render pass; all share the same uniform objects. */
export function createChunkMaterial(pass: ChunkPass, uniforms: ChunkUniforms): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    defines: pass === 'cutout' ? { CUTOUT: 1 } : pass === 'translucent' ? { TRANSLUCENT: 1 } : {},
    transparent: pass === 'translucent',
    depthWrite: pass !== 'translucent',
    side: THREE.FrontSide,
  });
  return m;
}
