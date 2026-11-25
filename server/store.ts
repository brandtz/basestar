// Key-value storage abstraction.
// Production: Netlify Blobs (strong consistency, ETag-conditional writes).
// Local dev: a folder of JSON files. Tests: in-memory.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConflictError } from './errors';

export interface KVEntry<T> { data: T; etag: string }
export interface SetOpts { onlyIfMatch?: string; onlyIfNew?: boolean }
export interface KV {
  get<T>(key: string): Promise<KVEntry<T> | null>;
  set(key: string, data: unknown, opts?: SetOpts): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}

// Minimal structural type so this file doesn't hard-depend on @netlify/blobs types.
interface BlobStoreLike {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: any; etag?: string } | null>;
  setJSON(key: string, data: unknown, opts?: any): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}

export class BlobsKV implements KV {
  constructor(private store: BlobStoreLike) {}
  async get<T>(key: string): Promise<KVEntry<T> | null> {
    const r = await this.store.getWithMetadata(key, { type: 'json' });
    if (!r) return null;
    return { data: r.data as T, etag: r.etag ?? '' };
  }
  async set(key: string, data: unknown, opts?: SetOpts) {
    const o: any = {};
    if (opts?.onlyIfMatch) o.onlyIfMatch = opts.onlyIfMatch;
    else if (opts?.onlyIfNew) o.onlyIfNew = true;
    const r = await this.store.setJSON(key, data, o);
    return { modified: r.modified };
  }
  async delete(key: string) { await this.store.delete(key); }
}

const etagOf = (s: string) => createHash('sha1').update(s).digest('hex');

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  async get<T>(key: string) {
    const s = this.m.get(key);
    return s === undefined ? null : { data: JSON.parse(s) as T, etag: etagOf(s) };
  }
  async set(key: string, data: unknown, opts?: SetOpts) {
    const cur = this.m.get(key);
    if (opts?.onlyIfNew && cur !== undefined) return { modified: false };
    if (opts?.onlyIfMatch && (cur === undefined || etagOf(cur) !== opts.onlyIfMatch)) return { modified: false };
    this.m.set(key, JSON.stringify(data));
    return { modified: true };
  }
  async delete(key: string) { this.m.delete(key); }
}

export class FileKV implements KV {
  constructor(private dir: string) {}
  private file(key: string) { return path.join(this.dir, encodeURIComponent(key) + '.json'); }
  async get<T>(key: string) {
    try {
      const s = await fs.readFile(this.file(key), 'utf8');
      return { data: JSON.parse(s) as T, etag: etagOf(s) };
    } catch { return null; }
  }
  async set(key: string, data: unknown, opts?: SetOpts) {
    const cur = await this.get(key);
    if (opts?.onlyIfNew && cur) return { modified: false };
    if (opts?.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(key), JSON.stringify(data, null, 2));
    return { modified: true };
  }
  async delete(key: string) { await fs.rm(this.file(key), { force: true }); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Optimistic-concurrency read-modify-write. `fn` may run more than once, so it must
 * not have side effects beyond mutating/returning the draft. Throwing aborts the write.
 */
export async function update<T>(kv: KV, key: string, init: () => T, fn: (draft: T) => T | void | Promise<T | void>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await kv.get<T>(key);
    const draft: T = cur ? structuredClone(cur.data) : init();
    const out = await fn(draft);
    const next = (out === undefined ? draft : out) as T;
    const res = cur
      ? await kv.set(key, next, { onlyIfMatch: cur.etag })
      : await kv.set(key, next, { onlyIfNew: true });
    if (res.modified) return next;
    await sleep(25 * (attempt + 1) + Math.random() * 40);
  }
  throw new ConflictError('Someone else was saving at the same moment. Please try again.');
}

export async function read<T>(kv: KV, key: string, fallback: T): Promise<T> {
  const r = await kv.get<T>(key);
  return r ? r.data : fallback;
}
