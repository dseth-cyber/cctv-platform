import type { FastifyInstance } from 'fastify';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { sweepExpiredRecordings, checkDiskHighWatermarkAndEvict } from './retention-sweeper.service.js';

let cronTask: ScheduledTask | null = null;

export function startRetentionSweeper(): void {
  if (cronTask) return;

  // Hourly, not daily: at realistic ingest volume, a once-a-day run with any bounded
  // batch size falls permanently behind. Also checks disk high-watermark every hour [ENH-03].
  cronTask = cron.schedule('0 * * * *', async () => {
    logger.info('Retention sweeper starting...');
    const recResult = await sweepExpiredRecordings();
    const watermarkResult = await checkDiskHighWatermarkAndEvict();
    logger.info({ recResult, watermarkResult }, 'Retention sweeper and disk monitor finished');
  });

  logger.info('Retention sweeper scheduled (hourly)');
}


export function stopRetentionSweeper(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Retention sweeper stopped');
  }
}

export async function retentionSweeperRoutes(app: FastifyInstance): Promise<void> {
  // Manual trigger endpoint (admin only)
  app.post('/trigger', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const result = await sweepExpiredRecordings();
    return reply.send(result);
  });
}
