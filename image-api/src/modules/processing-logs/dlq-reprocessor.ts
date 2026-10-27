import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';

let cronTask: ScheduledTask | null = null;

export function startDlqReprocessor(): void {
  if (cronTask) return;

  // Hourly DLQ health log. This used to call bulkRetryDlq(), but that was a no-op
  // (it only flipped DB rows nobody consumes). Now that bulk retry REALLY
  // re-enqueues work, auto-retrying every hour would endlessly churn jobs whose
  // camera is unreachable and mask real failures — so retry stays a human action
  // (DLQ page buttons), and this cron just surfaces the queue size.
  cronTask = cron.schedule('0 * * * *', async () => {
    try {
      const prisma = getPrisma();
      const count = await prisma.processingJob.count({
        where: { status: { in: ['dead_letter', 'failed'] } },
      });
      if (count > 0) {
        logger.warn({ count }, 'DLQ has terminal-failed jobs awaiting review');
      }
    } catch (err) {
      logger.error({ err }, 'DLQ monitor failed');
    }
  });

  logger.info('DLQ monitor scheduled (every hour)');
}

export function stopDlqReprocessor(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('DLQ reprocessor stopped');
  }
}
