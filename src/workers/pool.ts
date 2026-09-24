import {
  transferables,
  type GenerateRequest,
  type GenerateResult,
  type LightRequest,
  type LightResult,
  type MeshRequest,
  type WorkerEnvelope,
  type WorkerReply,
  type WorkerRequest,
  type WorkerResult,
} from './protocol';
import type { MeshOutput } from '../render/meshing/mesher';

interface Pending {
  resolve: (r: WorkerResult) => void;
  reject: (e: Error) => void;
  worker: number;
}

/** Fixed pool of engine workers with least-busy dispatch. */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerReply>) => this.onReply(e.data);
      w.onerror = (e) => console.error('Worker error', e.message);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Jobs currently in flight across all workers. */
  get inFlight(): number {
    return this.pending.size;
  }

  private onReply(r: WorkerReply): void {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    this.busy[p.worker]--;
    if (r.ok) p.resolve(r.result!);
    else p.reject(new Error(r.error));
  }

  private run(req: WorkerRequest): Promise<WorkerResult> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[best]) best = i;
    const id = this.nextId++;
    this.busy[best]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: best });
      const env: WorkerEnvelope = { id, req };
      this.workers[best].postMessage(env, transferables(req));
    });
  }

  generate(req: Omit<GenerateRequest, 'type'>): Promise<GenerateResult> {
    return this.run({ type: 'generate', ...req }) as Promise<GenerateResult>;
  }

  light(req: Omit<LightRequest, 'type'>): Promise<LightResult> {
    return this.run({ type: 'light', ...req }) as Promise<LightResult>;
  }

  mesh(req: Omit<MeshRequest, 'type'>): Promise<MeshOutput> {
    return this.run({ type: 'mesh', ...req }) as Promise<MeshOutput>;
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Worker pool terminated'));
    this.pending.clear();
  }
}
