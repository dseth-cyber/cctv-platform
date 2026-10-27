import { Prisma } from '@prisma/client';
import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { getRedisClient } from '../../lib/redis.js';
import { getProviderBackedStorageUsage, getFallbackCapacityBytes } from '../../lib/storage-usage.js';
import { reprocessImage } from '../images/images.service.js';
import { logger } from '../../lib/logger.js';
import type { ProcessingLogSearchInput } from './processing-logs.schema.js';
import type { PaginatedResult } from '../../types/index.js';

function mapBigInt(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(mapBigInt);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, mapBigInt(v)]),
    );
  }
  return obj;
}

export async function searchProcessingLogs(params: ProcessingLogSearchInput): Promise<PaginatedResult<unknown>> {
  const prisma = getPrisma();
  const { page, limit, sort, order, ...filters } = params;

  const where: Prisma.ProcessingJobWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.jobType) where.jobType = filters.jobType;
  if (filters.q) {
    where.OR = [
      { image: { originalFilename: { contains: filters.q, mode: 'insensitive' } } },
      { imageId: filters.q },
      { errorMessage: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  const orderBy: Prisma.ProcessingJobOrderByWithRelationInput = {};
  if (sort === 'queuedAt') orderBy.queuedAt = order;
  else if (sort === 'startedAt') orderBy.startedAt = order;
  else if (sort === 'completedAt') orderBy.completedAt = order;
  else if (sort === 'jobType') orderBy.jobType = order;
  else if (sort === 'status') orderBy.status = order;
  else if (sort === 'workerId') orderBy.workerId = order;
  else if (sort === 'imageId') orderBy.imageId = order;
  else orderBy.queuedAt = 'desc';

  const countCacheKey = `cache:count:jobs:${JSON.stringify(filters)}`;
  let total: number | null = null;
  let rows: any[] = [];

  try {
    const redis = getRedisClient();
    const cached = await redis.get(countCacheKey);
    if (cached !== null) {
      total = parseInt(cached, 10);
    }
  } catch {
    // ignore redis error
  }

  if (total === null) {
    const [cnt, rowsResult] = await Promise.all([
      prisma.processingJob.count({ where }),
      prisma.processingJob.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          image: { select: { originalFilename: true } },
        },
      }),
    ]);
    total = cnt;
    rows = rowsResult;
    try {
      const redis = getRedisClient();
      await redis.set(countCacheKey, String(total), 'EX', 30);
    } catch {
      // ignore redis error
    }
  } else {
    rows = await prisma.processingJob.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        image: { select: { originalFilename: true } },
      },
    });
  }

  const data = rows.map((row) => {
    const r = mapBigInt(row) as Record<string, unknown>;
    const raw = row as typeof row;
    const durationMs = raw.startedAt && raw.completedAt
      ? raw.completedAt.getTime() - raw.startedAt.getTime()
      : null;
    return {
      id: r.id,
      imageId: r.imageId,
      imageFilename: (r.image as { originalFilename: string } | null)?.originalFilename ?? null,
      jobType: r.jobType,
      workerId: r.workerId,
      status: r.status,
      priority: r.priority,
      queueName: r.queueName,
      errorMessage: r.errorMessage,
      errorDetails: r.errorDetails,
      retryCount: r.retryCount,
      maxRetries: r.maxRetries,
      queuedAt: raw.queuedAt.toISOString(),
      startedAt: raw.startedAt?.toISOString() ?? null,
      completedAt: raw.completedAt?.toISOString() ?? null,
      durationMs,
      duration: durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : null,
    };
  });

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

let lastTxCount = 0;
let lastTxTime = Date.now();

async function getPgMetrics(prisma: any) {
  try {
    const [activeConnRes, locksRes, deadlocksRes, txRes] = await Promise.all([
      prisma.$queryRawUnsafe("SELECT COUNT(*)::bigint as count FROM pg_stat_activity"),
      prisma.$queryRawUnsafe("SELECT COUNT(*)::bigint as count FROM pg_locks"),
      prisma.$queryRawUnsafe("SELECT COALESCE(SUM(deadlocks), 0)::bigint as deadlocks FROM pg_stat_database WHERE datname = current_database()"),
      prisma.$queryRawUnsafe("SELECT COALESCE(SUM(xact_commit + xact_rollback), 0)::bigint as tx FROM pg_stat_database WHERE datname = current_database()")
    ]) as [Array<{ count: bigint }>, Array<{ count: bigint }>, Array<{ deadlocks: bigint }>, Array<{ tx: bigint }>];

    const activeConnections = Number(activeConnRes[0]?.count ?? 0);
    const locks = Number(locksRes[0]?.count ?? 0);
    const deadlocks = Number(deadlocksRes[0]?.deadlocks ?? 0);
    const currentTx = Number(txRes[0]?.tx ?? 0);

    const now = Date.now();
    const elapsed = (now - lastTxTime) / 1000;
    let tps = 0;
    if (lastTxCount > 0 && elapsed > 0) {
      tps = Math.max(0, Math.round((currentTx - lastTxCount) / elapsed));
    }
    lastTxCount = currentTx;
    lastTxTime = now;

    return { tps, activeConnections, locks, deadlocks };
  } catch (err) {
    return { tps: 0, activeConnections: 0, locks: 0, deadlocks: 0 };
  }
}

async function getStorageMetrics(prisma: any) {
  try {
    const [totalStats, recentStats, recentRawStats] = await Promise.all([
      prisma.imageFile.aggregate({
        _count: { id: true },
        _sum: { fileSizeBytes: true }
      }),
      prisma.imageFile.aggregate({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 1000)
          }
        },
        _sum: { fileSizeBytes: true }
      }),
      prisma.imageFile.aggregate({
        where: {
          fileType: 'raw',
          createdAt: {
            gte: new Date(Date.now() - 30 * 1000)
          }
        },
        _sum: { fileSizeBytes: true }
      })
    ]);

    const objectCount = Number(totalStats._count.id ?? 0);
    const bucketSize = Number(totalStats._sum.fileSizeBytes ?? 0n);

    const recentBytes = Number(recentStats._sum.fileSizeBytes ?? 0n);
    const writeMbPerSec = Number((recentBytes / (1024 * 1024) / 30).toFixed(2));

    const recentRawBytes = Number(recentRawStats._sum.fileSizeBytes ?? 0n);
    const readMbPerSec = Number((recentRawBytes / (1024 * 1024) / 30).toFixed(2));

    return {
      writeMbPerSec,
      readMbPerSec,
      objectCount,
      bucketSize
    };
  } catch (err) {
    return { writeMbPerSec: 0, readMbPerSec: 0, objectCount: 0, bucketSize: 0 };
  }
}

async function getQueueMetrics() {
  try {
    const redis = getRedisClient();
    const [wait, active, failed, delayed] = await Promise.all([
      redis.llen('bull:image-processing:wait'),
      redis.llen('bull:image-processing:active'),
      redis.zcard('bull:image-processing:failed'),
      redis.zcard('bull:image-processing:delayed')
    ]);
    return {
      wait: Number(wait),
      active: Number(active),
      failed: Number(failed),
      delayed: Number(delayed)
    };
  } catch (err) {
    return { wait: 0, active: 0, failed: 0, delayed: 0 };
  }
}

export async function getProcessingStats(timebase: 'capture' | 'ingestion' = 'ingestion') {
  const prisma = getPrisma();

  const now = new Date();
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Timebase-sensitive widgets (Recent Activity, Storage Growth) group by either the
  // real capture time (capturedAt) for a business/production view, or the ingestion
  // time (ingestedAt) for an IT/infrastructure view. IT-only widgets below (throughput,
  // queue, postgres, provider, camera status) always stay on processing time.
  const imageTimeField = timebase === 'capture' ? 'capturedAt' : 'ingestedAt';
  const dbTimeColumn = timebase === 'capture' ? 'captured_at' : 'ingested_at';

  const [
    statusCounts, typeCounts, queue, pgMetrics, storageMetrics,
    totalImages, cameraCounts, operationalCounts, fileTypeStats, recentImages, cameraList,
    jobsToday, imagesToday, completedToday, failedToday, storageUsage,
  ] = await Promise.all([
    prisma.processingJob.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.processingJob.groupBy({
      by: ['jobType'],
      _count: { id: true },
    }),
    getQueueMetrics(),
    getPgMetrics(prisma),
    getStorageMetrics(prisma),
    prisma.image.count(),
    prisma.camera.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    // Real-time reachability (set by the health monitor) — counted ONLY among
    // cameras whose manual status is 'active', because those are the ones a human
    // said should be running. A camera deliberately set to inactive/maintenance
    // being unreachable is expected and must NOT raise the red offline warning.
    prisma.camera.groupBy({
      by: ['operationalStatus'],
      where: { enabled: true, deletedAt: null, status: 'active' },
      _count: { id: true },
    }),
    prisma.imageFile.groupBy({
      by: ['fileType'],
      _sum: { fileSizeBytes: true },
      _count: { id: true },
    }),
    prisma.$queryRawUnsafe<Array<{ day_str: string; count: bigint }>>(`
      SELECT DATE_TRUNC('day', "${dbTimeColumn}")::text AS day_str, COUNT(*)::bigint AS count
      FROM images
      WHERE "${dbTimeColumn}" >= $1 AND deleted_at IS NULL
      GROUP BY DATE_TRUNC('day', "${dbTimeColumn}")
    `, last7Days),
    prisma.camera.findMany({ select: { id: true, name: true } }),
    prisma.processingJob.count({ where: { queuedAt: { gte: todayStart } } }),
    prisma.image.count({ where: { [imageTimeField]: { gte: todayStart }, deletedAt: null } }),
    prisma.image.count({ where: { [imageTimeField]: { gte: todayStart }, status: 'completed' } }),
    prisma.image.count({ where: { [imageTimeField]: { gte: todayStart }, status: 'failed' } }),
    getProviderBackedStorageUsage(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const s of statusCounts) {
    byStatus[s.status] = s._count.id;
  }

  const byType = typeCounts.map((t) => ({
    jobType: t.jobType,
    count: t._count.id,
  }));

  const total = statusCounts.reduce((s, c) => s + c._count.id, 0);
  const completed = byStatus['completed'] ?? 0;
  const failed = byStatus['failed'] ?? 0;
  const running = byStatus['running'] ?? 0;
  const queued = byStatus['queued'] ?? 0;

  // Camera counts — manual/configured status (set by a person)
  let activeCameras = 0;
  let inactiveCameras = 0;
  let errorCameras = 0;
  let maintenanceCameras = 0;
  for (const c of cameraCounts) {
    if (c.status === 'active') activeCameras = c._count.id;
    else if (c.status === 'inactive') inactiveCameras = c._count.id;
    else if (c.status === 'error') errorCameras = c._count.id;
    else if (c.status === 'maintenance') maintenanceCameras = c._count.id;
  }

  // Camera counts — real-time reachability (set by the health monitor)
  let camerasOnline = 0;
  let camerasOffline = 0;
  let camerasRecovering = 0;
  let camerasUnknown = 0;
  for (const c of operationalCounts) {
    if (c.operationalStatus === 'online') camerasOnline = c._count.id;
    else if (c.operationalStatus === 'offline') camerasOffline = c._count.id;
    else if (c.operationalStatus === 'recovering') camerasRecovering = c._count.id;
    else if (c.operationalStatus === 'unknown') camerasUnknown = c._count.id;
  }

  // Storage by type
  const storageByType = fileTypeStats.map((f) => ({
    name: f.fileType,
    value: Number(f._count.id ?? 0),
  }));

  // Storage used/total — sourced from each active provider's own self-reported metric
  // (same as /storage/summary and the real auto-cleanup pressure trigger), not a raw
  // Postgres sum of image_files.file_size_bytes. See lib/storage-usage.ts and
  // incident_2026-08-06 for why: a Postgres sum silently overcounts whenever a delete
  // removes the object from storage but fails/times out before removing the DB row.
  const storageUsed = storageUsage.hasMetrics
    ? storageUsage.usedBytes
    : fileTypeStats.reduce((s, f) => s + Number(f._sum?.fileSizeBytes ?? 0n), 0);
  const storageTotalBytes = storageUsage.hasMetrics
    ? storageUsage.capacityBytes
    : await getFallbackCapacityBytes();

  // Processing rate (last hour)
  const hourlyJobs = await prisma.processingJob.count({
    where: { completedAt: { gte: lastHour } },
  });
  const processingRate = hourlyJobs;

  // Hourly throughput for the last 24 hours
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentJobs = await prisma.processingJob.findMany({
    where: {
      status: 'completed',
      completedAt: { gte: last24Hours },
    },
    select: { completedAt: true },
  });

  const hourlyMap: Record<string, number> = {};
  for (let i = 0; i < 24; i++) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    time.setUTCMinutes(0, 0, 0);
    const isoStr = time.toISOString();
    hourlyMap[isoStr] = 0;
  }
  for (const job of recentJobs) {
    if (job.completedAt) {
      const time = new Date(job.completedAt.getTime());
      time.setUTCMinutes(0, 0, 0);
      const isoStr = time.toISOString();
      if (hourlyMap[isoStr] !== undefined) {
        hourlyMap[isoStr]++;
      }
    }
  }
  const hourlyThroughput = Object.entries(hourlyMap)
    .map(([label, value]) => ({ label, value }))
    .reverse();

  // Recent activity (daily image counts for last 7 days)
  const dayMap: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dayMap[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of recentImages) {
    const day = (r.day_str ? String(r.day_str) : '').slice(0, 10);
    if (dayMap[day] !== undefined) dayMap[day] += Number(r.count ?? 0n);
  }
  const recentActivity = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));

  // Storage growth (daily bytes for last 7 days)
  const storageDayMap: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    storageDayMap[d.toISOString().slice(0, 10)] = 0;
  }
  if (timebase === 'capture') {
    // ImageFile has no capturedAt — join to the parent image's captured_at so storage
    // volume is attributed to the day the work was actually produced.
    const rows = await prisma.$queryRaw<Array<{ day: Date; bytes: bigint }>>`
      SELECT DATE(i.captured_at) as day, COALESCE(SUM(f.file_size_bytes), 0)::bigint as bytes
      FROM image_files f
      JOIN images i ON i.id = f.image_id
      WHERE i.captured_at >= ${last7Days}
      GROUP BY DATE(i.captured_at)
    `;
    for (const r of rows) {
      const day = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10);
      if (storageDayMap[day] !== undefined) storageDayMap[day] += Number(r.bytes ?? 0n);
    }
  } else {
    const rows = await prisma.$queryRaw<Array<{ day: Date; bytes: bigint }>>`
      SELECT DATE(created_at) as day, COALESCE(SUM(file_size_bytes), 0)::bigint as bytes
      FROM image_files
      WHERE created_at >= ${last7Days}
      GROUP BY DATE(created_at)
    `;
    for (const r of rows) {
      const day = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10);
      if (storageDayMap[day] !== undefined) storageDayMap[day] += Number(r.bytes ?? 0n);
    }
  }
  const storageGrowth = Object.entries(storageDayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label: label.slice(5), value }));

  // Images by camera
  const imagesByCameraData = await prisma.image.groupBy({
    by: ['cameraId'],
    _count: { id: true },
  });
  const cameraMap = new Map(cameraList.map((c) => [c.id, c.name]));
  const imagesByCamera = imagesByCameraData
    .map((d) => ({
      name: d.cameraId ? (cameraMap.get(d.cameraId) ?? d.cameraId) : 'Unassigned',
      value: d._count.id,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    timebase,
    total,
    totalImages,
    completed,
    failed,
    running,
    queued,
    jobsToday,
    imagesToday,
    completedToday,
    failedToday,
    activeCameras,
    inactiveCameras,
    errorCameras,
    maintenanceCameras,
    camerasOnline,
    camerasOffline,
    camerasRecovering,
    camerasUnknown,
    storageUsed,
    storageTotal: storageTotalBytes,
    processingRate,
    hourlyThroughput,
    recentActivity,
    storageGrowth,
    imagesByCamera,
    storageByType,
    byStatus,
    byType,
    queue,
    postgres: pgMetrics,
    storage: storageMetrics,
  };
}

// Legacy semantic period keys — kept only so any old bookmarked/localStorage value from
// before the frontend switched to plain '<N>d' strings still resolves to something sane.
const LEGACY_PERIOD_DAYS: Record<string, number> = {
  '21d': 21, '28d': 28, '4m': 120, '8m': 240, '12m': 365, '5y': 1825,
};

type Granularity = 'hour' | 'day' | 'week' | 'month' | 'year';

// How far back the chosen period reaches decides the bucket size — otherwise a 5-year
// selection would try to render ~1825 daily bars. Thresholds match what was agreed with
// the user: up to 1 month stays daily, >1 month up to (not including) 1 year buckets by
// week, exactly 1 year buckets by month, and beyond 1 year buckets by calendar year.
function resolveGranularity(days: number, isToday: boolean): Granularity {
  if (isToday) return 'hour';
  if (days <= 30) return 'day';
  if (days < 365) return 'week';
  if (days === 365) return 'month';
  return 'year';
}

// Truncate `d` down to the start of its bucket for the given granularity — must mirror
// Postgres's own date_trunc() exactly (same server timezone assumption already relied on
// by the 'day'/'hour' bucketing below) so JS-built skeleton keys line up with query results.
function truncTo(d: Date, granularity: Granularity): Date {
  const r = new Date(d);
  if (granularity === 'hour') { r.setMinutes(0, 0, 0); return r; }
  if (granularity === 'day') { r.setHours(0, 0, 0, 0); return r; }
  if (granularity === 'week') {
    r.setHours(0, 0, 0, 0);
    const dow = r.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dow === 0 ? -6 : 1 - dow; // Postgres date_trunc('week', ...) is ISO (Monday-start)
    r.setDate(r.getDate() + diffToMonday);
    return r;
  }
  if (granularity === 'month') return new Date(r.getFullYear(), r.getMonth(), 1);
  return new Date(r.getFullYear(), 0, 1); // year
}

function stepBucket(d: Date, granularity: Granularity): Date {
  const r = new Date(d);
  if (granularity === 'hour') { r.setHours(r.getHours() + 1); return r; }
  if (granularity === 'day') { r.setDate(r.getDate() + 1); return r; }
  if (granularity === 'week') { r.setDate(r.getDate() + 7); return r; }
  if (granularity === 'month') { r.setMonth(r.getMonth() + 1); return r; }
  r.setFullYear(r.getFullYear() + 1); return r;
}

export async function getTrends(period: string, timebase: 'capture' | 'ingestion' = 'ingestion') {
  const prisma = getPrisma();
  const now = new Date();

  const isToday = period === 'today';
  const daysMatch = /^(\d+)d$/.exec(period);
  const days = isToday ? 1 : daysMatch ? parseInt(daysMatch[1], 10) : (LEGACY_PERIOD_DAYS[period] ?? 7);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 'today' compares hour-by-hour against today's start, not a rolling 24h window —
  // matches how every other period compares against a calendar-aligned previous window.
  const currentStart = isToday ? todayStart : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = isToday
    ? new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
    : new Date(currentStart.getTime() - days * 24 * 60 * 60 * 1000);

  // Business view uses capturedAt (real production time); IT view uses createdAt
  // (ingestion time). The daily image/storage breakdown honours this so the
  // Overview timebase toggle actually moves these charts.
  const imageTimeField = timebase === 'capture' ? 'capturedAt' : 'createdAt';
  const dbTimeColumn = timebase === 'capture' ? 'captured_at' : 'created_at';

  const granularity = resolveGranularity(days, isToday);
  const bucketExpr = `date_trunc('${granularity}', "${dbTimeColumn}")`;

  const [
    todayImages,
    totalImages,
    currentImages,
    previousImages,
    currentStorage,
    previousStorage,
    currentJobs,
    previousJobs,
    bucketedImages,
  ] = await Promise.all([
    prisma.image.count({ where: { [imageTimeField]: { gte: todayStart } } }),
    prisma.image.count(),
    prisma.image.count({ where: { [imageTimeField]: { gte: currentStart } } }),
    prisma.image.count({ where: { [imageTimeField]: { gte: previousStart, lt: currentStart } } }),
    prisma.imageFile.aggregate({
      where: { createdAt: { gte: currentStart } },
      _sum: { fileSizeBytes: true },
    }),
    prisma.imageFile.aggregate({
      where: { createdAt: { gte: previousStart, lt: currentStart } },
      _sum: { fileSizeBytes: true },
    }),
    prisma.processingJob.count({ where: { completedAt: { gte: currentStart } } }),
    prisma.processingJob.count({ where: { completedAt: { gte: previousStart, lt: currentStart } } }),
    // Breakdown for the current period, bucketed by day normally or by hour for 'today'.
    prisma.$queryRawUnsafe<Array<{ bucket: Date; count: bigint; bytes: bigint }>>(`
      SELECT ${bucketExpr} as bucket, COUNT(*)::bigint as count, COALESCE(SUM(file_size_bytes), 0)::bigint as bytes
      FROM images
      WHERE "${dbTimeColumn}" >= $1 AND deleted_at IS NULL
      GROUP BY ${bucketExpr}
    `, currentStart),
  ]);

  const currentStorageBytes = Number(currentStorage._sum.fileSizeBytes ?? 0n);
  const previousStorageBytes = Number(previousStorage._sum.fileSizeBytes ?? 0n);

  // Build the breakdown buckets — every bucket in [currentStart, now] at the resolved
  // granularity, zero-filled so a quiet hour/day/week/month/year still shows as 0 instead
  // of a gap in the chart.
  const buckets: Record<string, { images: number; storage: number }> = {};
  const skeletonEnd = isToday ? new Date(todayStart.getTime() + 24 * 60 * 60 * 1000) : now;
  for (let cursor = truncTo(currentStart, granularity); cursor < skeletonEnd; cursor = stepBucket(cursor, granularity)) {
    buckets[cursor.toISOString()] = { images: 0, storage: 0 };
  }

  for (const r of bucketedImages) {
    const key = truncTo(new Date(r.bucket), granularity).toISOString();
    if (buckets[key]) {
      buckets[key].images = Number(r.count ?? 0n);
      buckets[key].storage = Number(r.bytes ?? 0n);
    }
  }
  const dailyBreakdown = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      images: v.images,
      storage: v.storage,
    }));

  const calcChange = (cur: number, prev: number) =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;

  return {
    period,
    days,
    bucketUnit: granularity,
    today: { images: todayImages },
    total: { images: totalImages },
    current: { images: currentImages, storage: currentStorageBytes, jobs: currentJobs },
    previous: { images: previousImages, storage: previousStorageBytes, jobs: previousJobs },
    change: {
      images: calcChange(currentImages, previousImages),
      storage: calcChange(currentStorageBytes, previousStorageBytes),
      jobs: calcChange(currentJobs, previousJobs),
    },
    dailyBreakdown,
  };
}

// P49 — Executive Defect Dashboard. Every image captured into the system is a
// defective part, so image counts ARE defect counts. All figures use capturedAt
// (real production time), never ingestion time, so business analysis stays correct
// even when camera networks lag and images sync late.
export async function getExecutiveDefectStats(days: number, limit: number) {
  const prisma = getPrisma();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // days === 1 means the "Today" tab: use the calendar day (since midnight),
  // not a rolling 24h window, so it matches what "today" means to a user.
  const currentStart = days === 1
    ? todayStart
    : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = days === 1
    ? new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
    : new Date(currentStart.getTime() - days * 24 * 60 * 60 * 1000);
  const notDeleted = { deletedAt: null };

  const [todayCount, currentCount, previousCount, rankingRaw, cameraList, dailyRows] =
    await Promise.all([
      prisma.image.count({ where: { ...notDeleted, capturedAt: { gte: todayStart } } }),
      prisma.image.count({ where: { ...notDeleted, capturedAt: { gte: currentStart } } }),
      prisma.image.count({
        where: { ...notDeleted, capturedAt: { gte: previousStart, lt: currentStart } },
      }),
      prisma.image.groupBy({
        by: ['cameraId'],
        where: { ...notDeleted, capturedAt: { gte: currentStart } },
        _count: { id: true },
      }),
      prisma.camera.findMany({ select: { id: true, name: true } }),
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT DATE(captured_at) as day, COUNT(*)::bigint as count
        FROM images
        WHERE captured_at >= ${currentStart} AND deleted_at IS NULL
        GROUP BY DATE(captured_at)
        ORDER BY day ASC
      `,
    ]);

  // Daily trend with zero-filled buckets ending today
  const dayMap: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    dayMap[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of dailyRows) {
    const day = (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10);
    if (dayMap[day] !== undefined) dayMap[day] = Number(r.count);
  }
  const dailyTrend = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  // Ranking: machines with the most defects, descending. vsAvg compares each
  // machine against the average across machines that produced defects, so an
  // outlier (possible bad settings) stands out immediately.
  const cameraMap = new Map(cameraList.map((c) => [c.id, c.name]));
  const machinesWithDefects = rankingRaw.filter((r) => r._count.id > 0);
  const avgPerMachine = machinesWithDefects.length > 0
    ? currentCount / machinesWithDefects.length
    : 0;
  const ranking = machinesWithDefects
    .map((r) => ({
      cameraId: r.cameraId,
      name: r.cameraId ? (cameraMap.get(r.cameraId) ?? r.cameraId) : 'Unassigned',
      count: r._count.id,
      sharePct: currentCount > 0 ? Math.round((r._count.id / currentCount) * 1000) / 10 : 0,
      vsAvg: avgPerMachine > 0 ? Math.round((r._count.id / avgPerMachine) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const changePct = previousCount > 0
    ? Math.round(((currentCount - previousCount) / previousCount) * 100)
    : currentCount > 0 ? 100 : 0;

  return {
    days,
    limit,
    today: todayCount,
    current: currentCount,
    previous: previousCount,
    changePct,
    machinesWithDefects: machinesWithDefects.length,
    avgPerMachine: Math.round(avgPerMachine * 10) / 10,
    dailyTrend,
    ranking,
  };
}

// Executive heatmap: defect counts bucketed by day-of-week × hour of capturedAt,
// so recurring hot spots (a shift, a time slot) are visible at a glance.
export async function getDefectHeatmap(days: number) {
  const prisma = getPrisma();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>`
    SELECT EXTRACT(DOW FROM captured_at)::int AS dow,
           EXTRACT(HOUR FROM captured_at)::int AS hour,
           COUNT(*)::bigint AS count
    FROM images
    WHERE captured_at >= ${start} AND deleted_at IS NULL
    GROUP BY 1, 2
  `;
  const cells = rows.map((r) => ({ dow: r.dow, hour: r.hour, count: Number(r.count) }));
  const max = cells.reduce((m, c) => Math.max(m, c.count), 0);
  return { days, max, cells };
}

export async function getStreamData() {
  const prisma = getPrisma();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [statusCounts, logs, queue, jobsToday] = await Promise.all([
    prisma.processingJob.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.processingJob.findMany({
      orderBy: { queuedAt: 'desc' },
      take: 20,
      select: {
        id: true, imageId: true, jobType: true, status: true, workerId: true,
        errorMessage: true, retryCount: true, queuedAt: true, startedAt: true, completedAt: true,
      },
    }),
    getQueueMetrics(),
    prisma.processingJob.count({ where: { queuedAt: { gte: todayStart } } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const s of statusCounts) byStatus[s.status] = s._count.id;

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const stats = {
    total,
    completed: byStatus['completed'] ?? 0,
    failed: (byStatus['failed'] ?? 0) + (byStatus['dead_letter'] ?? 0),
    running: byStatus['running'] ?? 0,
    queued: byStatus['queued'] ?? 0,
    jobsToday,
    queue,
  };

  const mapped = logs.map((j) => ({
    id: j.id, imageId: j.imageId, jobType: j.jobType, status: j.status,
    workerId: j.workerId, errorMessage: j.errorMessage, retryCount: j.retryCount,
    queuedAt: j.queuedAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
    durationMs: j.startedAt && j.completedAt ? j.completedAt.getTime() - j.startedAt.getTime() : null,
  }));

  return { stats, logs: mapped };
}

export async function retryJob(jobId: string) {
  const prisma = getPrisma();

  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new NotFoundError('ProcessingJob', jobId);
  }

  if (job.status !== 'failed' && job.status !== 'dead_letter') {
    throw new Error(`Cannot retry job with status '${job.status}'`);
  }

  if (!job.imageId) {
    throw new Error('Cannot retry: job has no linked image');
  }

  // Actually re-enqueue the work. Flipping the DB row alone (the old behaviour)
  // was cosmetic — no worker ever consumes ProcessingJob rows; the real queue is
  // Redis. reprocessImage() clears stale outputs and pushes a fresh Redis job.
  await reprocessImage(job.imageId);

  const updated = await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'queued',
      retryCount: { increment: 1 },
      errorMessage: null,
      errorDetails: Prisma.JsonNull,
      startedAt: null,
      completedAt: null,
    },
  });

  return { id: updated.id, status: updated.status };
}

export async function rejectJob(jobId: string) {
  const prisma = getPrisma();

  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new NotFoundError('ProcessingJob', jobId);
  }

  if (job.status !== 'dead_letter' && job.status !== 'failed') {
    throw new Error(`Cannot reject job with status '${job.status}'`);
  }

  const updated = await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: 'rejected' },
  });

  return { id: updated.id, status: updated.status };
}

export async function getDlqSummary() {
  const prisma = getPrisma();

  // Terminal failures come in two flavours: 'dead_letter' (set by DLQ actions) and
  // 'failed' (created when the worker reports a permanently-failed image). Both are
  // jobs awaiting human action, so the DLQ shows both — previously only
  // 'dead_letter' was queried and worker failures were invisible here.
  const deadLetters = await prisma.processingJob.findMany({
    where: { status: { in: ['dead_letter', 'failed'] } },
    orderBy: { queuedAt: 'desc' },
    take: 500,
    include: {
      image: { select: { originalFilename: true, cameraId: true } },
    },
  });

  const byJobType: Record<string, number> = {};
  let total = 0;
  const mapped = deadLetters.map((j) => {
    byJobType[j.jobType] = (byJobType[j.jobType] ?? 0) + 1;
    total++;
    return {
      id: j.id,
      imageId: j.imageId,
      jobType: j.jobType,
      workerId: j.workerId,
      queueName: j.queueName,
      errorMessage: j.errorMessage,
      retryCount: j.retryCount,
      maxRetries: j.maxRetries,
      queuedAt: j.queuedAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
      imageFilename: j.image?.originalFilename ?? null,
      cameraId: j.image?.cameraId ?? null,
    };
  });

  return {
    total,
    byJobType,
    jobs: mapped,
  };
}

export async function bulkRetryDlq(jobType?: string) {
  const prisma = getPrisma();
  const where: Prisma.ProcessingJobWhereInput = { status: { in: ['dead_letter', 'failed'] } };
  if (jobType) where.jobType = jobType;

  // One image can have several failure rows (a new row is logged per failed
  // attempt), so dedupe and re-enqueue each image once via the real Redis queue.
  const rows = await prisma.processingJob.findMany({ where, select: { id: true, imageId: true } });
  const byImage = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.imageId) continue; // rows without a linked image cannot be requeued
    const arr = byImage.get(r.imageId) ?? [];
    arr.push(r.id);
    byImage.set(r.imageId, arr);
  }

  let requeued = 0;
  let skipped = 0;
  const retriedRowIds: string[] = [];
  for (const [imageId, rowIds] of byImage) {
    try {
      await reprocessImage(imageId);
      requeued++;
      for (const id of rowIds) {
        retriedRowIds.push(id);
      }
    } catch (err) {
      // e.g. image deleted or its camera permanently removed — leave its rows as-is
      skipped++;
      logger.warn({ imageId, err }, 'DLQ bulk retry: skipped image that cannot be reprocessed');
    }
  }

  if (retriedRowIds.length > 0) {
    await prisma.processingJob.updateMany({
      where: { id: { in: retriedRowIds } },
      data: {
        status: 'queued',
        retryCount: { increment: 1 },
        errorMessage: null,
        errorDetails: Prisma.JsonNull,
        startedAt: null,
        completedAt: null,
      },
    });
  }

  return { updated: requeued, skipped };
}

export async function bulkDeleteLogsPreview(days: number) {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - days * 86400000);
  const count = await prisma.processingJob.count({
    where: { queuedAt: { lt: cutoff } },
  });
  return { days, cutoffDate: cutoff.toISOString(), count };
}

export async function bulkDeleteLogsByAge(days: number, _username: string) {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - days * 86400000);
  const result = await prisma.processingJob.deleteMany({
    where: { queuedAt: { lt: cutoff } },
  });
  return { deleted: result.count, days, cutoffDate: cutoff.toISOString() };
}

export async function bulkRejectDlq(jobType?: string) {
  const prisma = getPrisma();
  const where: Prisma.ProcessingJobWhereInput = { status: { in: ['dead_letter', 'failed'] } };
  if (jobType) where.jobType = jobType;

  const result = await prisma.processingJob.updateMany({
    where,
    data: { status: 'rejected' },
  });

  return { updated: result.count };
}
