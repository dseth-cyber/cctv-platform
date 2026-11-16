import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { logger } from '../../lib/logger.js';
import { runDatabaseBackup } from './backup.service.js';
import { backupTimeZone, getBackupSettings, localClock } from './backup-settings.js';

let cronTask: ScheduledTask | null = null;
let lastRunDay: string | null = null;
let running = false;

/**
 * Once a minute: when the local time (APP_TIME_ZONE) reaches the time set on the backup page and today's backup
 * has not run, run it. Settings are read each time, so a change on the page applies from the next minute.
 */
export async function backupTick(now = new Date()): Promise<boolean> {
  if (running) return false;
  const settings = await getBackupSettings();
  if (!settings.enabled) return false;
  const { hhmm, day } = localClock(now, backupTimeZone());
  if (hhmm !== settings.time || lastRunDay === day) return false;
  lastRunDay = day;
  running = true;
  try {
    logger.info({ destination: settings.destination }, 'Scheduled database backup starting');
    const result = await runDatabaseBackup({ trigger: 'schedule' });
    logger.info({ status: result.status }, 'Scheduled database backup finished');
    return true;
  } finally {
    running = false;
  }
}

/** For tests. */
export function resetBackupTick() {
  lastRunDay = null;
  running = false;
}

export function startBackupScheduler(): void {
  if (cronTask) return;
  cronTask = cron.schedule('* * * * *', () => {
    backupTick().catch((err) => logger.error({ err }, 'Scheduled database backup check failed'));
  });
  logger.info({ timeZone: backupTimeZone() }, 'Backup scheduler started (time, keep days and destination come from the backup page)');
}

export function stopBackupScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Backup scheduler stopped');
  }
}
