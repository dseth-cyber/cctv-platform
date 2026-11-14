import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPrisma } from '../prisma.js';
import { ensureStorageWithoutBundledMinio, SEEDED_LOCAL_PROVIDER_ID, SEEDED_MINIO_PROVIDER_ID, SEEDED_SEAWEED_PROVIDER_ID } from './ensure-local-storage.js';

function fake(rows: Record<string, any>, flag = false) {
  const updates: any[] = [];
  const prisma = {
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue(flag ? { key: 'storage_local_ready' } : null),
      create: vi.fn().mockResolvedValue({}),
    },
    storageProvider: {
      findUnique: vi.fn(async ({ where }: any) => rows[where.id] ?? null),
      update: vi.fn((args: any) => { updates.push(args); return args; }),
    },
    $transaction: vi.fn(async (ops: any[]) => ops),
  };
  vi.mocked(getPrisma).mockReturnValue(prisma as any);
  return { prisma, updates };
}

const seededMinio = { id: SEEDED_MINIO_PROVIDER_ID, type: 's3', config: { endpoint: 'minio' }, isActive: true, isDefault: true, deletedAt: null };
const seededLocal = { id: SEEDED_LOCAL_PROVIDER_ID, type: 'local', config: { basePath: '/data/images' }, isActive: true, isDefault: false, deletedAt: null };

describe('Moving off the bundled MinIO', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an install seeded with MinIO as default moves the default to the local disk and turns MinIO off, once', async () => {
    const { prisma, updates } = fake({ [SEEDED_MINIO_PROVIDER_ID]: seededMinio, [SEEDED_LOCAL_PROVIDER_ID]: seededLocal });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: true });
    expect(updates).toEqual([
      expect.objectContaining({ where: { id: SEEDED_MINIO_PROVIDER_ID }, data: expect.objectContaining({ isActive: false, isDefault: false }) }),
      expect.objectContaining({ where: { id: SEEDED_LOCAL_PROVIDER_ID }, data: expect.objectContaining({ isActive: true, isDefault: true }) }),
    ]);
    expect(prisma.systemConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ key: 'storage_local_ready' }) }));
  });

  it('turns off the seeded SeaweedFS entry (it runs only with its profile) unless it is the default', async () => {
    const seaweed = { id: SEEDED_SEAWEED_PROVIDER_ID, type: 'seaweedfs', config: { endpoint: 'seaweedfs-filer' }, isActive: true, isDefault: false, deletedAt: null };
    const { updates } = fake({ [SEEDED_SEAWEED_PROVIDER_ID]: seaweed });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: true });
    expect(updates).toEqual([{ where: { id: SEEDED_SEAWEED_PROVIDER_ID }, data: { isActive: false } }]);

    const kept = fake({ [SEEDED_SEAWEED_PROVIDER_ID]: { ...seaweed, isDefault: true } });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: false });
    expect(kept.updates).toHaveLength(0);
  });

  it('does nothing once the flag is set', async () => {
    const { prisma } = fake({ [SEEDED_MINIO_PROVIDER_ID]: seededMinio, [SEEDED_LOCAL_PROVIDER_ID]: seededLocal }, true);
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: false });
    expect(prisma.storageProvider.update).not.toHaveBeenCalled();
  });

  it('leaves an S3 provider an administrator pointed somewhere else', async () => {
    const { prisma } = fake({ [SEEDED_MINIO_PROVIDER_ID]: { ...seededMinio, config: { endpoint: 's3.company.local' } }, [SEEDED_LOCAL_PROVIDER_ID]: seededLocal });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: false });
    expect(prisma.storageProvider.update).not.toHaveBeenCalled();
    expect(prisma.systemConfig.create).toHaveBeenCalled();
  });

  it('keeps another default the administrator chose, and only turns the bundled MinIO off', async () => {
    const { updates } = fake({ [SEEDED_MINIO_PROVIDER_ID]: { ...seededMinio, isDefault: false }, [SEEDED_LOCAL_PROVIDER_ID]: seededLocal });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].where.id).toBe(SEEDED_MINIO_PROVIDER_ID);
  });

  it('a fresh install (seed already uses the local disk) changes nothing', async () => {
    const { prisma } = fake({ [SEEDED_MINIO_PROVIDER_ID]: { ...seededMinio, isActive: false, isDefault: false }, [SEEDED_LOCAL_PROVIDER_ID]: { ...seededLocal, isDefault: true } });
    expect(await ensureStorageWithoutBundledMinio()).toEqual({ switched: false });
    expect(prisma.storageProvider.update).not.toHaveBeenCalled();
  });
});
