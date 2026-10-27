import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getAllConfigs } from '../system-config/system-config.service.js';

// Auto-cleanup for the three operational/audit tables that have no built-in retention of
// their own (unlike images, which go through RetentionPolicy) — Processing Logs, Audit
// Log, and Alerts. Each is independently configurable from System Settings; a value of 0
// (or missing) means "keep forever" for that table specifically. Added 2026-08-07 after
// camera_events/audit_logs both grew to hundreds of thousands of rows within days under
// real ingest volume (see HANDOFF incident) — these three are the next tables in line to
// do the same without a retention mechanism.
export async function cleanupOperationalLogs(): Promise<{
  processingJobs: number;
  auditLogs: number;
  alerts: number;
}> {
  const prisma = getPrisma();
  const configs = await getAllConfigs();

  const processingDays = Number(configs.processing_logs_retention_days?.value ?? 0);
  const auditDays = Number(configs.audit_logs_retention_days?.value ?? 0);
  const alertsDays = Number(configs.alerts_retention_days?.value ?? 0);

  let processingJobs = 0;
  let auditLogs = 0;
  let alerts = 0;

  try {
    if (processingDays > 0) {
      const cutoff = new Date(Date.now() - processingDays * 86400000);
      // Only terminal-state jobs — never touch anything still queued/active regardless
      // of age. completedAt is null for jobs that never finished (e.g. old failures from
      // before that field was populated); fall back to queuedAt for those.
      const result = await prisma.processingJob.deleteMany({
        where: {
          status: { in: ['completed', 'failed', 'dead_letter'] },
          OR: [
            { completedAt: { lt: cutoff } },
            { completedAt: null, queuedAt: { lt: cutoff } },
          ],
        },
      });
      processingJobs = result.count;
    }
  } catch (err) {
    logger.error({ err }, 'Processing job cleanup failed');
  }

  try {
    if (auditDays > 0) {
      const cutoff = new Date(Date.now() - auditDays * 86400000);
      const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      auditLogs = result.count;
    }
  } catch (err) {
    logger.error({ err }, 'Audit log cleanup failed');
  }

  try {
    if (alertsDays > 0) {
      const cutoff = new Date(Date.now() - alertsDays * 86400000);
      // Only ever delete resolved alerts — an old *unresolved* alert is still something
      // nobody has dealt with yet and must stay visible regardless of age.
      const result = await prisma.alert.deleteMany({
        where: { createdAt: { lt: cutoff }, resolvedAt: { not: null } },
      });
      alerts = result.count;
    }
  } catch (err) {
    logger.error({ err }, 'Alert cleanup failed');
  }

  if (processingJobs > 0 || auditLogs > 0 || alerts > 0) {
    logger.info({ processingJobs, auditLogs, alerts }, 'Operational log cleanup completed');
  }

  return { processingJobs, auditLogs, alerts };
}
