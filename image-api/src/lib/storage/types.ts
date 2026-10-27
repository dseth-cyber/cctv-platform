import type { Readable } from 'stream';

export type ProviderType = 's3' | 'local' | 'smb' | 'nfs' | 'seaweedfs';

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface StatsResult {
  objectCount: number;
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
}

export interface S3Config {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

export interface LocalDiskConfig {
  basePath: string;
}

export interface SMBConfig {
  share: string;
  domain?: string;
  username: string;
  password: string;
  mountPath?: string;
}

export interface NFSConfig {
  server: string;
  exportPath: string;
  mountOptions?: string;
  mountPath?: string;
}

export type ProviderConfig = S3Config | LocalDiskConfig | SMBConfig | NFSConfig;

export interface StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;

  save(key: string, data: Buffer, contentType: string): Promise<string>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  deleteBatch(keys: string[]): Promise<void>;
  list(prefix?: string): AsyncGenerator<string>;
  exists(key: string): Promise<boolean>;
  health(): Promise<HealthResult>;
  stats(): Promise<StatsResult>;
}

export interface RoutingRule {
  condition: {
    fileType?: string;
    tagKey?: string;
    tagValue?: string;
    cameraId?: string;
  };
  providerId: string;
}

export interface StorageProfileData {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  nameCn: string;
  nameMm: string;
  nameJp: string;
  description?: string;
  providerId: string;
  routingRules: RoutingRule[];
  sortOrder: number;
  isActive: boolean;
}
