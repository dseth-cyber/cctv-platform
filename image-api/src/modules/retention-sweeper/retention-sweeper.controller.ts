import type { FastifyInstance } from 'fastify';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { sweepExpiredImages } from './retention-sweeper.service.js';

let cronTask: ScheduledTask | null = null;

export function startRetentionSweeper(): void {
  if (cronTask) return;

  // Hourly, not daily: at realistic ingest volume, a once-a-day run with any bounded
  // batch size falls permanently behind (see incident 2026-08-06 — a day-old backlog of
  // 23k+ expired-but-undeleted raw files had piled up under the old daily/100-per-run
  // schedule). Hourly + a large batch (see SWEEP_BATCH_SIZE) keeps the backlog near zero.
  cronTask = cron.schedule('0 * * * *', async () => {
    logger.info('Retention sweeper starting...');
    const result = await sweepExpiredImages();
    logger.info({ result }, 'Retention sweeper finished');
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
    const result = await sweepExpiredImages();
    return reply.send(result);
  });
}
