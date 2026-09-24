/// <reference lib="webworker" />
import { Chunk } from '../engine/chunk';
import { LightEngine } from '../engine/lighting';
import { ChunkGenerator } from '../engine/worldgen/generator';
import { meshColumn } from '../render/meshing/mesher';
import { transferables, type WorkerEnvelope, type WorkerReply, type WorkerResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let generator: ChunkGenerator | null = null;
const isolatedLight = new LightEngine({ getChunk: () => undefined });

function handle(env: WorkerEnvelope): WorkerResult {
  const req = env.req;
  switch (req.type) {
    case 'generate': {
      if (!generator || generator.seed !== req.seed) generator = new ChunkGenerator(req.seed);
      const g = generator.generate(req.cx, req.cz);
      const chunk = new Chunk(req.cx, req.cz, g.blocks, g.biomes);
      isolatedLight.lightChunkIsolated(chunk);
      return { blocks: chunk.blocks, biomes: chunk.biomes, light: chunk.light };
    }
    case 'light': {
      const chunk = new Chunk(req.cx, req.cz, req.blocks);
      isolatedLight.lightChunkIsolated(chunk);
      return { light: chunk.light };
    }
    case 'mesh':
      return meshColumn(req);
  }
}

self.onmessage = (e: MessageEvent<WorkerEnvelope>) => {
  let reply: WorkerReply;
  try {
    const result = handle(e.data);
    reply = { id: e.data.id, ok: true, result };
    self.postMessage(reply, transferables(result));
  } catch (err) {
    reply = {
      id: e.data.id,
      ok: false,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    };
    self.postMessage(reply);
  }
};
