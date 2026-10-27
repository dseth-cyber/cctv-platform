import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../lib/redis.js';

// Orphan sweeper — repairs images stuck in 'processing'/'queued' whose job has
// vanished from every Redis queue. This happens when the worker (or the API it
// reports to) restarts mid-job: the image status was set to 'processing', but the
// failure/completion report never landed, so nothing ever moves it again. Such
// images previously stayed "กำลังประมวลผล" forever with no trace in any queue.
//
// The sweep flips them to 'failed' with a clear reason and logs a ProcessingJob
// row, so they surface in the Dead Letter queue where a human can retry them.

const QUEUE_WAIT = 'bull:image-processing:wait';
const QUEUE_ACTIVE = 'bull:image-processing:active';
// Only touch images at least this old — a brand-new ingest may legitimately not
// have its queue entry visible yet for a moment.
const MIN_AGE_MS = 10 * 60 * 1000;

let cronTask: ScheduledTask | null = null;

/** Image ids currently referenced by any wait/active queue entry. */
async function imageIdsInQueues(): Promise<Set<string>> {
  const redis = getRedisClient();
  const [waitIds, activeIds] = await Promise.all([
    redis.lrange(QUEUE_WAIT, 0, -1),
    redis.lrange(QUEUE_ACTIVE, 0, -1),
  ]);
  const ids = new Set<string>();
  for (const jobId of [...waitIds, ...activeIds]) {
    try {
      const data = await redis.hget(`bull:image-processing:${jobId}`, 'data');
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (parsed?.imageId) ids.add(String(parsed.imageId));
    } catch {
      // Unparseable queue entry — ignore; the worker logs those itself.
    }
  }
  return ids;
}

export async function sweepOrphanedImages(): Promise<{ repaired: number }> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - MIN_AGE_MS);

  const stuck = await prisma.image.findMany({
    where: {
      status: { in: ['processing', 'queued'] },
      createdAt: { lt: cutoff },
    },
    select: { id: true, originalFilename: true, createdAt: true },
    take: 500,
  });
  if (stuck.length === 0) return { repaired: 0 };

  const live = await imageIdsInQueues();
  const orphans = stuck.filter((img) => !live.has(img.id));
  if (orphans.length === 0) return { repaired: 0 };

  const reason =
    'Orphaned: processing job lost (worker/API restart mid-job) — repaired by orphan sweeper';
  let repaired = 0;
  for (const img of orphans) {
    try {
      await prisma.image.update({ where: { id: img.id }, data: { status: 'failed' } });
      await prisma.processingJob.create({
        data: {
          imageId: img.id,
          jobType: 'convert',
          workerId: 'orphan-sweeper',
          status: 'failed',
          queuedAt: img.createdAt,
          startedAt: img.createdAt,
          completedAt: new Date(),
          priority: 0,
          retryCount: 0,
          maxRetries: 3,
          queueName: 'bull:image-processing',
          errorMessage: reason,
        },
      });
      repaired++;
      logger.warn({ imageId: img.id, filename: img.originalFilename }, 'Orphaned image repaired -> failed (visible in DLQ)');
    } catch (err) {
      logger.error({ imageId: img.id, err }, 'Orphan sweep: failed to repair image');
    }
  }
  return { repaired };
}

export function startOrphanSweeper(): void {
  if (cronTask) return;

  // Every 10 minutes, plus one pass shortly after boot (a restart is exactly when
  // orphans are created).
  cronTask = cron.schedule('*/10 * * * *', async () => {
    try {
      const { repaired } = await sweepOrphanedImages();
      if (repaired > 0) logger.warn({ repaired }, 'Orphan sweeper repaired stuck images');
    } catch (err) {
      logger.error({ err }, 'Orphan sweeper failed');
    }
  });

  setTimeout(() => {
    sweepOrphanedImages()
      .then(({ repaired }) => {
        if (repaired > 0) logger.warn({ repaired }, 'Orphan sweeper (startup pass) repaired stuck images');
      })
      .catch((err) => logger.error({ err }, 'Orphan sweeper startup pass failed'));
  }, 30_000);

  logger.info('Orphan sweeper scheduled (every 10 min + startup pass)');
}

export function stopOrphanSweeper(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Orphan sweeper stopped');
  }
}
