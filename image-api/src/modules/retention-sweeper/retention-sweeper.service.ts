import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';
import { createAuditLog } from '../audit/audit.service.js';

// ── CCTV recording retention (policy approved 2026-11-03) ─────────────────────
// 1. A recording older than its camera's RetentionPolicy.recordingRetentionDays (default 30) is
//    moved to quarantine (recoverable).
// 2. A quarantined recording is deleted permanently RECORDINGS_QUARANTINE_PURGE_DAYS (default 7) later.
// 3. When the recordings disk reaches the critical watermark (92%), the oldest recordings are deleted
//    permanently — quarantined ones first — until usage is below the warning watermark (85%).
// Legal Hold always wins, every permanent deletion is written to the audit log, and nothing runs
// unless RECORDINGS_CLEANUP_ENABLED=true.

export function getDefaultRecordingRetentionDays(): number {
  const days = parseInt(process.env.RECORDING_RETENTION_DAYS ?? '30', 10);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

export function getQuarantinePurgeDays(): number {
  const days = parseInt(process.env.RECORDINGS_QUARANTINE_PURGE_DAYS ?? '7', 10);
  return Number.isFinite(days) && days >= 0 ? days : 7;
}

export interface RecordingCleanupDirs {
  recordingsDir: string;
  quarantineDir: string;
}

export function getRecordingCleanupDirs(overrides?: Partial<RecordingCleanupDirs>): RecordingCleanupDirs {
  const recordingsDir = path.resolve(overrides?.recordingsDir || process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings'));
  const quarantineDir = path.resolve(overrides?.quarantineDir || process.env.RECORDINGS_QUARANTINE_DIR || path.join(recordingsDir, '.quarantine'));
  return { recordingsDir, quarantineDir };
}

export function isRecordingCleanupEnabled(): boolean {
  return process.env.RECORDINGS_CLEANUP_ENABLED === 'true';
}

function moveFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
    // Quarantine on another filesystem: copy, verify, then drop the source.
    fs.copyFileSync(src, dest);
    if (fs.statSync(dest).size !== fs.statSync(src).size) {
      fs.unlinkSync(dest);
      throw new Error(`Quarantine copy size mismatch for ${src}`);
    }
    fs.unlinkSync(src);
  }
}

export type RestoreOutcome = 'restored' | 'not_archived' | 'not_in_quarantine' | 'outside_root' | 'error';

/**
 * Moves an archived segment back from quarantine to its original path and un-archives the row.
 * Used when a Legal Hold is placed on a segment that cleanup already moved away.
 */
export async function restoreRecordingFromQuarantine(
  rec: { id: string; filePath: string | null; isArchived: boolean },
  dirs: RecordingCleanupDirs = getRecordingCleanupDirs(),
): Promise<RestoreOutcome> {
  if (!rec.isArchived) return 'not_archived';
  if (!rec.filePath) return 'not_in_quarantine';
  const original = path.resolve(rec.filePath);
  const rel = path.relative(dirs.recordingsDir, original);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return 'outside_root';
  const quarantined = path.join(dirs.quarantineDir, rel);
  if (!fs.existsSync(quarantined)) return 'not_in_quarantine';
  try {
    moveFile(quarantined, original);
  } catch (err) {
    logger.error({ err, recordingId: rec.id, quarantinePath: quarantined }, 'Failed to restore recording from quarantine');
    return 'error';
  }
  await getPrisma().cameraRecording.updateMany({ where: { id: rec.id }, data: { isArchived: false, archivedAt: null } });
  logger.info({ recordingId: rec.id, filePath: original }, 'Recording restored from quarantine for Legal Hold');
  return 'restored';
}

export type QuarantineOutcome = 'moved' | 'missing_file' | 'skipped_legal_hold' | 'skipped_outside_root' | 'error';

/**
 * Archive one segment. The DB claim is atomic on `legalHold = false`, so a hold placed
 * after the candidate query is never overridden; a hold placed while the file is being
 * moved is detected afterwards and the move is reversed.
 */
export async function quarantineRecording(
  rec: { id: string; filePath: string | null },
  dirs: RecordingCleanupDirs,
): Promise<QuarantineOutcome> {
  const prisma = getPrisma();

  const claim = await prisma.cameraRecording.updateMany({
    where: { id: rec.id, legalHold: false, isArchived: false },
    data: { isArchived: true, archivedAt: new Date() },
  });
  if (claim.count === 0) return 'skipped_legal_hold';

  const release = () =>
    prisma.cameraRecording.updateMany({ where: { id: rec.id }, data: { isArchived: false, archivedAt: null } });

  if (!rec.filePath || !fs.existsSync(rec.filePath)) {
    // Index row with no file on disk; archiving the row is all there is to do.
    return 'missing_file';
  }

  const src = path.resolve(rec.filePath);
  const rel = path.relative(dirs.recordingsDir, src);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    logger.warn({ recordingId: rec.id, filePath: src, recordingsDir: dirs.recordingsDir }, 'Recording file is outside RECORDINGS_DIR; refusing to move it');
    await release();
    return 'skipped_outside_root';
  }
  const dest = path.join(dirs.quarantineDir, rel);

  try {
    moveFile(src, dest);
  } catch (err) {
    logger.error({ err, recordingId: rec.id, filePath: src }, 'Failed to move recording to quarantine');
    await release();
    return 'error';
  }

  const after = await prisma.cameraRecording.findUnique({ where: { id: rec.id }, select: { legalHold: true } });
  if (after?.legalHold) {
    try {
      moveFile(dest, src);
      await release();
    } catch (err) {
      logger.error({ err, recordingId: rec.id, quarantinePath: dest }, 'Legal hold placed during cleanup; restore from quarantine failed — file is preserved in quarantine');
    }
    return 'skipped_legal_hold';
  }

  return 'moved';
}

export type DeleteOutcome = 'deleted' | 'skipped_legal_hold' | 'skipped_outside_root' | 'error';

/**
 * Deletes one recording permanently: its file (from quarantine when archived, else from its place)
 * and its index row. Re-checks Legal Hold right before touching the file.
 */
export async function deleteRecordingPermanently(
  rec: { id: string; filePath: string | null; isArchived: boolean },
  dirs: RecordingCleanupDirs,
): Promise<DeleteOutcome> {
  const prisma = getPrisma();
  const current = await prisma.cameraRecording.findFirst({ where: { id: rec.id, legalHold: false }, select: { id: true } });
  if (!current) return 'skipped_legal_hold';

  if (rec.filePath) {
    const original = path.resolve(rec.filePath);
    const rel = path.relative(dirs.recordingsDir, original);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      logger.warn({ recordingId: rec.id, filePath: original }, 'Recording file is outside RECORDINGS_DIR; refusing to delete it');
      return 'skipped_outside_root';
    }
    const target = rec.isArchived ? path.join(dirs.quarantineDir, rel) : original;
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (err) {
      logger.error({ err, recordingId: rec.id, filePath: target }, 'Failed to delete recording file');
      return 'error';
    }
  }
  const removed = await prisma.cameraRecording.deleteMany({ where: { id: rec.id, legalHold: false } });
  if (removed.count === 0) {
    // A hold arrived between the check and the delete: the row stays, the file is already gone.
    logger.error({ recordingId: rec.id }, 'Legal Hold placed while the recording was being deleted; file already removed');
    return 'skipped_legal_hold';
  }
  return 'deleted';
}

async function auditPermanentDeletion(reason: string, ids: string[], extra: Record<string, unknown> = {}) {
  if (ids.length === 0) return;
  await createAuditLog({
    action: 'recording_purge',
    entity: 'camera_recording',
    description: `${ids.length} recording segment(s) deleted permanently (${reason})`,
    metadata: { reason, count: ids.length, recordingIds: ids.slice(0, 200), truncated: ids.length > 200, ...extra },
  }).catch((err) => logger.error({ err, reason, count: ids.length }, 'Failed to write recording purge audit log'));
}

/**
 * Deletes quarantined recordings permanently once they have sat in quarantine for the purge period.
 */
export async function purgeQuarantinedRecordings(options?: {
  enabled?: boolean;
  dirs?: Partial<RecordingCleanupDirs>;
  purgeDays?: number;
  now?: Date;
}): Promise<{ enabled: boolean; deleted: number; skippedLegalHold: number; errors: number }> {
  const result = { enabled: options?.enabled ?? isRecordingCleanupEnabled(), deleted: 0, skippedLegalHold: 0, errors: 0 };
  if (!result.enabled) return result;
  const prisma = getPrisma();
  const dirs = getRecordingCleanupDirs(options?.dirs);
  const days = options?.purgeDays ?? getQuarantinePurgeDays();
  const cutoff = new Date((options?.now ?? new Date()).getTime() - days * 86_400_000);

  const due = await prisma.cameraRecording.findMany({
    where: { isArchived: true, legalHold: false, archivedAt: { lte: cutoff } },
    select: { id: true, filePath: true, isArchived: true },
    orderBy: { archivedAt: 'asc' },
    take: 500,
  });
  const deletedIds: string[] = [];
  for (const rec of due) {
    const outcome = await deleteRecordingPermanently(rec, dirs);
    if (outcome === 'deleted') deletedIds.push(rec.id);
    else if (outcome === 'skipped_legal_hold') result.skippedLegalHold++;
    else result.errors++;
  }
  result.deleted = deletedIds.length;
  await auditPermanentDeletion('quarantine_expired', deletedIds, { purgeDays: days });
  if (result.deleted || result.errors) logger.info(result, 'Quarantine purge completed');
  return result;
}

/**
 * Moves recordings older than their camera's retention period into quarantine, respecting Legal Hold.
 */
export async function sweepExpiredRecordings(options?: {
  defaultRetentionDays?: number;
  dirs?: Partial<RecordingCleanupDirs>;
  enabled?: boolean;
  now?: Date;
}): Promise<{ enabled: boolean; quarantined: number; missingFiles: number; errors: number; skippedLegalHold: number }> {
  const result = { enabled: options?.enabled ?? isRecordingCleanupEnabled(), quarantined: 0, missingFiles: 0, errors: 0, skippedLegalHold: 0 };
  if (!result.enabled) return result;

  const prisma = getPrisma();
  const dirs = getRecordingCleanupDirs(options?.dirs);
  const now = options?.now ?? new Date();

  try {
    // Retention period per camera: its policy, else the default policy, else RECORDING_RETENTION_DAYS.
    const defaultPolicy = await prisma.retentionPolicy.findFirst({ where: { isDefault: true }, select: { recordingRetentionDays: true } });
    const fallbackDays = options?.defaultRetentionDays ?? defaultPolicy?.recordingRetentionDays ?? getDefaultRecordingRetentionDays();
    const cameras = await prisma.camera.findMany({
      select: { id: true, retentionPolicy: { select: { recordingRetentionDays: true } } },
    });
    const byDays = new Map<number, string[]>();
    for (const cam of cameras) {
      const days = cam.retentionPolicy?.recordingRetentionDays ?? fallbackDays;
      byDays.set(days, [...(byDays.get(days) ?? []), cam.id]);
    }

    for (const [days, cameraIds] of byDays) {
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const expiredWhere = { cameraId: { in: cameraIds }, endTime: { lte: cutoff } };
      const expired = await prisma.cameraRecording.findMany({
        where: { legalHold: false, isArchived: false, ...expiredWhere },
        select: { id: true, filePath: true },
        orderBy: { startTime: 'asc' },
        take: 500,
      });
      for (const rec of expired) {
        const outcome = await quarantineRecording(rec, dirs);
        if (outcome === 'moved') result.quarantined++;
        else if (outcome === 'missing_file') result.missingFiles++;
        else if (outcome === 'skipped_legal_hold') result.skippedLegalHold++;
        else result.errors++;
      }
      result.skippedLegalHold += await prisma.cameraRecording.count({
        where: { legalHold: true, isArchived: false, ...expiredWhere },
      });
    }

    if (result.quarantined > 0 || result.missingFiles > 0 || result.errors > 0) {
      logger.info(result, 'Recording retention sweep completed');
    }
  } catch (err) {
    logger.error({ err }, 'Recording retention sweep query failed');
    result.errors++;
  }

  return result;
}

export interface DiskWatermarkResult {
  status: 'normal' | 'warning' | 'critical_cleanup_disabled' | 'emergency_eviction_completed' | 'emergency_eviction_ineffective' | 'monitor_error';
  usedPercent: number;
  totalBytes: number;
  freeBytes: number;
  evictedCount: number;
  bytesFreed: number;
  skippedLegalHold: number;
  dirPath: string;
}

export interface StatfsInfo {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

function readStatfs(dirPath: string): StatfsInfo {
  const stat = fs.statfsSync(dirPath);
  const totalBytes = Number(stat.blocks) * Number(stat.bsize);
  const freeBytes = Number(stat.bavail) * Number(stat.bsize);
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, freeBytes, usedPercent };
}

/** Stop evicting when this many consecutive deletions free no space (e.g. files already missing). */
const INEFFECTIVE_EVICTION_LIMIT = 10;

/**
 * Checks disk high-watermark for the CCTV recordings directory [ENH-03].
 * At the critical threshold, and only when cleanup is enabled, the oldest non-legal-hold
 * recordings are deleted permanently — quarantined ones first — until usage drops below the
 * warning threshold, so cameras can keep recording. Usage is re-measured after every deletion.
 */
export async function checkDiskHighWatermarkAndEvict(options?: {
  directoryPath?: string;
  quarantineDir?: string;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  targetRecoveryPercent?: number;
  enabled?: boolean;
  statfsProvider?: (dirPath: string) => Promise<StatfsInfo> | StatfsInfo;
}): Promise<DiskWatermarkResult> {
  const prisma = getPrisma();
  const dirs = getRecordingCleanupDirs({ recordingsDir: options?.directoryPath, quarantineDir: options?.quarantineDir });
  const dirPath = dirs.recordingsDir;
  const enabled = options?.enabled ?? isRecordingCleanupEnabled();
  const envWarn = process.env.DISK_WARNING_THRESHOLD_PCT ? parseInt(process.env.DISK_WARNING_THRESHOLD_PCT, 10) : 85;
  const envCrit = process.env.DISK_CRITICAL_THRESHOLD_PCT ? parseInt(process.env.DISK_CRITICAL_THRESHOLD_PCT, 10) : 92;
  const warnThreshold = options?.warningThresholdPercent ?? (Number.isFinite(envWarn) ? envWarn : 85);
  const critThreshold = options?.criticalThresholdPercent ?? (Number.isFinite(envCrit) ? envCrit : 92);
  const targetPercent = options?.targetRecoveryPercent ?? warnThreshold;
  const measure = async () => (options?.statfsProvider ? options.statfsProvider(dirPath) : readStatfs(dirPath));

  const base = { evictedCount: 0, bytesFreed: 0, skippedLegalHold: 0, dirPath };

  let diskInfo: StatfsInfo;
  try {
    // Never create the directory here: a missing mount must surface as an error, not as an empty healthy disk.
    if (!options?.statfsProvider && !fs.existsSync(dirPath)) {
      throw new Error(`Recordings directory does not exist: ${dirPath}`);
    }
    diskInfo = await measure();
  } catch (err: any) {
    logger.error({ err, dirPath }, 'Failed to read recordings disk usage');
    await createAlert({
      alertType: 'disk_space',
      severity: 'critical',
      source: 'disk_watermark_monitor',
      title: 'Recording Storage Monitor Error',
      message: `Cannot read disk usage for recordings directory ${dirPath}: ${err?.message ?? err}`,
      details: { dirPath },
      skipDedup: false,
    });
    return { status: 'monitor_error', usedPercent: 0, totalBytes: 0, freeBytes: 0, ...base };
  }

  const { totalBytes, freeBytes, usedPercent } = diskInfo;

  if (usedPercent < warnThreshold) {
    logger.debug({ usedPercent, warnThreshold }, 'Disk usage within normal operating range');
    return { status: 'normal', usedPercent, totalBytes, freeBytes, ...base };
  }

  if (usedPercent < critThreshold) {
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
    return { status: 'warning', usedPercent, totalBytes, freeBytes, ...base };
  }

  if (!enabled) {
    logger.error({ usedPercent, critThreshold, dirPath }, 'Recording disk critical but cleanup is disabled (RECORDINGS_CLEANUP_ENABLED != true)');
    await createAlert({
      alertType: 'disk_space',
      severity: 'critical',
      source: 'disk_watermark_monitor',
      title: 'Recording Storage Critical — Cleanup Disabled',
      message: `Recording disk usage is critical at ${usedPercent.toFixed(1)}% (Threshold: ${critThreshold}%). Automatic cleanup is disabled (RECORDINGS_CLEANUP_ENABLED is not true); free space manually.`,
      details: { usedPercent, critThreshold, totalBytes, freeBytes, dirPath },
      skipDedup: false,
    });
    return { status: 'critical_cleanup_disabled', usedPercent, totalBytes, freeBytes, ...base };
  }

  logger.warn({ usedPercent, critThreshold }, 'Disk usage critical — deleting oldest recordings');
  await createAlert({
    alertType: 'disk_space',
    severity: 'critical',
    source: 'disk_watermark_monitor',
    title: 'Emergency FIFO Eviction Triggered',
    message: `Recording disk usage is critical at ${usedPercent.toFixed(1)}% (Threshold: ${critThreshold}%). Deleting the oldest non-legal-hold recordings (quarantined first) until usage < ${targetPercent}%.`,
    details: { usedPercent, critThreshold, targetPercent, totalBytes, freeBytes, dirPath, quarantineDir: dirs.quarantineDir },
    skipDedup: true,
  });

  // Already-expired (quarantined) recordings go first, then the oldest live ones.
  const select = { id: true, filePath: true, isArchived: true } as const;
  const candidateRecordings = [
    ...(await prisma.cameraRecording.findMany({ where: { legalHold: false, isArchived: true }, select, orderBy: { startTime: 'asc' }, take: 500 })),
    ...(await prisma.cameraRecording.findMany({ where: { legalHold: false, isArchived: false }, select, orderBy: { startTime: 'asc' }, take: 500 })),
  ];
  const deletedIds: string[] = [];

  let current = diskInfo;
  let evictedCount = 0;
  let skippedLegalHold = 0;
  let movesWithoutGain = 0;
  let ineffective = false;

  for (const rec of candidateRecordings) {
    if (current.usedPercent < targetPercent) break;

    const outcome = await deleteRecordingPermanently(rec, dirs);
    if (outcome === 'skipped_legal_hold') skippedLegalHold++;
    if (outcome !== 'deleted') continue;

    evictedCount++;
    deletedIds.push(rec.id);
    const before = current.freeBytes;
    current = await measure();
    movesWithoutGain = current.freeBytes > before ? 0 : movesWithoutGain + 1;
    if (movesWithoutGain >= INEFFECTIVE_EVICTION_LIMIT) {
      ineffective = true;
      break;
    }
  }

  skippedLegalHold += await prisma.cameraRecording.count({ where: { legalHold: true } });
  const bytesFreed = Math.max(0, current.freeBytes - freeBytes);
  await auditPermanentDeletion('disk_critical', deletedIds, {
    usedPercentBefore: usedPercent,
    usedPercentAfter: current.usedPercent,
    criticalThresholdPercent: critThreshold,
  });

  if (ineffective || (evictedCount > 0 && current.freeBytes <= freeBytes)) {
    ineffective = true;
    await createAlert({
      alertType: 'disk_space',
      severity: 'critical',
      source: 'disk_watermark_monitor',
      title: 'Emergency Eviction Did Not Free Space',
      message: `Deleted ${evictedCount} recordings but usage is still ${current.usedPercent.toFixed(1)}%. Something other than recordings is filling ${dirPath}, or the remaining recordings are on Legal Hold.`,
      details: { evictedCount, usedPercent: current.usedPercent, dirPath },
      skipDedup: true,
    });
  }

  logger.warn(
    { evictedCount, bytesFreed, initialUsedPercent: usedPercent, finalUsedPercent: current.usedPercent, skippedLegalHold, ineffective },
    'Emergency recording deletion completed'
  );

  return {
    status: ineffective ? 'emergency_eviction_ineffective' : 'emergency_eviction_completed',
    usedPercent: current.usedPercent,
    totalBytes: current.totalBytes,
    freeBytes: current.freeBytes,
    evictedCount,
    bytesFreed,
    skippedLegalHold,
    dirPath,
  };
}
