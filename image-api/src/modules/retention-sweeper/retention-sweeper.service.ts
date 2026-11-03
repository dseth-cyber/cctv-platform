import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';

// ── CCTV recording cleanup [R1.6] ──────────────────────────────────────────────
// AGENTS.md forbids permanent deletion and requires an approved retention policy
// before cleanup runs, so recording cleanup is opt-in (RECORDINGS_CLEANUP_ENABLED)
// and moves segments into a recoverable quarantine directory instead of unlinking.
// Purging the quarantine is a separate, explicitly approved operation.

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
  await getPrisma().cameraRecording.updateMany({ where: { id: rec.id }, data: { isArchived: false } });
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
    data: { isArchived: true },
  });
  if (claim.count === 0) return 'skipped_legal_hold';

  const release = () =>
    prisma.cameraRecording.updateMany({ where: { id: rec.id }, data: { isArchived: false } });

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

/**
 * Archives expired CCTV recording segments into quarantine while strictly respecting Legal Hold.
 */
export async function sweepExpiredRecordings(options?: {
  defaultRetentionDays?: number;
  dirs?: Partial<RecordingCleanupDirs>;
  enabled?: boolean;
}): Promise<{ enabled: boolean; quarantined: number; missingFiles: number; errors: number; skippedLegalHold: number }> {
  const result = { enabled: options?.enabled ?? isRecordingCleanupEnabled(), quarantined: 0, missingFiles: 0, errors: 0, skippedLegalHold: 0 };
  if (!result.enabled) return result;

  const prisma = getPrisma();
  const dirs = getRecordingCleanupDirs(options?.dirs);
  const retentionDays = options?.defaultRetentionDays ?? 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const now = new Date();
  const expiredWhere = {
    OR: [
      { retentionUntil: { lte: now } },
      { createdAt: { lte: cutoffDate } },
    ],
  };

  try {
    const expiredRecordings = await prisma.cameraRecording.findMany({
      where: { legalHold: false, isArchived: false, ...expiredWhere },
      select: { id: true, filePath: true },
      orderBy: { startTime: 'asc' },
      take: 500,
    });

    for (const rec of expiredRecordings) {
      const outcome = await quarantineRecording(rec, dirs);
      if (outcome === 'moved') result.quarantined++;
      else if (outcome === 'missing_file') result.missingFiles++;
      else if (outcome === 'skipped_legal_hold') result.skippedLegalHold++;
      else result.errors++;
    }

    result.skippedLegalHold += await prisma.cameraRecording.count({
      where: { legalHold: true, isArchived: false, ...expiredWhere },
    });

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

/** Stop evicting when this many consecutive moves free no space (quarantine on the same filesystem). */
const INEFFECTIVE_EVICTION_LIMIT = 10;

/**
 * Checks disk high-watermark for the CCTV recordings directory [ENH-03].
 * At the critical threshold, and only when cleanup is enabled, the oldest non-legal-hold
 * segments are moved to quarantine until usage drops below the warning threshold.
 * Usage is re-measured from the filesystem after every move rather than estimated from DB sizes.
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
      message: `Recording disk usage is critical at ${usedPercent.toFixed(1)}% (Threshold: ${critThreshold}%). Automatic cleanup is disabled pending an approved retention policy; free space manually.`,
      details: { usedPercent, critThreshold, totalBytes, freeBytes, dirPath },
      skipDedup: false,
    });
    return { status: 'critical_cleanup_disabled', usedPercent, totalBytes, freeBytes, ...base };
  }

  logger.warn({ usedPercent, critThreshold }, 'Disk usage critical — initiating emergency FIFO eviction to quarantine');
  await createAlert({
    alertType: 'disk_space',
    severity: 'critical',
    source: 'disk_watermark_monitor',
    title: 'Emergency FIFO Eviction Triggered',
    message: `Recording disk usage is critical at ${usedPercent.toFixed(1)}% (Threshold: ${critThreshold}%). Moving oldest non-legal-hold recordings to quarantine until usage < ${targetPercent}%.`,
    details: { usedPercent, critThreshold, targetPercent, totalBytes, freeBytes, dirPath, quarantineDir: dirs.quarantineDir },
    skipDedup: true,
  });

  const candidateRecordings = await prisma.cameraRecording.findMany({
    where: { legalHold: false, isArchived: false },
    select: { id: true, filePath: true },
    orderBy: { startTime: 'asc' },
    take: 500,
  });

  let current = diskInfo;
  let evictedCount = 0;
  let skippedLegalHold = 0;
  let movesWithoutGain = 0;
  let ineffective = false;

  for (const rec of candidateRecordings) {
    if (current.usedPercent < targetPercent) break;

    const outcome = await quarantineRecording(rec, dirs);
    if (outcome === 'skipped_legal_hold') skippedLegalHold++;
    if (outcome !== 'moved') continue;

    evictedCount++;
    const before = current.freeBytes;
    current = await measure();
    movesWithoutGain = current.freeBytes > before ? 0 : movesWithoutGain + 1;
    if (movesWithoutGain >= INEFFECTIVE_EVICTION_LIMIT) {
      ineffective = true;
      break;
    }
  }

  skippedLegalHold += await prisma.cameraRecording.count({ where: { legalHold: true, isArchived: false } });
  const bytesFreed = Math.max(0, current.freeBytes - freeBytes);

  if (ineffective || (evictedCount > 0 && current.freeBytes <= freeBytes)) {
    ineffective = true;
    await createAlert({
      alertType: 'disk_space',
      severity: 'critical',
      source: 'disk_watermark_monitor',
      title: 'Emergency Eviction Did Not Free Space',
      message: `Moved ${evictedCount} recordings to quarantine but usage is still ${current.usedPercent.toFixed(1)}%. Quarantine (${dirs.quarantineDir}) is likely on the same filesystem; purge or relocate it after approval.`,
      details: { evictedCount, usedPercent: current.usedPercent, dirPath, quarantineDir: dirs.quarantineDir },
      skipDedup: true,
    });
  }

  logger.warn(
    { evictedCount, bytesFreed, initialUsedPercent: usedPercent, finalUsedPercent: current.usedPercent, skippedLegalHold, ineffective },
    'Emergency FIFO eviction completed'
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
