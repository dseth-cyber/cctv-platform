import { getPrisma } from '../../lib/prisma.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { logger } from '../../lib/logger.js';
import { planCleanup, type CleanupPlan, type CleanupTrigger } from './cleanup-planner.service.js';

export interface ExecuteResult {
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
}

// Deletes the physical objects for each candidate, then removes the matching ImageFile
// rows. If an Image ends up with zero remaining files after this pass (e.g. a circular
// or aggressive cleanup that reached "raw"), its now-empty metadata row is removed too.
export async function executeCleanup(plan: CleanupPlan): Promise<ExecuteResult> {
  const prisma = getPrisma();
  const provider = storageRouter.get(plan.providerId);

  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: string[] = [];
  const touchedImageIds = new Set<string>();

  for (const c of plan.candidates) {
    try {
      await provider.delete(c.objectKey);
    } catch (err: any) {
      errors.push(`${c.objectKey}: ${err.message}`);
      continue;
    }
    await prisma.imageFile.delete({ where: { id: c.fileId } }).catch(() => {});
    filesDeleted += 1;
    bytesFreed += c.bytes;
    touchedImageIds.add(c.imageId);
  }

  for (const imageId of touchedImageIds) {
    const remaining = await prisma.imageFile.count({ where: { imageId } });
    if (remaining === 0) {
      await prisma.imageTag.deleteMany({ where: { imageId } }).catch(() => {});
      await prisma.processingJob.deleteMany({ where: { imageId } }).catch(() => {});
      await prisma.image.delete({ where: { id: imageId } }).catch(() => {});
    }
  }

  return { filesDeleted, bytesFreed, errors };
}

export async function runCleanup(
  providerId: string,
  trigger: CleanupTrigger,
  opts: { dryRun: boolean; triggeredBy?: string },
): Promise<{ runId: string; plan: CleanupPlan; filesDeleted: number; bytesFreed: number; errors: string[] }> {
  const prisma = getPrisma();
  const plan = await planCleanup(providerId, trigger);

  const run = await prisma.cleanupRun.create({
    data: {
      storageProviderId: providerId,
      trigger,
      status: 'running',
      dryRun: opts.dryRun,
      filesScanned: plan.candidates.length,
      triggeredBy: opts.triggeredBy,
    },
  });

  if (opts.dryRun) {
    await prisma.cleanupRun.update({
      where: { id: run.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    return { runId: run.id, plan, filesDeleted: 0, bytesFreed: 0, errors: [] };
  }

  try {
    const result = await executeCleanup(plan);
    await prisma.cleanupRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        filesDeleted: result.filesDeleted,
        bytesFreed: result.bytesFreed,
        completedAt: new Date(),
        errorMessage: result.errors.length ? result.errors.slice(0, 20).join('; ') : null,
      },
    });
    logger.info({ providerId, trigger, filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed }, 'Cleanup run completed');
    return { runId: run.id, plan, filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed, errors: result.errors };
  } catch (err: any) {
    await prisma.cleanupRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    });
    throw err;
  }
}
