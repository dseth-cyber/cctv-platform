import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAuditLog } from '../audit/audit.service.js';
import { cancelDeviceClip } from '../device-playback/device-playback.service.js';
import { defaultExportQueue } from './export-queue.js';
import { RecordingsService } from './recordings.service.js';

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

/**
 * Deletes a clip: one still being made is cancelled (cancelClip), a finished one is removed with its file.
 * Same rules either way: a clip on Legal Hold stays, and only the person who asked for it or an administrator
 * may remove it. The caller writes the audit log (`cancelled` tells which of the two happened).
 */
export async function deleteClip(clipId: string, user: { username?: string; role?: string }) {
  const prisma = getPrisma();
  const clip = await prisma.recordingClip.findUnique({ where: { id: clipId } });
  if (!clip) throw new ClipCancelError('NOT_FOUND', 404, 'Clip not found');
  if (IN_PROGRESS.includes(clip.status)) return { clip: await cancelClip(clipId, user), cancelled: true };
  if (clip.legalHold) throw new ClipCancelError('LEGAL_HOLD', 409, 'Release the legal hold on this clip first');
  if (clip.exportedBy !== user.username && !SEES_ALL_CLIPS.includes(user.role ?? '')) {
    throw new ClipCancelError('NOT_YOURS', 403, 'Only the person who asked for this clip or an administrator can delete it');
  }
  if (!(await removeClipRowAndFile(clip))) throw new ClipCancelError('LEGAL_HOLD', 409, 'Release the legal hold on this clip first');
  return { clip, cancelled: false };
}

/**
 * Daily (system-cleanup, 04:00): finished clips older than clips_retention_days are deleted with their files.
 * 0 keeps them forever. Clips on Legal Hold and clips still being made are never touched. One audit entry per run.
 */
export async function deleteExpiredClips(days: number, now = new Date()): Promise<{ deleted: number; skippedLegalHold: number; errors: number }> {
  const result = { deleted: 0, skippedLegalHold: 0, errors: 0 };
  if (!Number.isFinite(days) || days <= 0) return result;
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const expired = { createdAt: { lt: cutoff }, status: { notIn: IN_PROGRESS } };
  const clips = await prisma.recordingClip.findMany({
    where: { ...expired, legalHold: false },
    select: { id: true, filePath: true, title: true, cameraId: true, fileSizeBytes: true },
    orderBy: { createdAt: 'asc' },
    take: 1000,
  });
  const deleted: Array<{ id: string; title: string; cameraId: string }> = [];
  for (const clip of clips) {
    try {
      if (await removeClipRowAndFile(clip)) deleted.push({ id: clip.id, title: clip.title, cameraId: clip.cameraId });
      else result.skippedLegalHold++;
    } catch (err) {
      result.errors++;
      logger.error({ err, clipId: clip.id }, 'Could not delete an expired clip');
    }
  }
  result.deleted = deleted.length;
  result.skippedLegalHold += await prisma.recordingClip.count({ where: { ...expired, legalHold: true } });
  if (deleted.length > 0) {
    await createAuditLog({
      action: 'clips_expired_deleted',
      entity: 'recording_clip',
      description: `${deleted.length} evidence clip(s) older than ${days} days deleted (clips_retention_days)`,
      metadata: { days, cutoff: cutoff.toISOString(), clips: deleted.slice(0, 200) },
    });
  }
  return result;
}
