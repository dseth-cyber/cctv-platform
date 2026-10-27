import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { createAlert } from '../alerts/alerts.service.js';

// `Image.retentionUntil` tracks exactly one thing: when this image's **raw** file
// should be swept by the age-based sweeper below. Processed/thumbnail files have
// their own, much longer retention windows (RetentionPolicy.processedRetentionDays /
// thumbnailRetentionDays) and are deliberately *not* driven by this field — those are
// only ever touched by the storage-pressure watermark cleanup (cleanup-planner), which
// respects each file type independently. Conflating the two here previously caused the
// sweeper to delete an image's processed+thumbnail files the moment its 1-day raw
// window passed, weeks/months before their own configured retention — see incident
// 2026-08-06.
export async function setRetentionUntil(imageId: string, cameraId: string): Promise<void> {
  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    include: { retentionPolicy: true },
  });

  if (!camera?.retentionPolicy) return;

  const policy = camera.retentionPolicy;
  const days = policy.rawRetentionDays ?? 90;
  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + days);

  await prisma.image.update({
    where: { id: imageId },
    data: { retentionUntil },
  });
}

// Called when a RetentionPolicy's rawRetentionDays changes. `retentionUntil` is a
// snapshot taken once at ingestion time, so without this, images ingested under an
// older (longer) raw-retention value would keep their stale expiry date and the sweeper
// wouldn't catch them until that original date — not the newly-configured one. Recomputes
// from each image's own capturedAt, scoped to cameras on this policy, only for images that
// still have a raw file (nothing to do otherwise) and aren't already trashed.
export async function recomputeRetentionForPolicy(policyId: string, rawRetentionDays: number): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.$executeRaw`
    UPDATE images i
    SET retention_until = i.captured_at + (${rawRetentionDays} || ' days')::interval
    FROM cameras c
    WHERE i.camera_id = c.id
      AND c.retention_policy_id = ${policyId}::uuid
      AND i.deleted_at IS NULL
      AND i.status != 'deleted'
      AND EXISTS (SELECT 1 FROM image_files f WHERE f.image_id = i.id AND f.file_type = 'raw')
  `;
  return Number(result);
}

// Batch size is generous on purpose: this runs as a background cron, not behind an HTTP
// request, so it isn't subject to nginx's proxy_read_timeout the way the search-page
// bulk-delete/trash-empty endpoints are (see images.service.ts) — there's no client
// connection to time out. A large batch is what lets it actually keep pace with real
// ingest volume instead of perpetually falling behind a few hundred/day.
const SWEEP_BATCH_SIZE = 10000;

export async function sweepExpiredImages(): Promise<{ deleted: number; errors: number }> {
  const prisma = getPrisma();
  let deleted = 0;
  let errors = 0;

  try {
    const expired = await prisma.image.findMany({
      where: {
        retentionUntil: { lte: new Date() },
        deletedAt: null,
        status: { not: 'deleted' },
      },
      include: { imageFiles: { where: { fileType: 'raw' } } },
      take: SWEEP_BATCH_SIZE,
    });

    for (const image of expired) {
      const rawFile = image.imageFiles[0];

      // No raw file left (already removed some other way, e.g. manual bulk-delete) —
      // this timer no longer means anything for this image. Clear it so the image stops
      // being re-matched by every future sweep run.
      if (!rawFile) {
        try {
          await prisma.image.update({ where: { id: image.id }, data: { retentionUntil: null } });
        } catch (err) {
          logger.error({ err, imageId: image.id }, 'Failed to clear stale retentionUntil');
          errors++;
        }
        continue;
      }

      try {
        try {
          const provider = rawFile.storageProviderId
            ? storageRouter.get(rawFile.storageProviderId)
            : storageRouter.getDefault();
          await provider.delete(rawFile.objectKey);
        } catch (err: any) {
          if (!err.message?.includes('Not Found')) {
            throw err; // keep the DB row in sync with reality — don't drop it if storage delete failed
          }
        }

        await prisma.imageFile.delete({ where: { id: rawFile.id } });
        // Only the raw file was removed — the image itself (and any processed/thumbnail
        // files) stays exactly as it was; nothing left to expire on this timer.
        await prisma.image.update({
          where: { id: image.id },
          data: { retentionUntil: null },
        });

        // Deliberately NOT writing a CameraEvent here (unlike other camera lifecycle
        // events). camera_events backs the Camera Analytics availability/MTBF/MTTR
        // timeline — routine per-file retention housekeeping isn't an operational health
        // event, and at real ingest volume floods that table (37,816 rows in ~36h once
        // this sweeper moved from daily/100-per-run to hourly/10000-per-run) which made
        // every downtime-report query for the camera slow and payload-heavy. The
        // logger.info batch summary below is the audit trail for this instead. See
        // incident_2026-08-07.
        deleted++;
      } catch (err) {
        logger.error({ err, imageId: image.id }, 'Retention sweep failed for image');
        errors++;
      }
    }

    if (expired.length > 0) {
      logger.info({ deleted, errors, total: expired.length }, 'Retention sweep batch complete');
    }
  } catch (err) {
    logger.error({ err }, 'Retention sweep query failed');
  }

  return { deleted, errors };
}

/**
 * Sweeps expired CCTV recording segments from disk while strictly respecting Legal Hold flags.
 * Physical files are deleted and records are marked isArchived = true ONLY when legalHold = false.
 */
export async function sweepExpiredRecordings(options?: {
  defaultRetentionDays?: number;
}): Promise<{ deleted: number; errors: number; skippedLegalHold: number }> {
  const prisma = getPrisma();
  let deleted = 0;
  let errors = 0;
  let skippedLegalHold = 0;

  const retentionDays = options?.defaultRetentionDays ?? 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const now = new Date();

  try {
    // Query expired recordings where legalHold is FALSE
    const expiredRecordings = await prisma.cameraRecording.findMany({
      where: {
        legalHold: false,
        isArchived: false,
        OR: [
          { retentionUntil: { lte: now } },
          { createdAt: { lte: cutoffDate } },
        ],
      },
      take: 500,
    });

    for (const rec of expiredRecordings) {
      try {
        if (rec.filePath && fs.existsSync(rec.filePath)) {
          fs.unlinkSync(rec.filePath);
        }
        await prisma.cameraRecording.update({
          where: { id: rec.id },
          data: { isArchived: true },
        });
        deleted++;
      } catch (err) {
        logger.error({ err, recordingId: rec.id }, 'Failed to delete expired recording file');
        errors++;
      }
    }

    // Count how many expired recordings were preserved due to legalHold = true
    skippedLegalHold = await prisma.cameraRecording.count({
      where: {
        legalHold: true,
        OR: [
          { retentionUntil: { lte: now } },
          { createdAt: { lte: cutoffDate } },
        ],
      },
    });

    if (deleted > 0 || skippedLegalHold > 0) {
      logger.info({ deleted, errors, skippedLegalHold }, 'Recording retention sweep completed');
    }
  } catch (err) {
    logger.error({ err }, 'Recording retention sweep query failed');
  }

  return { deleted, errors, skippedLegalHold };
}

export interface DiskWatermarkResult {
  status: 'normal' | 'warning' | 'emergency_eviction_completed';
  usedPercent: number;
  totalBytes: number;
  freeBytes: number;
  evictedCount: number;
  bytesFreed: number;
  skippedLegalHold: number;
}

export interface StatfsInfo {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

/**
 * Checks disk high-watermark for the CCTV recordings directory and triggers
 * emergency FIFO eviction if disk utilization reaches critical threshold (>= 92%) [ENH-03].
 * Eviction strictly skips legalHold: true recordings and stops once usage drops below 85%.
 */
export async function checkDiskHighWatermarkAndEvict(options?: {
  directoryPath?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetRecoveryPercent?: number;
  statfsProvider?: (dirPath: string) => Promise<StatfsInfo> | StatfsInfo;
}): Promise<DiskWatermarkResult> {
  const prisma = getPrisma();
  const dirPath = options?.directoryPath || process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');
  const envWarn = process.env.DISK_WARNING_THRESHOLD_PCT ? parseInt(process.env.DISK_WARNING_THRESHOLD_PCT, 10) : 85;
  const envCrit = process.env.DISK_CRITICAL_THRESHOLD_PCT ? parseInt(process.env.DISK_CRITICAL_THRESHOLD_PCT, 10) : 92;
  const warnThreshold = options?.warningThresholdPercent ?? (Number.isFinite(envWarn) ? envWarn : 85);
  const critThreshold = options?.criticalThresholdPercent ?? (Number.isFinite(envCrit) ? envCrit : 92);
  const targetPercent = options?.targetRecoveryPercent ?? warnThreshold;

  let diskInfo: StatfsInfo;
  if (options?.statfsProvider) {
    diskInfo = await options.statfsProvider(dirPath);
  } else {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const stat = fs.statfsSync(dirPath);
      const totalBytes = Number(stat.blocks) * Number(stat.bsize);
      const freeBytes = Number(stat.bavail) * Number(stat.bsize);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
      diskInfo = { totalBytes, freeBytes, usedPercent };
    } catch (err) {
      logger.error({ err, dirPath }, 'Failed to read disk statfs');
      return {
        status: 'normal',
        usedPercent: 0,
        totalBytes: 0,
        freeBytes: 0,
        evictedCount: 0,
        bytesFreed: 0,
        skippedLegalHold: 0,
      };
    }
  }

  const { totalBytes, freeBytes, usedPercent } = diskInfo;

  // 1. Normal state (< 85%)
  if (usedPercent < warnThreshold) {
    logger.debug({ usedPercent, warnThreshold }, 'Disk usage within normal operating range');
    return {
      status: 'normal',
      usedPercent,
      totalBytes,
      freeBytes,
      evictedCount: 0,
      bytesFreed: 0,
      skippedLegalHold: 0,
    };
  }

  // 2. Warning state (85% <= usedPercent < 92%)
  if (usedPercent >= warnThreshold && usedPercent < critThreshold) {
    logger.warn({ usedPercent, warnThreshold, critThreshold }, 'Disk usage reached warning high-watermark threshold');
    await createAlert({
      alertType: 'disk_space',
      severity: 'warning',
      source: 'disk_watermark_monitor',
      title: 'Recording Storage High-Watermark Warning',
      message: `Recording disk usage reached ${usedPercent.toFixed(1)}% (Threshold: ${warnThreshold}%). Approaching critical capacity limit.`,
      details: { usedPercent, warnThreshold, critThreshold, totalBytes, freeBytes, dirPath },
      skipDedup: false,
    });
    return {
      status: 'warning',
      usedPercent,
      totalBytes,
      freeBytes,
      evictedCount: 0,
      bytesFreed: 0,
      skippedLegalHold: 0,
    };
  }

  // 3. Critical state (>= 92%): Trigger Emergency FIFO Eviction
  logger.warn({ usedPercent, critThreshold }, 'Disk usage critical — initiating emergency FIFO eviction');
  await createAlert({
    alertType: 'disk_space',
    severity: 'critical',
    source: 'disk_watermark_monitor',
    title: 'Emergency FIFO Eviction Triggered',
    message: `Recording disk usage is critical at ${usedPercent.toFixed(1)}% (Threshold: ${critThreshold}%). Evicting oldest non-legal-hold recordings until usage < ${targetPercent}%.`,
    details: { usedPercent, critThreshold, targetPercent, totalBytes, freeBytes, dirPath },
    skipDedup: true,
  });

  let currentFree = freeBytes;
  let currentUsedPercent = usedPercent;
  let evictedCount = 0;
  let bytesFreed = 0;

  // Fetch oldest unarchived recordings that are NOT marked legalHold (FIFO order: oldest first)
  const candidateRecordings = await prisma.cameraRecording.findMany({
    where: {
      legalHold: false,
      isArchived: false,
    },
    orderBy: { startTime: 'asc' },
    take: 500,
  });

  for (const rec of candidateRecordings) {
    if (currentUsedPercent < targetPercent) {
      break;
    }

    try {
      if (rec.filePath && fs.existsSync(rec.filePath)) {
        try {
          fs.unlinkSync(rec.filePath);
        } catch (unlinkErr) {
          logger.warn({ unlinkErr, filePath: rec.filePath }, 'Could not unlink physical file during eviction');
        }
      }

      await prisma.cameraRecording.update({
        where: { id: rec.id },
        data: { isArchived: true },
      });

      const size = Number(rec.fileSizeBytes || 0);
      bytesFreed += size;
      evictedCount++;
      currentFree += size;
      if (totalBytes > 0) {
        currentUsedPercent = ((totalBytes - currentFree) / totalBytes) * 100;
      }
    } catch (err) {
      logger.error({ err, recordingId: rec.id }, 'Failed to evict recording segment');
    }
  }

  const skippedLegalHold = await prisma.cameraRecording.count({
    where: {
      legalHold: true,
      isArchived: false,
    },
  });

  logger.warn(
    { evictedCount, bytesFreed, initialUsedPercent: usedPercent, finalUsedPercent: currentUsedPercent, skippedLegalHold },
    'Emergency FIFO eviction completed'
  );

  return {
    status: 'emergency_eviction_completed',
    usedPercent: currentUsedPercent,
    totalBytes,
    freeBytes: currentFree,
    evictedCount,
    bytesFreed,
    skippedLegalHold,
  };
}

