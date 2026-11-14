import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAuditLog } from '../audit/audit.service.js';
import { cancelDeviceClip } from '../device-playback/device-playback.service.js';
import { defaultExportQueue } from './export-queue.js';
import { RecordingsService } from './recordings.service.js';
import { getQuarantinePurgeDays, getRecordingCleanupDirs } from '../retention-sweeper/retention-sweeper.service.js';

export class ClipCancelError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
    this.name = 'ClipCancelError';
  }
}

const IN_PROGRESS = ['QUEUED', 'PROCESSING'];
const SEES_ALL_CLIPS = ['admin', 'system'];

/**
 * Stops a clip still being made and removes it, as if it had not been asked for. The audit log keeps the
 * record. A row with no job behind it (the server restarted during the copy) is removed the same way.
 */
export async function cancelClip(clipId: string, user: { username?: string; role?: string }) {
  const prisma = getPrisma();
  const clip = await prisma.recordingClip.findUnique({ where: { id: clipId } });
  if (!clip) throw new ClipCancelError('NOT_FOUND', 404, 'Clip not found');
  if (!IN_PROGRESS.includes(clip.status)) throw new ClipCancelError('ALREADY_FINISHED', 409, 'This clip has already finished');
  if (clip.legalHold) throw new ClipCancelError('LEGAL_HOLD', 409, 'Release the legal hold on this clip first');
  if (clip.exportedBy !== user.username && !SEES_ALL_CLIPS.includes(user.role ?? '')) {
    throw new ClipCancelError('NOT_YOURS', 403, 'Only the person who asked for this clip can cancel it');
  }

  if (!(await defaultExportQueue.cancel(clipId))) await cancelDeviceClip(clipId);

  // It may have finished in the moment before it was stopped: then it is a clip like any other.
  const after = await prisma.recordingClip.findUnique({ where: { id: clipId } });
  if (after?.status === 'COMPLETED') throw new ClipCancelError('ALREADY_FINISHED', 409, 'This clip has already finished');

  await removeClipRowAndFile(clip);
  return clip;
}

/**
 * Removes a clip's row, and its file unless another clip still uses it (clips made before each had its own
 * file can share one). The legal hold is checked again in the delete itself, so a hold placed a moment ago wins.
 * Returns false when the hold won and nothing was removed.
 */
export async function removeClipRowAndFile(clip: { id: string; filePath: string | null }): Promise<boolean> {
  const prisma = getPrisma();
  const removed = await prisma.recordingClip.deleteMany({ where: { id: clip.id, legalHold: false } });
  if (removed.count === 0) return false;
  const sharedFile = clip.filePath ? await prisma.recordingClip.count({ where: { filePath: clip.filePath } }) : 0;
  if (clip.filePath && sharedFile === 0) {
    const fullPath = path.join(RecordingsService.getClipsDir(), path.basename(clip.filePath));
    fs.rmSync(fullPath, { force: true });
    fs.rmSync(`${fullPath}.partial`, { force: true });
  }
  return true;
}

type ClipUser = { username?: string; role?: string };

function mayManage(clip: { exportedBy: string | null }, user: ClipUser) {
  return clip.exportedBy === user.username || SEES_ALL_CLIPS.includes(user.role ?? '');
}

/** Where a clip's file waits while the clip is in the trash. */
export function clipQuarantineDir(): string {
  return path.join(getRecordingCleanupDirs().quarantineDir, 'clips');
}

function moveFile(src: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    if (fs.statSync(dest).size !== fs.statSync(src).size) {
      fs.rmSync(dest, { force: true });
      throw new Error(`Clip quarantine copy size mismatch for ${src}`);
    }
    fs.rmSync(src, { force: true });
  }
}

/**
 * Puts a finished clip in the trash: the row is claimed atomically on `legalHold = false` (a hold placed a moment
 * ago wins), then the file moves to quarantine. It can be restored until it is purged. If the file cannot be moved,
 * the claim is undone and the clip stays as it was. A file another clip also uses (older clips could share one)
 * stays where it is. The caller writes the audit log.
 */
export async function trashClip(clipId: string, user: ClipUser) {
  const prisma = getPrisma();
  const clip = await prisma.recordingClip.findUnique({ where: { id: clipId } });
  if (!clip || clip.deletedAt) throw new ClipCancelError('NOT_FOUND', 404, 'Clip not found');
  if (IN_PROGRESS.includes(clip.status)) throw new ClipCancelError('IN_PROGRESS', 409, 'This clip is still being made; cancel it instead');
  if (clip.legalHold) throw new ClipCancelError('LEGAL_HOLD', 409, 'Release the legal hold on this clip first');
  if (!mayManage(clip, user)) throw new ClipCancelError('NOT_YOURS', 403, 'Only the person who asked for this clip or an administrator can delete it');
  if (!(await moveClipToTrash(clip, user.username ?? 'unknown'))) throw new ClipCancelError('LEGAL_HOLD', 409, 'Release the legal hold on this clip first');
  return clip;
}

async function moveClipToTrash(clip: { id: string; filePath: string | null }, by: string): Promise<boolean> {
  const prisma = getPrisma();
  const claimed = await prisma.recordingClip.updateMany({ where: { id: clip.id, legalHold: false, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: by } });
  if (claimed.count === 0) return false;
  if (!clip.filePath) return true;
  const name = path.basename(clip.filePath);
  const src = path.join(RecordingsService.getClipsDir(), name);
  const shared = await prisma.recordingClip.count({ where: { filePath: clip.filePath, id: { not: clip.id } } });
  if (shared > 0 || !fs.existsSync(src)) return true;
  try {
    moveFile(src, path.join(clipQuarantineDir(), name));
  } catch (err) {
    await prisma.recordingClip.updateMany({ where: { id: clip.id }, data: { deletedAt: null, deletedBy: null } });
    throw err;
  }
  return true;
}

/** Takes a clip out of the trash: its file comes back from quarantine and it is a normal clip again. */
export async function restoreClip(clipId: string, user: ClipUser) {
  const prisma = getPrisma();
  const clip = await prisma.recordingClip.findUnique({ where: { id: clipId } });
  if (!clip || !clip.deletedAt) throw new ClipCancelError('NOT_FOUND', 404, 'This clip is not in the trash');
  if (!mayManage(clip, user)) throw new ClipCancelError('NOT_YOURS', 403, 'Only the person who asked for this clip or an administrator can restore it');
  if (clip.filePath) {
    const name = path.basename(clip.filePath);
    const parked = path.join(clipQuarantineDir(), name);
    const home = path.join(RecordingsService.getClipsDir(), name);
    if (fs.existsSync(parked) && !fs.existsSync(home)) moveFile(parked, home);
  }
  await prisma.recordingClip.update({ where: { id: clipId }, data: { deletedAt: null, deletedBy: null } });
  return clip;
}

/**
 * Daily (system-cleanup, 04:00): finished clips older than clips_retention_days go to the trash (deletedBy
 * `system:clips_retention_days`). 0 keeps them forever. Legal Hold and clips still being made are never touched.
 */
export async function deleteExpiredClips(days: number, now = new Date()): Promise<{ deleted: number; skippedLegalHold: number; errors: number }> {
  const result = { deleted: 0, skippedLegalHold: 0, errors: 0 };
  if (!Number.isFinite(days) || days <= 0) return result;
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const expired = { createdAt: { lt: cutoff }, status: { notIn: IN_PROGRESS }, deletedAt: null };
  const clips = await prisma.recordingClip.findMany({
    where: { ...expired, legalHold: false },
    select: { id: true, filePath: true, title: true, cameraId: true },
    orderBy: { createdAt: 'asc' },
    take: 1000,
  });
  const trashed: Array<{ id: string; title: string; cameraId: string }> = [];
  for (const clip of clips) {
    try {
      if (await moveClipToTrash(clip, 'system:clips_retention_days')) trashed.push({ id: clip.id, title: clip.title, cameraId: clip.cameraId });
      else result.skippedLegalHold++;
    } catch (err) {
      result.errors++;
      logger.error({ err, clipId: clip.id }, 'Could not move an expired clip to the trash');
    }
  }
  result.deleted = trashed.length;
  result.skippedLegalHold += await prisma.recordingClip.count({ where: { ...expired, legalHold: true } });
  if (trashed.length > 0) {
    await createAuditLog({
      action: 'clips_expired_trashed',
      entity: 'recording_clip',
      description: `${trashed.length} evidence clip(s) older than ${days} days moved to the trash (clips_retention_days)`,
      metadata: { days, cutoff: cutoff.toISOString(), clips: trashed.slice(0, 200) },
    });
  }
  return result;
}

/**
 * Daily: clips in the trash longer than RECORDINGS_QUARANTINE_PURGE_DAYS are deleted for good, row and file.
 * A clip put on Legal Hold while in the trash stays. One audit entry per run.
 */
export async function purgeTrashedClips(purgeDays = getQuarantinePurgeDays(), now = new Date()): Promise<{ purged: number; errors: number }> {
  const result = { purged: 0, errors: 0 };
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - purgeDays * 86_400_000);
  const clips = await prisma.recordingClip.findMany({
    where: { deletedAt: { lt: cutoff }, legalHold: false },
    select: { id: true, filePath: true, title: true, cameraId: true, sha256Hash: true },
    take: 1000,
  });
  const purged: Array<{ id: string; title: string; cameraId: string; sha256: string | null }> = [];
  for (const clip of clips) {
    try {
      const removed = await prisma.recordingClip.deleteMany({ where: { id: clip.id, legalHold: false, deletedAt: { not: null } } });
      if (removed.count === 0) continue;
      if (clip.filePath && (await prisma.recordingClip.count({ where: { filePath: clip.filePath } })) === 0) {
        const name = path.basename(clip.filePath);
        fs.rmSync(path.join(clipQuarantineDir(), name), { force: true });
        fs.rmSync(path.join(RecordingsService.getClipsDir(), name), { force: true });
      }
      purged.push({ id: clip.id, title: clip.title, cameraId: clip.cameraId, sha256: clip.sha256Hash });
    } catch (err) {
      result.errors++;
      logger.error({ err, clipId: clip.id }, 'Could not purge a clip from the trash');
    }
  }
  result.purged = purged.length;
  if (purged.length > 0) {
    await createAuditLog({
      action: 'clip_purge',
      entity: 'recording_clip',
      description: `${purged.length} evidence clip(s) deleted for good after ${purgeDays} days in the trash`,
      metadata: { purgeDays, cutoff: cutoff.toISOString(), clips: purged.slice(0, 200) },
    });
  }
  return result;
}
