import { getPrisma } from '../prisma.js';
import { logger } from '../logger.js';

// The rows the seed creates for the bundled MinIO and for the local disk.
export const SEEDED_MINIO_PROVIDER_ID = '00000000-0000-0000-0000-000000000020';
export const SEEDED_LOCAL_PROVIDER_ID = '00000000-0000-0000-0000-000000000022';
export const SEEDED_SEAWEED_PROVIDER_ID = '00000000-0000-0000-0000-000000000021';
const FLAG = 'storage_local_ready';

/**
 * MinIO no longer ships with the system (its images left Docker Hub, and CCTV never stored a file in it), so an
 * installation seeded before that moves to the local disk provider. Runs once. It changes only the two rows the
 * seed made, and only while the MinIO row still points at the bundled `minio` container: storage an administrator
 * set up is left alone. No table refers to files by provider, so nothing has to move.
 */
export async function ensureStorageWithoutBundledMinio(): Promise<{ switched: boolean }> {
  const prisma = getPrisma();
  if (await prisma.systemConfig.findUnique({ where: { key: FLAG } })) return { switched: false };

  const minio = await prisma.storageProvider.findUnique({ where: { id: SEEDED_MINIO_PROVIDER_ID } });
  const local = await prisma.storageProvider.findUnique({ where: { id: SEEDED_LOCAL_PROVIDER_ID } });
  const bundled = minio && !minio.deletedAt && minio.type === 's3' && (minio.config as any)?.endpoint === 'minio';
  let switched = false;

  if (bundled && (minio.isActive || minio.isDefault) && local && !local.deletedAt && local.type === 'local') {
    const ops = [
      prisma.storageProvider.update({
        where: { id: SEEDED_MINIO_PROVIDER_ID },
        data: { isActive: false, isDefault: false, description: 'Bundled MinIO (optional: docker compose --profile minio). Turned off when MinIO stopped shipping with the system.' },
      }),
    ];
    if (minio.isDefault) {
      ops.push(prisma.storageProvider.update({
        where: { id: SEEDED_LOCAL_PROVIDER_ID },
        data: { isActive: true, isDefault: true, name: 'Local Disk Storage', description: 'Local disk inside image-api (volume image-data at /data/images)' },
      }));
    }
    await prisma.$transaction(ops);
    switched = true;
  }

  // The seed also turned on the SeaweedFS entry, which runs only with --profile seaweedfs: off, unless it was made default.
  const seaweed = await prisma.storageProvider.findUnique({ where: { id: SEEDED_SEAWEED_PROVIDER_ID } });
  if (seaweed && !seaweed.deletedAt && seaweed.isActive && !seaweed.isDefault && (seaweed.config as any)?.endpoint === 'seaweedfs-filer') {
    await prisma.storageProvider.update({ where: { id: SEEDED_SEAWEED_PROVIDER_ID }, data: { isActive: false } });
    switched = true;
  }

  await prisma.systemConfig.create({
    data: { key: FLAG, value: 'true', valueType: 'boolean', category: 'internal', description: 'Storage moved off the bundled MinIO to the local disk (or nothing to move)' },
  });
  if (switched) logger.info({ defaultMovedToLocal: !!minio?.isDefault }, 'Bundled MinIO storage turned off; local disk storage in use');
  return { switched };
}
