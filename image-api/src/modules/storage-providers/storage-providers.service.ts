import { getPrisma } from '../../lib/prisma.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { S3Provider } from '../../lib/storage/s3-provider.js';
import { LocalDiskProvider } from '../../lib/storage/local-disk-provider.js';
import { SMBProvider } from '../../lib/storage/smb-provider.js';
import { NFSProvider } from '../../lib/storage/nfs-provider.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import type { CreateProviderInput, UpdateProviderInput } from './storage-providers.schema.js';
import type { S3Config, LocalDiskConfig, SMBConfig, NFSConfig } from '../../lib/storage/types.js';

export async function listProviders() {
  const prisma = getPrisma();
  const providers = await prisma.storageProvider.findMany({
    where: { deletedAt: null },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  });

  const providerIds = providers.map((p) => p.id);
  const latestMetrics = await Promise.all(
    providerIds.map((id) =>
      prisma.storageProviderMetric.findFirst({
        where: { providerId: id },
        orderBy: { collectedAt: 'desc' },
        select: { usedBytes: true, totalBytes: true, freeBytes: true, objectCount: true, status: true, latencyMs: true, collectedAt: true },
      }),
    ),
  );

  return providers.map((p, i) => {
    const capacityCap = p.capacityBytes ? Number(p.capacityBytes) : null;
    const metric = latestMetrics[i];
    const usedBytes = metric ? Number(metric.usedBytes) : 0;
    const totalBytes = capacityCap ?? (metric ? Number(metric.totalBytes) : 0);
    const freeBytes = capacityCap ? Math.max(0, capacityCap - usedBytes) : (metric ? Number(metric.freeBytes) : 0);

    return {
      ...p,
      capacityBytes: capacityCap,
      latestMetric: metric
        ? {
            usedBytes,
            totalBytes,
            freeBytes,
            objectCount: Number(metric.objectCount),
            status: metric.status,
            latencyMs: metric.latencyMs,
            collectedAt: metric.collectedAt,
          }
        : null,
    };
  });
}

export async function getProviderById(id: string) {
  const prisma = getPrisma();
  const provider = await prisma.storageProvider.findUnique({ where: { id } });
  if (!provider || provider.deletedAt) throw new NotFoundError('StorageProvider', id);
  return provider;
}

export async function createProvider(input: CreateProviderInput) {
  const prisma = getPrisma();

  const existing = await prisma.storageProvider.findFirst({
    where: { name: input.name, deletedAt: null },
  });
  if (existing) throw new ConflictError(`Storage provider '${input.name}' already exists`);

  let config: Record<string, unknown>;
  switch (input.type) {
    case 'local':
      config = { basePath: (input.config as LocalDiskConfig).basePath };
      break;
    case 'smb':
      config = {
        share: (input.config as SMBConfig).share,
        domain: (input.config as SMBConfig).domain,
        username: (input.config as SMBConfig).username,
        password: (input.config as SMBConfig).password,
        mountPath: (input.config as SMBConfig).mountPath,
      };
      break;
    case 'nfs':
      config = {
        server: (input.config as NFSConfig).server,
        exportPath: (input.config as NFSConfig).exportPath,
        mountOptions: (input.config as NFSConfig).mountOptions,
        mountPath: (input.config as NFSConfig).mountPath,
      };
      break;
    default:
      config = {
        endpoint: (input.config as S3Config).endpoint,
        port: (input.config as S3Config).port,
        accessKey: (input.config as S3Config).accessKey,
        secretKey: (input.config as S3Config).secretKey,
        bucket: (input.config as S3Config).bucket,
        useSSL: (input.config as S3Config).useSSL,
      };
  }

  const provider = await prisma.storageProvider.create({
    data: {
      name: input.name,
      type: input.type,
      config: config as any,
      isDefault: input.isDefault ?? false,
      priority: input.priority ?? 0,
      description: input.description,
      capacityBytes: input.capacityBytes != null ? BigInt(input.capacityBytes) : null,
    },
  });

  if (provider.isDefault) {
    await prisma.storageProvider.updateMany({
      where: { id: { not: provider.id }, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
  }

  try {
    buildProviderInstance(provider.id, provider.name, provider.type as any, provider.config as any);
    storageRouter.register({
      id: provider.id,
      name: provider.name,
      type: provider.type as any,
      config: provider.config as any,
      isDefault: provider.isDefault,
      isActive: provider.isActive,
    });
  } catch (err) {
    // provider registered but may not respond — that's OK
  }

  return provider;
}

export async function updateProvider(id: string, input: UpdateProviderInput) {
  const prisma = getPrisma();

  const existing = await prisma.storageProvider.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new NotFoundError('StorageProvider', id);

  if (input.name && input.name !== existing.name) {
    const nameConflict = await prisma.storageProvider.findFirst({
      where: { name: input.name, deletedAt: null, id: { not: id } },
    });
    if (nameConflict) throw new ConflictError(`Storage provider '${input.name}' already exists`);
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.config !== undefined) data.config = input.config as Record<string, unknown>;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.description !== undefined) data.description = input.description;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.capacityBytes !== undefined) data.capacityBytes = input.capacityBytes != null ? BigInt(input.capacityBytes) : null;

  if (input.isDefault === true) {
    data.isDefault = true;
    await prisma.storageProvider.updateMany({
      where: { id: { not: id }, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
  }

  const provider = await prisma.storageProvider.update({
    where: { id },
    data,
  });

  storageRouter.unregister(id);
  try {
    storageRouter.register({
      id: provider.id,
      name: provider.name,
      type: provider.type as any,
      config: provider.config as any,
      isDefault: provider.isDefault,
      isActive: provider.isActive,
    });
  } catch {
    // ignore
  }

  if (input.isDefault === true) storageRouter.setDefault(id);

  return provider;
}

export async function deleteProvider(id: string) {
  const prisma = getPrisma();

  const existing = await prisma.storageProvider.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new NotFoundError('StorageProvider', id);


  await prisma.storageProvider.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, isDefault: false },
  });

  storageRouter.unregister(id);
}

export async function testProvider(id: string) {
  const provider = await getProviderById(id);
  try {
    const instance = buildProviderInstance(provider.id, provider.name, provider.type as any, provider.config as any);
    const result = await instance.health();
    return result;
  } catch (err: any) {
    return { ok: false, latencyMs: 0, error: err.message };
  }
}

export async function getProviderMetrics(id: string) {
  const prisma = getPrisma();
  const metrics = await prisma.storageProviderMetric.findMany({
    where: { providerId: id },
    orderBy: { collectedAt: 'desc' },
    take: 100,
  });
  return metrics;
}

function buildProviderInstance(id: string, name: string, type: string, config: any) {
  switch (type) {
    case 's3':
    case 'seaweedfs':
      return new S3Provider(id, name, config as S3Config, type as any);
    case 'local':
      return new LocalDiskProvider(id, name, config as LocalDiskConfig);
    case 'smb':
      return new SMBProvider(id, name, config as SMBConfig);
    case 'nfs':
      return new NFSProvider(id, name, config as NFSConfig);
    default:
      throw new ValidationError(`Unsupported provider type: ${type}`);
  }
}
