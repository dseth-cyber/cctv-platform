import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { logger } from '../../lib/logger.js';
import { cleanupOperationalLogs } from './system-cleanup.service.js';

let cronTask: ScheduledTask | null = null;

export function startSystemCleanup(): void {
  if (cronTask) return;

  // Daily at 04:00 — after the retention sweeper (02:00) and backup (03:00), same
  // "quiet hours" slot.
  cronTask = cron.schedule('0 4 * * *', async () => {
    logger.info('Operational log cleanup starting...');
    const result = await cleanupOperationalLogs();
    logger.info({ result }, 'Operational log cleanup finished');
  });

  logger.info('Operational log cleanup scheduled (daily at 04:00)');
}

export function stopSystemCleanup(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Operational log cleanup stopped');
  }
}
