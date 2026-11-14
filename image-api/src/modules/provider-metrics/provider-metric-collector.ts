import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { getPrisma } from '../../lib/prisma.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import type { StorageProvider } from '../../lib/storage/types.js';
import { logger } from '../../lib/logger.js';
import { createAlert, dispatchAlertNotifications } from '../alerts/alerts.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { NotFoundError } from '../../lib/errors.js';

let cronTask: ScheduledTask | null = null;

interface OneProviderMetricResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  detectedTotalBytes: number;
  detectedFreeBytes: number;
  usedBytes: number;
  objectCount: number;
}

async function collectOneProviderMetric(p: StorageProvider): Promise<OneProviderMetricResult> {
  const prisma = getPrisma();
  const start = Date.now();
  try {
    const health = await p.health();
    const stats = await p.stats();
    const latencyMs = Date.now() - start;

    // A manually-set capacity is the admin's explicit choice of ceiling (e.g. to
    // reserve headroom for other things sharing the same disk) and always wins
    // over whatever the provider can self-report. Only fall back to the
    // provider's own detected total (SeaweedFS's real volume-server disk stats,
    // local disk's statfs, etc.) when no manual cap has been set.
    let totalBytes = stats.totalBytes;
    let freeBytes = stats.freeBytes;
    const dbRecord = await prisma.storageProvider.findUnique({ where: { id: p.id }, select: { capacityBytes: true } });
    if (dbRecord?.capacityBytes) {
      totalBytes = Number(dbRecord.capacityBytes);
      freeBytes = Math.max(0, totalBytes - stats.usedBytes);
    }

    await prisma.storageProviderMetric.create({
      data: {
        providerId: p.id,
        status: health.ok ? 'healthy' : 'unhealthy',
        latencyMs,
        objectCount: stats.objectCount,
        usedBytes: stats.usedBytes,
        totalBytes,
        freeBytes,
        errorMessage: health.error,
      },
    });

    if (totalBytes > 0) {
      const usagePct = (stats.usedBytes / totalBytes) * 100;
      await checkStorageAlert(p.id, p.name, usagePct, stats.usedBytes, totalBytes);
    }

    return {
      provider: p.name,
      ok: health.ok,
      latencyMs,
      detectedTotalBytes: stats.totalBytes,
      detectedFreeBytes: stats.freeBytes,
      usedBytes: stats.usedBytes,
      objectCount: stats.objectCount,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    await prisma.storageProviderMetric.create({
      data: {
        providerId: p.id,
        status: 'error',
        latencyMs,
        errorMessage: err.message,
      },
    });
    return { provider: p.name, ok: false, latencyMs, detectedTotalBytes: 0, detectedFreeBytes: 0, usedBytes: 0, objectCount: 0 };
  }
}

// On-demand refresh for a single provider — used by the "detect real capacity"
// button in the UI so the admin isn't stuck waiting for the 15-minute cron.
export async function refreshProviderMetric(providerId: string): Promise<OneProviderMetricResult> {
  const provider = storageRouter.getAll().find((p) => p.id === providerId);
  if (!provider) throw new NotFoundError('StorageProvider', providerId);
  return collectOneProviderMetric(provider);
}

export async function collectMetrics(): Promise<{ provider: string; ok: boolean; latencyMs: number }[]> {
  // Turned-off providers (e.g. the old bundled MinIO, SeaweedFS without its profile) would only time out.
  const providers = storageRouter.getActive();
  const results: { provider: string; ok: boolean; latencyMs: number }[] = [];

  for (const p of providers) {
    const r = await collectOneProviderMetric(p);
    results.push({ provider: r.provider, ok: r.ok, latencyMs: r.latencyMs });
  }

  return results;
}

export function startMetricCollector(): void {
  if (cronTask) return;

  cronTask = cron.schedule('*/15 * * * *', async () => {
    logger.info('Provider metric collector starting...');
    const results = await collectMetrics();
    logger.info({ results }, 'Provider metric collector finished');
  });

  logger.info('Provider metric collector scheduled (every 15 minutes)');

  setTimeout(() => {
    collectMetrics().then((results) => {
      logger.info({ results }, 'Initial metric collection done');
    }).catch((err) => {
      logger.error({ err }, 'Initial metric collection failed');
    });
  }, 5000);
}

/**
 * One open alert per provider, kept current — not one row per check.
 *
 * This used to insert a fresh row whenever the newest unresolved alert was older than a
 * hardcoded 60 minutes, which meant a disk sitting untouched at 78.5% produced a new
 * identical row every hour, forever (reported 2026-08-22: 11 rows saying exactly the same
 * thing). Stretching that window would only slow the accumulation down — the real point is
 * that nothing had changed, so there was nothing new to record.
 *
 * Now the open alert is updated in place with the current percentage, so the list holds
 * one row per ongoing problem and that row is always accurate. Notifications are dispatched
 * on every check regardless, because the rule's own cooldown is what decides how often
 * anyone actually hears about it (see notifications/index.ts) — that setting is the one
 * users can see and change, so it should be the one in charge.
 */
async function checkStorageAlert(providerId: string, providerName: string, usagePct: number, usedBytes: number, totalBytes: number) {
  try {
    const configs = await getAllConfigs();
    const criticalThreshold = Number(configs.alert_critical_threshold?.value ?? 90);
    const warningThreshold = Number(configs.alert_warning_threshold?.value ?? 75);

    const prisma = getPrisma();
    const openAlert = await prisma.alert.findFirst({
      where: {
        alertType: { in: ['storage_warning', 'disk_space'] },
        source: providerId,
        resolvedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    const fmtBytes = (b: number) => `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;

    const level = usagePct >= criticalThreshold ? 'critical' : usagePct >= warningThreshold ? 'warning' : null;

    // Back under the warning threshold: close the open alert so a future rise starts a
    // fresh one. Without this the alert would stay open forever and suppress the next.
    if (level === null) {
      if (openAlert) {
        await prisma.alert.update({
          where: { id: openAlert.id },
          data: {
            resolvedAt: new Date(),
            resolvedBy: 'system',
            details: {
              ...((openAlert.details as any) ?? {}),
              resolvedReason: 'Usage back below the warning threshold',
              resolvedAtPercent: usagePct,
            },
          },
        });
        logger.info({ providerName, usagePct }, 'Storage alert resolved — usage back below threshold');
      }
      return;
    }

    const alertType = level === 'critical' ? 'disk_space' : 'storage_warning';
    const threshold = level === 'critical' ? criticalThreshold : warningThreshold;
    const title = `Storage ${level}: ${providerName} (${usagePct.toFixed(1)}%)`;
    const message = `${providerName} usage ${fmtBytes(usedBytes)} / ${fmtBytes(totalBytes)} (${usagePct.toFixed(1)}%) exceeds ${level} threshold ${threshold}%`;
    const details = { providerId, providerName, usagePct, usedBytes, totalBytes };

    // Crossing between warning and critical is a genuinely different problem with its own
    // rule and severity, so that closes the old row and opens a new one rather than
    // quietly rewriting the first.
    if (openAlert && openAlert.alertType !== alertType) {
      await prisma.alert.update({
        where: { id: openAlert.id },
        data: {
          resolvedAt: new Date(),
          resolvedBy: 'system',
          details: { ...((openAlert.details as any) ?? {}), resolvedReason: `Superseded by ${alertType}` },
        },
      });
      await createAlert({ alertType, severity: level, source: providerId, title, message, details, skipDedup: true });
      logger.warn({ providerName, usagePct, from: openAlert.alertType, to: alertType }, 'Storage alert level changed');
      return;
    }

    if (openAlert) {
      await prisma.alert.update({
        where: { id: openAlert.id },
        data: { title, message, details, severity: level },
      });
      await dispatchAlertNotifications({ alertType, severity: level, source: providerId, title, message });
      return;
    }

    await createAlert({ alertType, severity: level, source: providerId, title, message, details });
    logger.warn({ providerName, usagePct, level }, 'Storage alert created');
  } catch (err) {
    logger.error({ err, providerName }, 'Failed to check storage alert');
  }
}

export function stopMetricCollector(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Provider metric collector stopped');
  }
}
