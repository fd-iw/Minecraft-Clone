import type { MeshInput, MeshOutput } from '../render/meshing/mesher';

export interface GenerateRequest {
  type: 'generate';
  seed: number;
  cx: number;
  cz: number;
}

export interface GenerateResult {
  blocks: Uint16Array;
  biomes: Uint8Array;
  light: Uint8Array;
}

export interface LightRequest {
  type: 'light';
  cx: number;
  cz: number;
  blocks: Uint16Array;
}

export interface LightResult {
  light: Uint8Array;
}

export interface MeshRequest extends MeshInput {
  type: 'mesh';
}

export type WorkerRequest = GenerateRequest | LightRequest | MeshRequest;
export type WorkerResult = GenerateResult | LightResult | MeshOutput;

export interface WorkerEnvelope {
  id: number;
  req: WorkerRequest;
}

export interface WorkerReply {
  id: number;
  ok: boolean;
  result?: WorkerResult;
  error?: string;
}

/** Transferable buffers inside a request/result, so they are moved instead of copied. */
export function transferables(obj: object): Transferable[] {
  const out: Transferable[] = [];
  for (const v of Object.values(obj)) {
    if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) out.push(v.buffer);
  }
  return out;
}
