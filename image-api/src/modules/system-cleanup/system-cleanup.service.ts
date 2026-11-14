import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { deleteExpiredClips, purgeTrashedClips } from '../recordings/clip-cancel.js';

// Auto-cleanup for the three operational/audit tables that have no built-in retention of
// their own (unlike images, which go through RetentionPolicy) — Processing Logs, Audit
// Log, and Alerts. Each is independently configurable from System Settings; a value of 0
// (or missing) means "keep forever" for that table specifically. Added 2026-08-07 after
// camera_events/audit_logs both grew to hundreds of thousands of rows within days under
// real ingest volume (see HANDOFF incident) — these three are the next tables in line to
// do the same without a retention mechanism.
export async function cleanupOperationalLogs(): Promise<{
  auditLogs: number;
  alerts: number;
  clips: number;
}> {
  const prisma = getPrisma();
  const configs = await getAllConfigs();

  const auditDays = Number(configs.audit_logs_retention_days?.value ?? 0);
  const alertsDays = Number(configs.alerts_retention_days?.value ?? 0);
  const clipsDays = Number(configs.clips_retention_days?.value ?? 0);

  let auditLogs = 0;
  let alerts = 0;

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

  // Evidence clips: expired ones go to the trash, and the trash is purged after its grace period (Legal Hold stays).
  let clips = 0;
  try {
    const expired = await deleteExpiredClips(clipsDays);
    const purged = await purgeTrashedClips();
    clips = expired.deleted;
    if (expired.errors + purged.errors > 0) logger.warn({ expiredErrors: expired.errors, purgeErrors: purged.errors }, 'Some clips could not be moved to the trash or purged');
    if (purged.purged > 0) logger.info({ purged: purged.purged }, 'Clips purged from the trash');
  } catch (err) {
    logger.error({ err }, 'Clip cleanup failed');
  }

  if (auditLogs > 0 || alerts > 0 || clips > 0) {
    logger.info({ auditLogs, alerts, clips }, 'Operational log cleanup completed');
  }

  return { auditLogs, alerts, clips };
}
