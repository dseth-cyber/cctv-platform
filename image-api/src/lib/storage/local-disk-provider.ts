import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import type { StorageProvider, LocalDiskConfig, HealthResult, StatsResult } from './types.js';

export class LocalDiskProvider implements StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type = 'local' as const;
  private config: LocalDiskConfig;

  constructor(id: string, name: string, config: LocalDiskConfig) {
    this.id = id;
    this.name = name;
    this.config = config;
    fs.mkdirSync(config.basePath, { recursive: true });
  }

  private resolvePath(key: string): string {
    return path.join(this.config.basePath, key);
  }

  static buildObjectKey(
    date: Date,
    fileType: string,
    filename: string,
  ): string {
    const yyyy = date.getUTCFullYear().toString();
    const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const hash = createHash('sha256').update(filename).digest('hex');
    const prefix = hash.slice(0, 2);
    return `${yyyy}/${mm}/${dd}/${fileType}/${prefix}/${filename}`;
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, data);
    return key;
  }

  async getStream(key: string): Promise<Readable> {
    return fs.createReadStream(this.resolvePath(key));
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.readFileSync(this.resolvePath(key));
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      fs.unlinkSync(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async deleteBatch(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  async *list(prefix = ''): AsyncGenerator<string> {
    const dir = this.resolvePath(prefix);
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relativePath = path.relative(this.config.basePath, path.join(entry.parentPath, entry.name));
      yield relativePath.replace(/\\/g, '/');
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolvePath(key));
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      fs.accessSync(this.config.basePath, fs.constants.W_OK);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async stats(): Promise<StatsResult> {
    let objectCount = 0;
    let usedBytes = 0;

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          objectCount++;
          try { usedBytes += fs.statSync(full).size; } catch { /* skip */ }
        }
      }
    };

    walk(this.config.basePath);

    let totalBytes = 0;
    let freeBytes = 0;
    try {
      const diskStats = fs.statfsSync(this.config.basePath);
      totalBytes = diskStats.bsize * diskStats.blocks;
      freeBytes = diskStats.bsize * diskStats.bavail;
    } catch { /* statfsSync not available or path error */ }

    return { objectCount, usedBytes, totalBytes, freeBytes };
  }
}
