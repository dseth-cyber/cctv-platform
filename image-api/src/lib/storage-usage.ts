import { getPrisma } from './prisma.js';
import { getAllConfigs } from '../modules/system-config/system-config.service.js';

// Single source of truth for "how much storage is used / how much is there" across every
// card and every automated decision in the app (Overview, Executive). Always derived from each active storage provider's own latest
// self-reported metric (collected every 15 min from the real backend — SeaweedFS's own
// /status, S3 bucket listing, etc.), never from summing image_files.file_size_bytes in
// Postgres. A raw Postgres sum can silently overcount: a delete that removes the object
// from storage but fails/times out before removing the DB row leaves a phantom byte count
// that no card and no auto-cleanup trigger agrees on. Two different pages independently
// re-implementing this exact mistake (and disagreeing with each other, and with the real
// auto-cleanup trigger) is what caused incident_2026-08-06 — do not add a third.
export async function getProviderBackedStorageUsage(): Promise<{
  usedBytes: number;
  capacityBytes: number;
  hasMetrics: boolean;
}> {
  const prisma = getPrisma();
  const providers = await prisma.storageProvider.findMany({ where: { isActive: true, deletedAt: null } });

  const metrics = await Promise.all(
    providers.map((p) =>
      prisma.storageProviderMetric.findFirst({
        where: { providerId: p.id },
        orderBy: { collectedAt: 'desc' },
        select: { usedBytes: true, totalBytes: true, objectCount: true },
      }),
    ),
  );

  let usedBytes = 0;
  let capacityBytes = 0;
  let hasMetrics = false;
  providers.forEach((p, i) => {
    const metric = metrics[i];
    if (!metric) return;
    // Skip providers that have never actually stored anything (seeded "Example"
    // providers left isActive=true are the usual case) — including their auto-detected
    // disk capacity in the combined total dilutes the percentage and can hide a
    // specific provider (e.g. the real SeaweedFS one) being genuinely near-full.
    if (Number(metric.objectCount) === 0) return;
    hasMetrics = true;
    usedBytes += Number(metric.usedBytes);
    capacityBytes += p.capacityBytes ? Number(p.capacityBytes) : Number(metric.totalBytes);
  });

  return { usedBytes, capacityBytes, hasMetrics };
}

// Fallback used only when no provider has reported a metric yet (e.g. moments after a
// fresh deploy, before the first 15-minute collector tick) — better than showing 0.
export async function getFallbackCapacityBytes(): Promise<number> {
  const configs = await getAllConfigs();
  return (Number(configs.max_storage_gb?.value ?? 1000)) * 1024 * 1024 * 1024;
}
