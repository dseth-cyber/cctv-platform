import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';
import {
  computeRawState, debounceState, writePressureState, isMoreSevere,
  type PressureState,
} from './storage-pressure.service.js';
import { runCleanup } from './cleanup-executor.service.js';

const DEBOUNCE_TICKS = 2;

function fmtBytes(b: number): string {
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function handleStateEntry(providerId: string, providerName: string, state: PressureState, usagePercent: number, usedBytes: number, totalBytes: number) {
  const detail = `${providerName} usage ${fmtBytes(usedBytes)} / ${fmtBytes(totalBytes)} (${usagePercent.toFixed(1)}%)`;

  if (state === 'warning') {
    await createAlert({
      alertType: 'storage_warning', severity: 'warning', source: providerId,
      title: `Storage warning: ${providerName} (${usagePercent.toFixed(1)}%)`,
      message: detail,
      details: { providerId, providerName, usagePercent, state },
    });
  } else if (state === 'critical' || state === 'emergency') {
    await createAlert({
      alertType: 'disk_space', severity: state === 'emergency' ? 'emergency' : 'critical', source: providerId,
      title: `Storage ${state}: ${providerName} (${usagePercent.toFixed(1)}%)`,
      message: detail,
      details: { providerId, providerName, usagePercent, state },
    });
  }

  // Entering (or still in) pressure/critical/emergency triggers an automatic cleanup pass.
  // The Planner itself only picks up cameras whose policy opted into watermark/circular
  // cleanup, so this is a safe no-op for providers with no such cameras.
  if (state === 'pressure' || state === 'critical' || state === 'emergency') {
    try {
      const result = await runCleanup(providerId, 'auto', { triggeredBy: 'system', dryRun: false });
      if (result.filesDeleted > 0) {
        await createAlert({
          alertType: 'storage_cleanup', severity: 'info', source: providerId,
          title: `Storage cleanup: ${providerName}`,
          message: `Auto-cleanup freed ${fmtBytes(result.bytesFreed)} (${result.filesDeleted} files) for ${providerName}.`,
          details: { providerId, providerName, filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed },
        });
        logger.info({ providerName, filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed }, 'Auto-cleanup completed');
      }
    } catch (err) {
      logger.error({ err, providerName }, 'Auto-cleanup failed');
    }
  }
}

export async function checkStoragePressure(): Promise<void> {
  const prisma = getPrisma();
  const providers = await prisma.storageProvider.findMany({ where: { isActive: true, deletedAt: null } });

  for (const provider of providers) {
    const latestMetric = await prisma.storageProviderMetric.findFirst({
      where: { providerId: provider.id },
      orderBy: { collectedAt: 'desc' },
    });
    if (!latestMetric) continue;

    const usedBytes = Number(latestMetric.usedBytes);
    const totalBytes = Number(latestMetric.totalBytes) || Number(provider.capacityBytes ?? 0);
    if (totalBytes <= 0) continue;
    const usagePercent = (usedBytes / totalBytes) * 100;

    const confirmedState = provider.currentPressureState as PressureState;
    const rawState = computeRawState(usagePercent, provider, confirmedState);

    const nextState = await debounceState(provider.id, rawState, confirmedState, DEBOUNCE_TICKS);

    // Always refresh the hot-path cache so Sync Worker/Processing Worker reads stay fresh,
    // even on ticks where nothing changed.
    await writePressureState(provider.id, nextState, usagePercent);

    if (nextState !== confirmedState) {
      await prisma.storageProvider.update({
        where: { id: provider.id },
        data: { currentPressureState: nextState as any, currentPressureSince: new Date() },
      });
      logger.info({ provider: provider.name, from: confirmedState, to: nextState, usagePercent }, 'Storage pressure state changed');

      if (isMoreSevere(nextState, confirmedState) || nextState === 'pressure') {
        await handleStateEntry(provider.id, provider.name, nextState, usagePercent, usedBytes, totalBytes);
      }
    } else if (nextState === 'pressure' || nextState === 'critical' || nextState === 'emergency') {
      // Stayed in an active cleanup state — keep trying to reclaim space each tick.
      await handleStateEntry(provider.id, provider.name, nextState, usagePercent, usedBytes, totalBytes);
    }
  }
}
