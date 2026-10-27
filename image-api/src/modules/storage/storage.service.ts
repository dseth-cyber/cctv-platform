import { getPrisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../lib/redis.js';
import { getProviderBackedStorageUsage, getFallbackCapacityBytes } from '../../lib/storage-usage.js';
import type { StorageSummary } from '../../types/index.js';

export async function getStorageSummary(): Promise<StorageSummary> {
  const redis = getRedisClient();
  const cacheKey = 'cache:storage:summary';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore redis error */ }

  const prisma = getPrisma();

  const [fileStats, latestSnapshot, usage] = await Promise.all([
    prisma.imageFile.groupBy({
      by: ['fileType'],
      _sum: { fileSizeBytes: true },
      _count: { id: true },
    }),
    prisma.storageSnapshot.findFirst({
      where: { cameraId: null },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    }),
    getProviderBackedStorageUsage(),
  ]);

  const byFileType: Record<string, { files: number; bytes: number }> = {};
  for (const stat of fileStats) {
    byFileType[stat.fileType] = {
      files: stat._count.id,
      bytes: Number(stat._sum.fileSizeBytes ?? 0n),
    };
  }

  const totalFiles = Object.values(byFileType).reduce((s, v) => s + v.files, 0);

  const cameraData = await prisma.camera.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { images: true } },
    },
  });

  const byCamera = cameraData.map((c) => ({
    cameraId: c.id,
    cameraName: c.name,
    files: c._count.images,
    bytes: 0,
  }));

  // totalBytes/totalCapacity intentionally come from the storage providers' own
  // self-reported metrics (same source the "Storage Providers" list and the actual
  // auto-cleanup pressure trigger use — see storage-pressure-monitor.ts), not from
  // summing image_files.file_size_bytes in Postgres. The two can legitimately drift:
  // a DB row survives if a delete operation removes the object from storage but fails
  // (or times out) before removing the row, so a raw Postgres sum silently overcounts —
  // this is exactly what made this card disagree with "Storage Providers" and made the
  // real usage look lower than 90% (no auto-cleanup) while this card showed >90%. See
  // incident_2026-08-06.
  const totalBytes = usage.hasMetrics
    ? usage.usedBytes
    : Object.values(byFileType).reduce((s, v) => s + v.bytes, 0);
  const totalCapacity = usage.hasMetrics
    ? usage.capacityBytes
    : await getFallbackCapacityBytes();

  const res: StorageSummary = {
    totalFiles,
    totalBytes,
    totalCapacity,
    byFileType,
    byCamera,
    snapshotDate: latestSnapshot?.snapshotDate.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  };

  try {
    await redis.setex(cacheKey, 30, JSON.stringify(res));
  } catch { /* ignore */ }

  return res;
}

export async function getCameraStorage(cameraId: string) {
  const prisma = getPrisma();

  const fileStats = await prisma.imageFile.groupBy({
    by: ['fileType', 'storageClass'],
    where: { image: { cameraId } },
    _sum: { fileSizeBytes: true },
    _count: { id: true },
  });

  const snapshots = await prisma.storageSnapshot.findMany({
    where: { cameraId },
    orderBy: { snapshotDate: 'desc' },
    take: 30,
  });

  return {
    cameraId,
    fileStats,
    recentSnapshots: snapshots,
  };
}

export async function getStorageGrowth(days: number) {
  const redis = getRedisClient();
  const cacheKey = `cache:storage:growth:${days}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore redis error */ }

  const prisma = getPrisma();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const dailyStats = await prisma.$queryRaw<Array<{
    date: Date;
    images_added: bigint;
    bytes_added: bigint;
  }>>`
    SELECT
      DATE(i.captured_at) as date,
      COUNT(DISTINCT i.id)::bigint as images_added,
      COALESCE(SUM(f.file_size_bytes), 0)::bigint as bytes_added
    FROM images i
    LEFT JOIN image_files f ON f.image_id = i.id
    WHERE i.captured_at >= ${startDate}
      AND i.deleted_at IS NULL
    GROUP BY DATE(i.captured_at)
    ORDER BY date ASC
  `;

  const res = {
    period: `${days}d`,
    data: dailyStats.map((row) => ({
      date: row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10),
      imagesAdded: Number(row.images_added),
      bytesAdded: Number(row.bytes_added),
    })),
  };

  try {
    await redis.setex(cacheKey, 30, JSON.stringify(res));
  } catch { /* ignore */ }

  return res;
}

export async function getStorageForecast(): Promise<{
  totalBytes: number;
  maxBytes: number;
  usagePercent: number;
  dailyGrowthRate: number;
  daysUntilFull: number | null;
  retentionCapacityDays: number | null;
  projections: { days: number; projectedBytes: number; usagePercent: number }[];
}> {
  const redis = getRedisClient();
  const cacheKey = 'cache:storage:forecast';
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore redis error */ }

  const [summary, growth90, oldestImage] = await Promise.all([
    getStorageSummary(),
    getStorageGrowth(90),
    getPrisma().image.findFirst({
      where: { deletedAt: null },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    }),
  ]);

  // Reuse summary.totalCapacity (provider-metric-backed, see getStorageSummary above)
  // instead of re-deriving from max_storage_gb here — a second independent source for
  // "what's the cap" is exactly the kind of duplication that caused incident_2026-08-06.
  const maxBytes = summary.totalCapacity;
  const totalBytes = summary.totalBytes;
  const usagePercent = maxBytes > 0 ? (totalBytes / maxBytes) * 100 : 0;

  const growthData = growth90.data;
  let dailyGrowthRate = 0;

  if (growthData.length >= 7) {
    const n = growthData.length;
    const sumY = growthData.reduce((s: number, d: { bytesAdded: number }) => s + d.bytesAdded, 0);
    dailyGrowthRate = Math.max(0, sumY / n);
  } else if (oldestImage?.capturedAt && totalBytes > 0) {
    const ageDays = Math.max(1, (Date.now() - oldestImage.capturedAt.getTime()) / (1000 * 60 * 60 * 24));
    dailyGrowthRate = Math.max(0, totalBytes / ageDays);
  }

  const daysUntilFull = dailyGrowthRate > 0
    ? Math.ceil((maxBytes - totalBytes) / dailyGrowthRate)
    : null;

  // Total history window the configured capacity can hold at the current daily
  // ingest rate: how many days back of images the system can retain end-to-end
  // (capacity ÷ per-day growth). Lets executives read "we can keep ~X years of
  // images" without doing the arithmetic themselves.
  const retentionCapacityDays = dailyGrowthRate > 0
    ? Math.floor(maxBytes / dailyGrowthRate)
    : null;

  const projections = [7, 14, 30, 60, 90, 120, 240, 360].map((days) => {
    const projectedBytes = totalBytes + dailyGrowthRate * days;
    return {
      days,
      projectedBytes: Math.round(projectedBytes),
      usagePercent: maxBytes > 0 ? Math.min(100, (projectedBytes / maxBytes) * 100) : 0,
    };
  });

  const res = {
    totalBytes,
    maxBytes,
    usagePercent,
    dailyGrowthRate: Math.round(dailyGrowthRate),
    daysUntilFull,
    retentionCapacityDays,
    projections,
  };

  try {
    await redis.setex(cacheKey, 30, JSON.stringify(res));
  } catch { /* ignore */ }

  return res;
}
