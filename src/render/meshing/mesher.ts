import { GRASS_BLOCK, blockMeta } from '../../engine/blocks';
import { biomeInfo } from '../../engine/worldgen/biomes';
import { Layer, Shape, TintKind, blockTable } from './blockTable';

/**
 * Chunk-column mesher. Pure function of a padded copy of the column (1-block border on every
 * side) so it can run in a worker without access to the world.
 *
 * Vertex format: 3 x uint32 per vertex, 4 vertices per quad (indexed by a shared quad index
 * buffer as (0,1,2)(0,2,3)).
 *   w0: x(9) | z(9) << 9 | y(13) << 18          positions in 1/16 block, chunk-relative
 *   w1: layer(11) | u(5) << 11 | v(5) << 16 | face(3) << 21 | frames-1(4) << 24 | wave(2) << 28
 *   w2: tint565(16) | sky(6) << 16 | block(6) << 22 | ao(2) << 28      light scaled 0..60
 */

export const PAD = 18;
const SX = 1;
const SZ = PAD;
const SY = PAD * PAD;

export interface MeshInput {
  /** World y of the first real layer; the padded volume starts at minY - 1. */
  minY: number;
  /** Number of real layers. */
  height: number;
  blocks: Uint16Array;
  light: Uint8Array;
  /** Padded 18 x 18 biome ids, index z * 18 + x. */
  biomes: Uint8Array;
}

export interface MeshOutput {
  opaque: Uint32Array;
  cutout: Uint32Array;
  translucent: Uint32Array;
}

export const FACE_NO_SHADE = 6;

class QuadBuffer {
  data = new Uint32Array(12 * 1024);
  len = 0;

  vertex(w0: number, w1: number, w2: number): void {
    if (this.len + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.len++] = w0;
    this.data[this.len++] = w1;
    this.data[this.len++] = w2;
  }

  finish(): Uint32Array {
    return this.data.slice(0, this.len);
  }
}

// Per face: 4 corners (x, y, z in {0, 1}) in counter-clockwise order seen from outside, plus
// texture coordinates (u, v in {0, 1}; v = 1 at the bottom of the tile).
const CORNERS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
  ], // east +X
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ], // west -X
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ], // up +Y
  [
    [1, 0, 1],
    [0, 0, 1],
    [0, 0, 0],
    [1, 0, 0],
  ], // down -Y
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ], // south +Z
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ], // north -Z
];
const UVS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
];
const NEIGHBOUR = [SX, -SX, SY, -SY, SZ, -SZ];
const NORMAL_AXIS = [0, 0, 1, 1, 2, 2];
const AXIS_STRIDE = [SX, SY, SZ];

// For each face and corner: index offsets (relative to the face-adjacent cell) of the two side
// cells and the diagonal corner cell used for ambient occlusion and smooth lighting.
const AO_SIDE1 = new Int32Array(24);
const AO_SIDE2 = new Int32Array(24);
for (let f = 0; f < 6; f++) {
  const n = NORMAL_AXIS[f];
  const [a, b] = [0, 1, 2].filter((ax) => ax !== n);
  for (let k = 0; k < 4; k++) {
    const c = CORNERS[f][k];
    AO_SIDE1[f * 4 + k] = (c[a] ? 1 : -1) * AXIS_STRIDE[a];
    AO_SIDE2[f * 4 + k] = (c[b] ? 1 : -1) * AXIS_STRIDE[b];
  }
}

const to565 = (rgb: number): number =>
  (((rgb >> 19) & 31) << 11) | (((rgb >> 10) & 63) << 5) | ((rgb >> 3) & 31);
const WHITE565 = 0xffff;

export function meshColumn(input: MeshInput): MeshOutput {
  const T = blockTable();
  const { blocks, light, minY, height } = input;
  const bufs = [null, new QuadBuffer(), new QuadBuffer(), new QuadBuffer()] as const;

  // Biome tints averaged at each of the 17 x 17 column corners for smooth transitions.
  const grassC = new Uint16Array(17 * 17);
  const foliageC = new Uint16Array(17 * 17);
  const waterC = new Uint16Array(17 * 17);
  for (let cz = 0; cz <= 16; cz++)
    for (let cx = 0; cx <= 16; cx++) {
      let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0; // prettier-ignore
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++) {
          const b = biomeInfo(input.biomes[(cz + dz) * PAD + cx + dx]);
          gr += b.grass >> 16;
          gg += (b.grass >> 8) & 255;
          gb += b.grass & 255; // prettier-ignore
          fr += b.foliage >> 16;
          fg += (b.foliage >> 8) & 255;
          fb += b.foliage & 255; // prettier-ignore
          wr += b.water >> 16;
          wg += (b.water >> 8) & 255;
          wb += b.water & 255; // prettier-ignore
        }
      const i = cz * 17 + cx;
      grassC[i] = to565(((gr >> 2) << 16) | ((gg >> 2) << 8) | (gb >> 2));
      foliageC[i] = to565(((fr >> 2) << 16) | ((fg >> 2) << 8) | (fb >> 2));
      waterC[i] = to565(((wr >> 2) << 16) | ((wg >> 2) << 8) | (wb >> 2));
    }

  const tintAt = (kind: number, type: number, cx: number, cz: number): number => {
    switch (kind) {
      case TintKind.Grass:
        return grassC[cz * 17 + cx];
      case TintKind.Foliage:
        return foliageC[cz * 17 + cx];
      case TintKind.Water:
        return waterC[cz * 17 + cx];
      default:
        return T.fixedTint[type] === 0xffffff ? WHITE565 : to565(T.fixedTint[type]);
    }
  };

  const opaqueAt = (i: number): number => T.opaque[blocks[i] >> 4];

  // Scratch per-quad arrays.
  const qx = [0, 0, 0, 0];
  const qy = [0, 0, 0, 0];
  const qz = [0, 0, 0, 0];
  const qu = [0, 0, 0, 0];
  const qv = [0, 0, 0, 0];
  const qao = [3, 3, 3, 3];
  const qsky = [0, 0, 0, 0];
  const qblk = [0, 0, 0, 0];
  const qtint = [0, 0, 0, 0];
  const qwave = [0, 0, 0, 0];

  /** Writes the quad in scratch arrays; flips the diagonal to hide AO anisotropy. */
  const emit = (buf: QuadBuffer, layerIdx: number, frames: number, face: number, flipBack: boolean): void => {
    const flip = qao[0] + qao[2] < qao[1] + qao[3];
    const order = flipBack ? (flip ? [3, 2, 1, 0] : [0, 3, 2, 1]) : flip ? [1, 2, 3, 0] : [0, 1, 2, 3];
    const w1base = (layerIdx & 2047) | ((face & 7) << 21) | (((frames - 1) & 15) << 24);
    for (const k of order) {
      const w0 = (qx[k] & 511) | ((qz[k] & 511) << 9) | ((qy[k] & 8191) << 18);
      const w1 = w1base | ((qu[k] & 31) << 11) | ((qv[k] & 31) << 16) | ((qwave[k] & 3) << 28);
      const w2 = (qtint[k] & 0xffff) | ((qsky[k] & 63) << 16) | ((qblk[k] & 63) << 22) | ((qao[k] & 3) << 28);
      buf.vertex(w0 >>> 0, w1 >>> 0, w2 >>> 0);
    }
  };

  /** Flat light of a padded cell, scaled to 0..60. */
  const setFlatLight = (i: number): void => {
    const l = light[i];
    const s = (l >> 4) * 4;
    const b = (l & 15) * 4;
    for (let k = 0; k < 4; k++) {
      qsky[k] = s;
      qblk[k] = b;
      qao[k] = 3;
    }
  };

  /**
   * Emits one face of an axis-aligned box given in 1/16 units relative to the block origin,
   * with an explicit UV rectangle (u0, v0)-(u1, v1) in tile pixels.
   */
  const boxFace = (
    buf: QuadBuffer,
    bx: number,
    by: number,
    bz: number,
    f: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    layerIdx: number,
    frames: number,
    tint: number,
    lightIdx: number,
    both: boolean,
  ): void => {
    setFlatLight(lightIdx);
    for (let k = 0; k < 4; k++) {
      const c = CORNERS[f][k];
      qx[k] = bx * 16 + (c[0] ? x1 : x0);
      qy[k] = by * 16 + (c[1] ? y1 : y0);
      qz[k] = bz * 16 + (c[2] ? z1 : z0);
      const uv = UVS[f][k];
      qu[k] = uv[0] ? u1 : u0;
      qv[k] = uv[1] ? v1 : v0;
      qtint[k] = tint;
      qwave[k] = 0;
    }
    emit(buf, layerIdx, frames, f, false);
    if (both) emit(buf, layerIdx, frames, f, true);
  };

  for (let ly = 0; ly < height; ly++) {
    const wy = minY + ly;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const idx = ((ly + 1) * PAD + z + 1) * PAD + x + 1;
        const v = blocks[idx];
        if (v === 0) continue;
        const t = v >> 4;
        const shape = T.shape[t];
        if (shape === Shape.None) continue;
        const layer = T.layer[t];
        const buf = bufs[layer === Layer.None ? Layer.Opaque : layer]!;
        const kind = T.tintKind[t];

        if (shape === Shape.Cube) {
          const self = T.selfCull[t];
          for (let f = 0; f < 6; f++) {
            const ni = idx + NEIGHBOUR[f];
            const nt = blocks[ni] >> 4;
            if (T.opaque[nt]) continue;
            if (nt === t && self) continue;
            const fi = v * 6 + f;
            const noTint = t === GRASS_BLOCK && f === 3;
            for (let k = 0; k < 4; k++) {
              const c = CORNERS[f][k];
              qx[k] = (x + c[0]) * 16;
              qy[k] = (wy + c[1]) * 16;
              qz[k] = (z + c[2]) * 16;
              qu[k] = UVS[f][k][0] * 16;
              qv[k] = UVS[f][k][1] * 16;
              const s1i = ni + AO_SIDE1[f * 4 + k];
              const s2i = ni + AO_SIDE2[f * 4 + k];
              const ci = s1i + AO_SIDE2[f * 4 + k];
              const s1 = opaqueAt(s1i);
              const s2 = opaqueAt(s2i);
              const cc = opaqueAt(ci);
              qao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
              let sky = light[ni] >> 4;
              let blk = light[ni] & 15;
              let n = 1;
              if (!s1) {
                sky += light[s1i] >> 4;
                blk += light[s1i] & 15;
                n++;
              }
              if (!s2) {
                sky += light[s2i] >> 4;
                blk += light[s2i] & 15;
                n++;
              }
              if (!cc && !(s1 && s2)) {
                sky += light[ci] >> 4;
                blk += light[ci] & 15;
                n++;
              }
              qsky[k] = Math.round((sky * 4) / n);
              qblk[k] = Math.round((blk * 4) / n);
              qtint[k] = noTint ? WHITE565 : tintAt(kind, t, x + c[0], z + c[2]);
              qwave[k] = T.waves[t] === 1 ? 1 : 0;
            }
            emit(buf, T.faceLayer[fi], T.faceFrames[fi], f, false);
          }
          continue;
        }

        if (shape === Shape.Fluid) {
          const above = blocks[idx + SY] >> 4;
          const top = above === t ? 16 : 14;
          for (let f = 0; f < 6; f++) {
            const ni = idx + NEIGHBOUR[f];
            const nt = blocks[ni] >> 4;
            if (nt === t) continue;
            if (f !== 2 && T.opaque[nt]) continue;
            const fi = v * 6 + f;
            setFlatLight(f === 2 && top === 16 ? idx : ni);
            if (f !== 2) {
              // Side/bottom faces take the brighter of this cell and the neighbour.
              const l0 = light[idx];
              const l1 = light[ni];
              const sky = Math.max(l0 >> 4, l1 >> 4) * 4;
              const blk = Math.max(l0 & 15, l1 & 15) * 4;
              for (let k = 0; k < 4; k++) {
                qsky[k] = sky;
                qblk[k] = blk;
              }
            }
            for (let k = 0; k < 4; k++) {
              const c = CORNERS[f][k];
              qx[k] = (x + c[0]) * 16;
              qy[k] = wy * 16 + (c[1] ? top : 0);
              qz[k] = (z + c[2]) * 16;
              qu[k] = UVS[f][k][0] * 16;
              qv[k] = f === 2 || f === 3 ? UVS[f][k][1] * 16 : c[1] ? 16 - top : 16;
              qtint[k] = tintAt(kind, t, x + c[0], z + c[2]);
              qwave[k] = f === 2 && top < 16 ? 3 : 0;
            }
            emit(buf, T.faceLayer[fi], T.faceFrames[fi], f, false);
            if (f === 2) emit(buf, T.faceLayer[fi], T.faceFrames[fi], f, true);
          }
          continue;
        }

        const fi0 = v * 6;
        const tex = T.faceLayer[fi0];
        const frames = T.faceFrames[fi0];

        if (shape === Shape.Cross) {
          setFlatLight(idx);
          const tint = tintAt(kind, t, x, z);
          const planes = [
            [2, 2, 14, 14],
            [2, 14, 14, 2],
          ];
          for (const [ax, az, bx, bz] of planes) {
            const px = [ax, bx, bx, ax];
            const pz = [az, bz, bz, az];
            const py = [0, 0, 16, 16];
            for (let k = 0; k < 4; k++) {
              qx[k] = x * 16 + px[k];
              qy[k] = wy * 16 + py[k];
              qz[k] = z * 16 + pz[k];
              qu[k] = k === 0 || k === 3 ? 0 : 16;
              qv[k] = k < 2 ? 16 : 0;
              qtint[k] = tint;
              qwave[k] = T.waves[t] === 2 && k >= 2 ? 2 : 0;
            }
            emit(buf, tex, frames, FACE_NO_SHADE, false);
            emit(buf, tex, frames, FACE_NO_SHADE, true);
          }
          continue;
        }

        if (shape === Shape.Crop) {
          setFlatLight(idx);
          const tint = tintAt(kind, t, x, z);
          for (const p of [4, 12]) {
            for (const alongX of [true, false]) {
              const px = alongX ? [0, 16, 16, 0] : [p, p, p, p];
              const pz = alongX ? [p, p, p, p] : [0, 16, 16, 0];
              const py = [0, 0, 16, 16];
              for (let k = 0; k < 4; k++) {
                qx[k] = x * 16 + px[k];
                qy[k] = wy * 16 + py[k] - 1;
                qz[k] = z * 16 + pz[k];
                qu[k] = k === 0 || k === 3 ? 0 : 16;
                qv[k] = k < 2 ? 16 : 0;
                qtint[k] = tint;
                qwave[k] = k >= 2 ? 2 : 0;
              }
              emit(buf, tex, frames, FACE_NO_SHADE, false);
              emit(buf, tex, frames, FACE_NO_SHADE, true);
            }
          }
          continue;
        }

        if (shape === Shape.Torch) {
          const meta = blockMeta(v);
          let bx0 = 7, bz0 = 7, by0 = 0; // prettier-ignore
          if (meta === 1) { bz0 = 12; by0 = 3; } // prettier-ignore
          else if (meta === 2) { bx0 = 2; by0 = 3; } // prettier-ignore
          else if (meta === 3) { bz0 = 2; by0 = 3; } // prettier-ignore
          else if (meta === 4) { bx0 = 12; by0 = 3; } // prettier-ignore
          for (let f = 0; f < 6; f++) {
            const [u0, v0, u1, v1] = f === 2 ? [7, 6, 9, 8] : f === 3 ? [7, 14, 9, 16] : [7, 6, 9, 16];
            boxFace(
              buf,
              x,
              wy,
              z,
              f,
              bx0,
              by0,
              bz0,
              bx0 + 2,
              by0 + 10,
              bz0 + 2,
              u0,
              v0,
              u1,
              v1,
              tex,
              frames,
              WHITE565,
              idx,
              false,
            );
          }
          continue;
        }

        if (shape === Shape.Layer) {
          const h = 2 * ((blockMeta(v) & 7) + 1);
          const tint = tintAt(kind, t, x, z);
          for (let f = 0; f < 6; f++) {
            const ni = idx + NEIGHBOUR[f];
            if (f !== 2 && opaqueAt(ni)) continue;
            if (f === 2 && h === 16 && opaqueAt(ni)) continue;
            const [u0, v0, u1, v1] = f === 2 || f === 3 ? [0, 0, 16, 16] : [0, 16 - h, 16, 16];
            boxFace(
              buf,
              x,
              wy,
              z,
              f,
              0,
              0,
              0,
              16,
              h,
              16,
              u0,
              v0,
              u1,
              v1,
              T.faceLayer[v * 6 + f],
              frames,
              tint,
              idx,
              false,
            );
          }
          continue;
        }

        if (shape === Shape.Cactus) {
          const tint = tintAt(kind, t, x, z);
          for (let f = 0; f < 6; f++) {
            const ni = idx + NEIGHBOUR[f];
            const nt = blocks[ni] >> 4;
            if ((f === 2 || f === 3) && (opaqueAt(ni) || nt === t)) continue;
            const inset = f === 2 || f === 3 ? [1, 1, 15, 15] : [0, 0, 16, 16];
            boxFace(
              buf,
              x,
              wy,
              z,
              f,
              1,
              0,
              1,
              15,
              16,
              15,
              inset[0],
              inset[1],
              inset[2],
              inset[3],
              T.faceLayer[v * 6 + f],
              frames,
              tint,
              idx,
              false,
            );
          }
          continue;
        }

        if (shape === Shape.Ladder) {
          const m = blockMeta(v) & 3;
          // Wall on S / W / N / E side; the ladder face sits 1/16 away from it.
          const f = m === 0 ? 5 : m === 1 ? 0 : m === 2 ? 4 : 1;
          const b =
            m === 0
              ? [0, 0, 15, 16, 16, 15]
              : m === 1
                ? [1, 0, 0, 1, 16, 16]
                : m === 2
                  ? [0, 0, 1, 16, 16, 1]
                  : [15, 0, 0, 15, 16, 16];
          boxFace(
            buf,
            x,
            wy,
            z,
            f,
            b[0],
            b[1],
            b[2],
            b[3],
            b[4],
            b[5],
            0,
            0,
            16,
            16,
            tex,
            frames,
            WHITE565,
            idx,
            true,
          );
          continue;
        }
      }
    }
  }

  return {
    opaque: bufs[Layer.Opaque].finish(),
    cutout: bufs[Layer.Cutout].finish(),
    translucent: bufs[Layer.Translucent].finish(),
  };
}
