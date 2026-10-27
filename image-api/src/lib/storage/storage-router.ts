import { S3Provider } from './s3-provider.js';
import { LocalDiskProvider } from './local-disk-provider.js';
import { SMBProvider } from './smb-provider.js';
import { NFSProvider } from './nfs-provider.js';
import type { StorageProvider, ProviderConfig, ProviderType } from './types.js';

interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  config: ProviderConfig;
  isDefault: boolean;
  isActive: boolean;
}

class StorageRouter {
  private providers: Map<string, StorageProvider> = new Map();
  private defaultProviderId: string | null = null;

  private buildProvider(record: ProviderRecord): StorageProvider {
    switch (record.type) {
      case 's3':
      case 'seaweedfs':
        return new S3Provider(record.id, record.name, record.config as any, record.type);
      case 'local':
        return new LocalDiskProvider(record.id, record.name, record.config as any);
      case 'smb':
        return new SMBProvider(record.id, record.name, record.config as any);
      case 'nfs':
        return new NFSProvider(record.id, record.name, record.config as any);
    }
  }

  register(record: ProviderRecord): void {
    const provider = this.buildProvider(record);
    this.providers.set(record.id, provider);
    if (record.isDefault) {
      this.defaultProviderId = record.id;
    }
  }

  unregister(id: string): void {
    this.providers.delete(id);
    if (this.defaultProviderId === id) {
      this.defaultProviderId = this.providers.size > 0 ? this.providers.keys().next().value ?? null : null;
    }
  }

  get(id: string): StorageProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`StorageProvider '${id}' not found`);
    return provider;
  }

  getDefault(): StorageProvider {
    if (this.defaultProviderId) {
      return this.get(this.defaultProviderId);
    }
    if (this.providers.size > 0) {
      const first = this.providers.values().next().value;
      if (first) return first;
    }
    throw new Error('No storage providers registered');
  }

  getAll(): StorageProvider[] {
    return Array.from(this.providers.values());
  }

  getDefaultId(): string | null {
    return this.defaultProviderId;
  }

  setDefault(id: string): void {
    if (!this.providers.has(id)) throw new Error(`StorageProvider '${id}' not found`);
    this.defaultProviderId = id;
  }

  async refresh(loadFn: () => Promise<ProviderRecord[]>): Promise<void> {
    const records = await loadFn();
    this.providers.clear();
    this.defaultProviderId = null;
    for (const record of records) {
      if (record.isActive) {
        this.register(record);
      }
    }
  }

  size(): number {
    return this.providers.size;
  }
}

export const storageRouter = new StorageRouter();
