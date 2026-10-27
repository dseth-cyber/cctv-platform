import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { storageRouter } from '../../lib/storage/storage-router.js';

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
