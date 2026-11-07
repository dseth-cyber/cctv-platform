import type { FastifyInstance } from 'fastify';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { requirePermission } from '../../middleware/rbac.js';
import { sweepExpiredRecordings, purgeQuarantinedRecordings, checkDiskHighWatermarkAndEvict } from './retention-sweeper.service.js';

let cronTask: ScheduledTask | null = null;
let diskTask: ScheduledTask | null = null;

export function startRetentionSweeper(): void {
  if (cronTask) return;

  // Hourly: expired recordings to quarantine, then quarantine past its purge period deleted.
  cronTask = cron.schedule('0 * * * *', async () => {
    try {
      const recResult = await sweepExpiredRecordings();
      const purgeResult = await purgeQuarantinedRecordings();
      logger.info({ recResult, purgeResult }, 'Recording retention sweep finished');
    } catch (err) {
      logger.error({ err }, 'Recording retention sweep failed');
    }
  });
  // Every 10 minutes: continuous recording can fill a disk well within an hour.
  diskTask = cron.schedule('*/10 * * * *', async () => {
    try {
      await checkDiskHighWatermarkAndEvict();
    } catch (err) {
      logger.error({ err }, 'Recording disk watermark check failed');
    }
  });

  logger.info('Recording retention scheduled (sweep + purge hourly, disk check every 10 minutes)');
}


export function stopRetentionSweeper(): void {
  diskTask?.stop();
  diskTask = null;
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Retention sweeper stopped');
  }
}

export async function retentionSweeperRoutes(app: FastifyInstance): Promise<void> {
  // Manual trigger endpoint
  app.post('/trigger', { preHandler: [app.authenticate, requirePermission('retention:delete')] }, async (_req, reply) => {
    const result = { sweep: await sweepExpiredRecordings(), purge: await purgeQuarantinedRecordings() };
    return reply.send(result);
  });
}
