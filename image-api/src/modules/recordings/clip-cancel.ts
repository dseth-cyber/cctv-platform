import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
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

  if (clip.filePath) {
    const fullPath = path.join(RecordingsService.getClipsDir(), path.basename(clip.filePath));
    fs.rmSync(fullPath, { force: true });
    fs.rmSync(`${fullPath}.partial`, { force: true });
  }
  await prisma.recordingClip.deleteMany({ where: { id: clipId } });
  return clip;
}
