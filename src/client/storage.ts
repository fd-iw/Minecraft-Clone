import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EncodedChunk } from '../engine/codec';
import type { GameMode, PlayerSave } from '../engine/player';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  gameMode: GameMode;
  createdAt: number;
  lastPlayed: number;
  time: number;
  dayTime: number;
  spawn?: [number, number, number];
  player?: PlayerSave;
  dataVersion: number;
}

interface Schema extends DBSchema {
  worlds: { key: string; value: WorldMeta };
  chunks: { key: [string, number, number]; value: EncodedChunk & { world: string } };
}

export const DATA_VERSION = 1;

/** IndexedDB persistence: world metadata plus one record per modified chunk. */
export class Storage {
  private constructor(private readonly db: IDBPDatabase<Schema>) {}

  static async open(name = 'stratavale'): Promise<Storage> {
    const db = await openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('worlds', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['world', 'cx', 'cz'] });
      },
    });
    return new Storage(db);
  }

  async listWorlds(): Promise<WorldMeta[]> {
    const all = await this.db.getAll('worlds');
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  getWorld(id: string): Promise<WorldMeta | undefined> {
    return this.db.get('worlds', id);
  }

  async saveWorld(meta: WorldMeta): Promise<void> {
    await this.db.put('worlds', meta);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    await tx.objectStore('worlds').delete(id);
    const range = IDBKeyRange.bound([id, -Infinity, -Infinity], [id, Infinity, Infinity]);
    await tx.objectStore('chunks').delete(range);
    await tx.done;
  }

  async loadChunk(world: string, cx: number, cz: number): Promise<EncodedChunk | undefined> {
    return this.db.get('chunks', [world, cx, cz]);
  }

  async saveChunks(world: string, chunks: EncodedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    await Promise.all(chunks.map((c) => tx.store.put({ ...c, world })));
    await tx.done;
  }
}

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
