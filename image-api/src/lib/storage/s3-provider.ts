import { Client } from 'minio';
import type { Readable } from 'stream';
import type { StorageProvider, S3Config, HealthResult, StatsResult, ProviderType } from './types.js';

// Default internal address of the SeaweedFS volume server's own status endpoint —
// this is where real disk total/free bytes live (the S3/filer API has no such concept).
// Override per-provider via config.volumeServerUrl if the deployment topology differs.
const DEFAULT_SEAWEEDFS_VOLUME_URL = 'http://seaweedfs-volume:8080';

export class S3Provider implements StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  private client: Client;
  private config: S3Config;

  constructor(id: string, name: string, config: S3Config, type: ProviderType = 's3') {
    this.id = id;
    this.name = name;
    this.type = type;
    this.config = config;
    this.client = new Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  async save(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.client.putObject(this.config.bucket, key, data, data.length, { 'Content-Type': contentType });
    return key;
  }

  async getStream(key: string): Promise<Readable> {
    return this.client.getObject(this.config.bucket, key);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.config.bucket, key);
  }

  async deleteBatch(keys: string[]): Promise<void> {
    await this.client.removeObjects(this.config.bucket, keys);
  }

  async *list(prefix = ''): AsyncGenerator<string> {
    const stream = this.client.listObjects(this.config.bucket, prefix, true);
    for await (const obj of stream) {
      if (obj.name) yield obj.name;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.config.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      await this.client.bucketExists(this.config.bucket);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async stats(): Promise<StatsResult> {
    const { totalBytes, freeBytes, objectCount: seaObjectCount, usedBytes: seaUsedBytes } = await this.detectRealCapacity();
    let objectCount = seaObjectCount;
    let usedBytes = seaUsedBytes;

    if (this.type !== 'seaweedfs') {
      const stream = this.client.listObjects(this.config.bucket, '', true);
      for await (const obj of stream) {
        objectCount++;
        usedBytes += Number((obj as any).size ?? 0);
      }
    }

    return { objectCount, usedBytes, totalBytes, freeBytes };
  }

  // The S3/filer API has no notion of disk capacity — only SeaweedFS's volume
  // server reports real total/free bytes, via its own (non-S3) status endpoint.
  // Falls back to { 0, 0, 0, 0 } for plain S3/MinIO or if the volume server can't be
  // reached, which lets the metric collector fall back to a manually-set cap.
  private async detectRealCapacity(): Promise<{ totalBytes: number; freeBytes: number; objectCount: number; usedBytes: number }> {
    if (this.type !== 'seaweedfs') return { totalBytes: 0, freeBytes: 0, objectCount: 0, usedBytes: 0 };
    const volumeUrl = (this.config as any).volumeServerUrl || DEFAULT_SEAWEEDFS_VOLUME_URL;
    try {
      const res = await fetch(`${volumeUrl}/status`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { totalBytes: 0, freeBytes: 0, objectCount: 0, usedBytes: 0 };
      const data: any = await res.json();
      let totalBytes = 0;
      let freeBytes = 0;
      for (const disk of data.DiskStatuses ?? []) {
        totalBytes += Number(disk.all ?? 0);
        freeBytes += Number(disk.free ?? 0);
      }
      let objectCount = 0;
      let usedBytes = 0;
      for (const v of data.Volumes ?? []) {
        objectCount += Number(v.FileCount ?? 0);
        usedBytes += Number(v.Size ?? 0);
      }
      return { totalBytes, freeBytes, objectCount, usedBytes };
    } catch {
      return { totalBytes: 0, freeBytes: 0, objectCount: 0, usedBytes: 0 };
    }
  }
}
