import { getPrisma } from '../../lib/prisma.js';

export type CleanupTrigger = 'auto' | 'manual' | 'emergency';

export interface CleanupCandidate {
  fileId: string;
  imageId: string;
  cameraId: string;
  cameraName: string;
  fileType: string;
  bytes: number;
  capturedAt: Date;
  objectKey: string;
  bucket: string;
}

export interface CleanupPlan {
  providerId: string;
  usedBytes: number;
  totalBytes: number;
  usagePercent: number;
  targetBytesToFree: number;
  candidates: CleanupCandidate[];
  candidateBytes: number;
  affectedCameras: { id: string; name: string; bytes: number; files: number }[];
  wouldFreeToPercent: number;
}

const DEFAULT_DELETE_ORDER = ['thumbnail', 'processed', 'raw'];

// Which RetentionPolicy.cleanupMode values are eligible candidate sources for a given
// trigger. `retention_only`/`read_only` cameras never contribute candidates here — those
// stay under the existing age-based retention-sweeper only, by design (P26 Phase A
// deliberately doesn't touch that pre-existing mechanism).
function eligibleModesFor(trigger: CleanupTrigger): string[] {
  if (trigger === 'auto') return ['retention_watermark', 'circular'];
  return ['retention_watermark', 'circular', 'manual'];
}

export async function planCleanup(providerId: string, trigger: CleanupTrigger): Promise<CleanupPlan> {
  const prisma = getPrisma();

  const provider = await prisma.storageProvider.findUnique({ where: { id: providerId } });
  if (!provider) throw new Error('Storage provider not found');

  const latestMetric = await prisma.storageProviderMetric.findFirst({
    where: { providerId },
    orderBy: { collectedAt: 'desc' },
  });
  const usedBytes = Number(latestMetric?.usedBytes ?? 0);
  // `||` (not `??`) deliberately: a metric row can legitimately store totalBytes as the
  // literal number 0 (provider didn't report capacity), and 0 must still fall through to
  // the capacityBytes override — `??` would treat stored 0 as "present" and never fall back.
  const totalBytes = Number(latestMetric?.totalBytes) || Number(provider.capacityBytes ?? 0);
  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  const stopPercent = provider.pressureStopPercent;
  const targetBytesToFree = totalBytes > 0
    ? Math.max(0, usedBytes - Math.floor(totalBytes * (stopPercent / 100)))
    : 0;

  const eligibleModes = eligibleModesFor(trigger);

  const cameras = await prisma.camera.findMany({
    where: { deletedAt: null, retentionPolicy: { cleanupMode: { in: eligibleModes as any } } },
    select: {
      id: true,
      name: true,
      retentionPolicy: {
        select: { cleanupMode: true, deleteOrder: true, rawRetentionDays: true, allowEmergencyCleanup: true },
      },
    },
  });

  const eligibleCameraIds = cameras
    .filter((c) => {
      const mode = c.retentionPolicy?.cleanupMode;
      if (!mode) return false;
      if (trigger !== 'emergency') return true;
      // Emergency can override retention_watermark/circular unconditionally, but a
      // "manual"-mode camera only participates in Emergency if its policy explicitly
      // opted in — Emergency is meant to rescue a provider, not silently violate a
      // customer's "I said manual, I meant manual" policy.
      if (mode === 'circular' || mode === 'retention_watermark') return true;
      return c.retentionPolicy?.allowEmergencyCleanup === true;
    })
    .map((c) => c.id);

  if (eligibleCameraIds.length === 0 || targetBytesToFree <= 0) {
    return {
      providerId,
      usedBytes,
      totalBytes,
      usagePercent,
      targetBytesToFree,
      candidates: [],
      candidateBytes: 0,
      affectedCameras: [],
      wouldFreeToPercent: usagePercent,
    };
  }

  const cameraById = new Map(cameras.map((c) => [c.id, c]));
  const now = Date.now();

  // Fetch a bounded working set — oldest first, capped — rather than the whole table.
  // This is a Phase A simplification: fine for realistic per-provider volumes, revisit
  // with pagination/streaming if a single cleanup pass ever needs >50k candidate rows.
  const rows = await prisma.imageFile.findMany({
    where: {
      storageProviderId: providerId,
      image: { locked: false, deletedAt: null, cameraId: { in: eligibleCameraIds } },
    },
    select: {
      id: true,
      fileType: true,
      fileSizeBytes: true,
      bucket: true,
      objectKey: true,
      image: { select: { id: true, capturedAt: true, cameraId: true } },
    },
    orderBy: { image: { capturedAt: 'asc' } },
    take: 50000,
  });

  const expiredCutoffByCamera = new Map<string, number>();
  for (const c of cameras) {
    if (c.retentionPolicy) {
      expiredCutoffByCamera.set(c.id, now - c.retentionPolicy.rawRetentionDays * 86400000);
    }
  }

  // Each camera can be on its own retention policy with its own deleteOrder — reading
  // only cameras[0]'s order and applying it to every candidate (the previous behavior)
  // silently used the wrong priority for every other camera in a mixed-policy fleet. With
  // a single camera today this never showed up, but it must be fixed before scaling to
  // ~100 cameras with varied policies. See incident_2026-08-06.
  const deleteOrderByCamera = new Map<string, string[]>();
  for (const c of cameras) {
    deleteOrderByCamera.set(c.id, (c.retentionPolicy?.deleteOrder as string[] | undefined) ?? DEFAULT_DELETE_ORDER);
  }
  const orderIndex = (cameraId: string, fileType: string) => {
    const order = deleteOrderByCamera.get(cameraId) ?? DEFAULT_DELETE_ORDER;
    const idx = order.indexOf(fileType);
    return idx === -1 ? order.length : idx;
  };

  // r.image.cameraId is guaranteed non-null here — the `where` filter above only
  // matches cameraId IN eligibleCameraIds, which never includes NULL.
  const scored = rows.map((r) => {
    const cameraId = r.image.cameraId as string;
    const cam = cameraById.get(cameraId);
    const isCircular = cam?.retentionPolicy?.cleanupMode === 'circular';
    const cutoff = expiredCutoffByCamera.get(cameraId) ?? Infinity;
    const isExpired = isCircular || new Date(r.image.capturedAt).getTime() < cutoff;
    return { row: r, cam, isExpired };
  });

  scored.sort((a, b) => {
    const typeOrderDiff = orderIndex(a.row.image.cameraId as string, a.row.fileType) - orderIndex(b.row.image.cameraId as string, b.row.fileType);
    if (typeOrderDiff !== 0) return typeOrderDiff;
    // Retention-expired files are sacrificed before still-valid ones within the same file type.
    if (a.isExpired !== b.isExpired) return a.isExpired ? -1 : 1;
    return new Date(a.row.image.capturedAt).getTime() - new Date(b.row.image.capturedAt).getTime();
  });

  const candidates: CleanupCandidate[] = [];
  const affectedByCamera = new Map<string, { name: string; bytes: number; files: number }>();
  let accumulatedBytes = 0;

  for (const { row, cam } of scored) {
    if (accumulatedBytes >= targetBytesToFree) break;
    const cameraId = row.image.cameraId as string;
    const bytes = Number(row.fileSizeBytes);
    candidates.push({
      fileId: row.id,
      imageId: row.image.id,
      cameraId,
      cameraName: cam?.name ?? '',
      fileType: row.fileType,
      bytes,
      capturedAt: row.image.capturedAt,
      objectKey: row.objectKey,
      bucket: row.bucket,
    });
    accumulatedBytes += bytes;

    const entry = affectedByCamera.get(cameraId) ?? { name: cam?.name ?? '', bytes: 0, files: 0 };
    entry.bytes += bytes;
    entry.files += 1;
    affectedByCamera.set(cameraId, entry);
  }

  const wouldFreeToPercent = totalBytes > 0
    ? ((usedBytes - accumulatedBytes) / totalBytes) * 100
    : usagePercent;

  return {
    providerId,
    usedBytes,
    totalBytes,
    usagePercent,
    targetBytesToFree,
    candidates,
    candidateBytes: accumulatedBytes,
    affectedCameras: Array.from(affectedByCamera.entries()).map(([id, v]) => ({ id, ...v })),
    wouldFreeToPercent,
  };
}
