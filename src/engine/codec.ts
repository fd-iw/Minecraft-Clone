import { deflateSync, inflateSync } from 'fflate';
import { CHUNK_VOLUME } from './constants';

/** Current on-disk chunk format version. */
export const CHUNK_FORMAT = 1;

export interface EncodedChunk {
  format: number;
  cx: number;
  cz: number;
  /** Deflated little-endian uint16 block values. */
  blocks: Uint8Array;
  biomes: Uint8Array;
}

export function encodeChunk(cx: number, cz: number, blocks: Uint16Array, biomes: Uint8Array): EncodedChunk {
  const bytes = new Uint8Array(blocks.buffer, blocks.byteOffset, blocks.byteLength);
  return { format: CHUNK_FORMAT, cx, cz, blocks: deflateSync(bytes, { level: 4 }), biomes: biomes.slice() };
}

export function decodeChunk(e: EncodedChunk): { blocks: Uint16Array; biomes: Uint8Array } {
  if (e.format !== CHUNK_FORMAT) throw new Error(`Unsupported chunk format ${e.format}`);
  const raw = inflateSync(e.blocks);
  if (raw.byteLength !== CHUNK_VOLUME * 2) throw new Error('Corrupt chunk data');
  const blocks = new Uint16Array(CHUNK_VOLUME);
  new Uint8Array(blocks.buffer).set(raw);
  return { blocks, biomes: new Uint8Array(e.biomes) };
}
