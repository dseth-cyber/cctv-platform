import { getPrisma } from '../prisma.js';
import { storageRouter } from './storage-router.js';
import { NotFoundError } from '../errors.js';

export interface MigrationProgress {
  jobId: string;
  totalFiles: number;
  migratedFiles: number;
  totalBytes: number;
  migratedBytes: number;
  status: string;
}

export async function createMigrationJob(
  sourceId: string,
  targetId: string,
  fileType?: string,
): Promise<string> {
  const prisma = getPrisma();

  const source = await prisma.storageProvider.findUnique({ where: { id: sourceId } });
  if (!source || source.deletedAt) throw new NotFoundError('Source StorageProvider', sourceId);

  const target = await prisma.storageProvider.findUnique({ where: { id: targetId } });
  if (!target || target.deletedAt) throw new NotFoundError('Target StorageProvider', targetId);

  if (sourceId === targetId) {
    throw new Error('Source and target must be different providers');
  }

  const fileFilter: Record<string, unknown> = { storageProviderId: sourceId };
  if (fileType) fileFilter.fileType = fileType;

  const totalFiles = await prisma.imageFile.count({ where: fileFilter });
  const totalBytesResult = await prisma.imageFile.aggregate({
    where: fileFilter,
    _sum: { fileSizeBytes: true },
  });

  const job = await prisma.migrationJob.create({
    data: {
      sourceId,
      targetId,
      fileType: fileType ?? null,
      totalFiles,
      totalBytes: totalBytesResult._sum.fileSizeBytes ?? 0n,
      status: 'pending',
      migratedFiles: 0,
      migratedBytes: 0n,
    },
  });

  return job.id;
}

export async function runMigrationJob(jobId: string): Promise<MigrationProgress> {
  const prisma = getPrisma();

  const job = await prisma.migrationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError('MigrationJob', jobId);

  await prisma.migrationJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date() },
  });

  let migratedFiles = 0;
  let migratedBytes = 0n;

  try {
    const sourceProvider = storageRouter.get(job.sourceId);
    const targetProvider = storageRouter.get(job.targetId);

    const fileFilter: Record<string, unknown> = { storageProviderId: job.sourceId };
    if (job.fileType) fileFilter.fileType = job.fileType;

    const files = await prisma.imageFile.findMany({
      where: fileFilter,
      select: { id: true, objectKey: true, fileSizeBytes: true, fileType: true },
      orderBy: { id: 'asc' },
    });

    for (const file of files) {
      try {
        const data = await sourceProvider.getBuffer(file.objectKey);
        await targetProvider.save(file.objectKey, data, 'application/octet-stream');

        await prisma.imageFile.update({
          where: { id: file.id },
          data: { storageProviderId: job.targetId },
        });

        migratedFiles++;
        migratedBytes += file.fileSizeBytes ?? 0n;

        await prisma.migrationJob.update({
          where: { id: jobId },
          data: { migratedFiles, migratedBytes },
        });
      } catch {
        // skip individual file errors and continue
      }
    }

    const finalStatus = migratedFiles > 0 ? 'completed' : 'failed';
    await prisma.migrationJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        errorMessage: migratedFiles === 0 ? 'No files were migrated' : undefined,
      },
    });

    return {
      jobId,
      totalFiles: job.totalFiles,
      migratedFiles,
      totalBytes: Number(job.totalBytes),
      migratedBytes: Number(migratedBytes),
      status: finalStatus,
    };
  } catch (err: any) {
    await prisma.migrationJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    });
    return {
      jobId,
      totalFiles: job.totalFiles,
      migratedFiles,
      totalBytes: Number(job.totalBytes),
      migratedBytes: Number(migratedBytes),
      status: 'failed',
    };
  }
}

export async function listMigrationJobs(filters?: { status?: string }) {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;

  return prisma.migrationJob.findMany({
    where,
    include: {
      sourceProvider: { select: { id: true, name: true, type: true } },
      targetProvider: { select: { id: true, name: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function cancelMigrationJob(jobId: string) {
  const prisma = getPrisma();
  const job = await prisma.migrationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError('MigrationJob', jobId);
  if (!['pending', 'running'].includes(job.status)) {
    throw new Error(`Cannot cancel job in '${job.status}' state`);
  }

  return prisma.migrationJob.update({
    where: { id: jobId },
    data: { status: 'cancelled', completedAt: new Date() },
  });
}
