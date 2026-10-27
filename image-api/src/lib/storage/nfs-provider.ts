import type { Readable } from 'stream';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { StorageProvider, NFSConfig, HealthResult, StatsResult } from './types.js';

export class NFSProvider implements StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type = 'nfs' as const;
  private config: NFSConfig;

  constructor(id: string, name: string, config: NFSConfig) {
    this.id = id;
    this.name = name;
    this.config = config;
  }

  private getBasePath(): string {
    return this.config.mountPath || `/mnt/nfs/${this.id}`;
  }

  private resolvePath(key: string): string {
    const safe = key.replace(/\.\./g, '_');
    return path.join(this.getBasePath(), safe);
  }

  async save(key: string, data: Buffer): Promise<string> {
    const fullPath = this.resolvePath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return key;
  }

  async getStream(key: string): Promise<Readable> {
    const { createReadStream } = await import('node:fs');
    return createReadStream(this.resolvePath(key)) as unknown as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.resolvePath(key));
  }

  async deleteBatch(keys: string[]): Promise<void> {
    await Promise.all(keys.map(k => this.delete(k).catch(() => {})));
  }

  async *list(prefix?: string): AsyncGenerator<string> {
    const dir = this.getBasePath();
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!prefix || file.startsWith(prefix)) yield file;
      }
    } catch {
      // directory may not exist
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const dir = this.getBasePath();
      await fs.mkdir(dir, { recursive: true });
      const testFile = path.join(dir, `.health_${Date.now()}`);
      await fs.writeFile(testFile, 'ok');
      await fs.unlink(testFile);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async stats(): Promise<StatsResult> {
    const dir = this.getBasePath();
    try {
      const files = await fs.readdir(dir);
      let usedBytes = 0;
      let objectCount = 0;
      for (const file of files) {
        if (file.startsWith('.')) continue;
        try {
          const stat = await fs.stat(path.join(dir, file));
          usedBytes += stat.size;
          objectCount++;
        } catch { /* skip */ }
      }
      return { objectCount, usedBytes, totalBytes: 0, freeBytes: 0 };
    } catch {
      return { objectCount: 0, usedBytes: 0, totalBytes: 0, freeBytes: 0 };
    }
  }
}
