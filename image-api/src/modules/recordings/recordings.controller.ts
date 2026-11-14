import { cameraWhere, guardAllCameras, guardCameraBody, guardCameraQuery, guardClipFilename, guardClipParam, guardSegmentParam } from '../access/camera-scope.js';
import { cameraOfClip, viewLogHook } from '../access/sensitive-view.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import { RecordingsService } from './recordings.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { requirePermission } from '../../middleware/rbac.js';
import { config } from '../../config/index.js';
import { ClipCancelError, deleteClip } from './clip-cancel.js';
import { clipDownloadName } from './clip-download-name.js';
import { createAuditLog } from '../audit/audit.service.js';

export async function getTimelineHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, date } = request.query as { cameraId: string; date?: string };
  if (!cameraId) {
    return reply.status(400).send({ message: 'cameraId is required' });
  }

  try {
    const timeline = await RecordingsService.getTimelineAvailability(cameraId, date);
    return reply.status(200).send(timeline);
  } catch (err: any) {
    return reply.status(404).send({ message: err?.message || 'Error fetching timeline' });
  }
}

export async function getSegmentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, from, to, limit } = request.query as { cameraId: string; from?: string; to?: string; limit?: string };
  if (!cameraId) {
    return reply.status(400).send({ message: 'cameraId is required' });
  }

  const parsedLimit = limit ? parseInt(limit, 10) : 100;
  const segments = await RecordingsService.getSegments(cameraId, from, to, parsedLimit);
  return reply.status(200).send({ items: segments });
}

export async function exportClipHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  const body = request.body as {
    cameraId: string;
    incidentId?: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    preBufferSeconds?: number;
    postBufferSeconds?: number;
    legalHold?: boolean;
  };

  if (!body.cameraId || !body.startTime || !body.endTime) {
    return reply.status(400).send({ message: 'cameraId, startTime, and endTime are required' });
  }

  try {
    // Long clips take minutes, so the export runs in the background; the client polls the clip status.
    const clip = await RecordingsService.exportClip(
      { ...body, exportedBy: user?.username ?? 'operator' },
      { asyncProcess: true },
    );
    return reply.status(202).send(clip);
  } catch (err: any) {
    const status = err?.statusCode === 400 ? 400 : 500;
    return reply.status(status).send({ message: err?.message || 'Failed to export clip' });
  }
}

export async function getCoverageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, start, end } = request.query as { cameraId?: string; start?: string; end?: string };
  const from = new Date(start ?? '');
  const to = new Date(end ?? '');
  if (!cameraId || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return reply.status(400).send({ message: 'cameraId, start and end (after start) are required' });
  }
  const coverage = await RecordingsService.getCoverage(cameraId, from, to);
  return reply.status(200).send({ ...coverage, maxExportHours: config.cctv.maxExportHours });
}

export async function createDownloadLinkHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const clip = await RecordingsService.getClipById(id);
  if (!clip) return reply.status(404).send({ message: 'Clip not found' });
  if (clip.status !== 'COMPLETED' || !clip.downloadUrl) {
    return reply.status(409).send({ message: 'Clip is not ready for download' });
  }
  const filename = String(clip.downloadUrl).split('/').pop()!;
  const username = user?.username ?? 'unknown';
  await RecordingsService.recordDownloadIssued(id, username);
  const token = RecordingsService.createDownloadToken(filename, username);
  return reply.status(200).send({ filename, path: `/recordings/clips/file/${encodeURIComponent(filename)}?dl=${encodeURIComponent(token)}` });
}

/** Streams a clip for a signed link (no bearer header: the browser downloads it directly). */
export async function downloadClipByLinkHandler(request: FastifyRequest, reply: FastifyReply) {
  const { filename } = request.params as { filename: string };
  const { dl } = request.query as { dl?: string };
  const username = RecordingsService.verifyDownloadToken(filename, dl ?? '');
  if (!username) return reply.status(403).send({ message: 'Download link is invalid or expired' });
  return downloadClipHandler(request, reply);
}

/**
 * Removes a clip: one still being made is cancelled, a finished one is deleted with its file.
 * Never a clip on Legal Hold; only the person who asked for it or an administrator.
 */
export async function cancelClipHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  try {
    const { clip, cancelled } = await deleteClip(id, { username: user?.username, role: user?.role });
    await createAuditLog({
      userId: user?.id,
      action: cancelled ? 'clip_export_cancelled' : 'clip_deleted',
      entity: 'recording_clip',
      entityId: id,
      description: cancelled
        ? `Clip export "${clip.title}" cancelled by ${user?.username ?? 'unknown'}`
        : `Evidence clip "${clip.title}" deleted by ${user?.username ?? 'unknown'}`,
      metadata: { cameraId: clip.cameraId, startTime: clip.startTime, endTime: clip.endTime, exportedBy: clip.exportedBy, wasStatus: clip.status, sha256: clip.sha256Hash, fileSizeBytes: clip.fileSizeBytes?.toString() ?? null },
      ipAddress: request.ip,
    });
    return reply.status(204).send();
  } catch (err) {
    if (err instanceof ClipCancelError) return reply.status(err.statusCode).send({ message: err.message, details: { code: err.code } });
    throw err;
  }
}

export async function getClipsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, incidentId } = request.query as { cameraId?: string; incidentId?: string };
  const clips = await RecordingsService.getClips(cameraId, incidentId, await cameraWhere(request));
  return reply.status(200).send({ items: clips });
}

export async function getClipByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const clip = await RecordingsService.getClipById(id);
  if (!clip) {
    return reply.status(404).send({ message: 'Clip not found' });
  }
  return reply.status(200).send(clip);
}

export async function toggleSegmentLegalHoldHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { legalHold } = request.body as { legalHold: boolean };
  const result = await RecordingsService.toggleSegmentLegalHold(id, !!legalHold);
  return reply.status(200).send(result);
}

export async function toggleClipLegalHoldHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { legalHold } = request.body as { legalHold: boolean };
  const result = await RecordingsService.toggleClipLegalHold(id, !!legalHold);
  return reply.status(200).send(result);
}

export async function seedDevRecordingsHandler(request: FastifyRequest, reply: FastifyReply) {
  // Synthetic segments are indistinguishable from evidence in the index, so this stays off unless explicitly enabled in Dev.
  if (process.env.SEED_SYNTHETIC_RECORDINGS !== 'true' || process.env.NODE_ENV === 'production') {
    return reply.status(403).send({ message: 'Synthetic recording seeding is disabled (set SEED_SYNTHETIC_RECORDINGS=true in Dev only)' });
  }
  const { cameraId, date } = request.body as { cameraId: string; date?: string };
  if (!cameraId) {
    return reply.status(400).send({ message: 'cameraId is required' });
  }
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  const count = await RecordingsService.seedDevRecordings(cameraId, dateStr);
  return reply.status(200).send({ message: `Seeded ${count} recording segments for ${dateStr}`, count });
}

const MAX_PLAYBACK_SECONDS = 3600;

export async function getPlaybackStreamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, start, duration } = request.query as { cameraId?: string; start?: string; duration?: string };
  if (!cameraId || !start) {
    return reply.status(400).send({ message: 'cameraId and start are required' });
  }
  const startTime = new Date(start);
  const durationSeconds = duration ? Number(duration) : 300;
  if (Number.isNaN(startTime.getTime()) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_PLAYBACK_SECONDS) {
    return reply.status(400).send({ message: `start must be an ISO time and duration 1-${MAX_PLAYBACK_SECONDS} seconds` });
  }

  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, name: true, streamPath: true },
  });
  if (!camera?.streamPath) {
    return reply.status(404).send({ message: 'Camera not found or has no stream path' });
  }

  // Only hand out a playback URL for time that is actually recorded on disk.
  const windowEnd = new Date(startTime.getTime() + durationSeconds * 1000);
  const segments = await prisma.cameraRecording.findMany({
    where: { cameraId, startTime: { lt: windowEnd }, endTime: { gt: startTime } },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, endTime: true },
  });
  if (segments.length === 0) {
    return reply.status(404).send({ message: 'No recording exists for the requested time' });
  }

  // MediaMTX playback starts at the first recorded instant inside the window.
  const playFrom = segments[0].startTime > startTime ? segments[0].startTime : startTime;
  const lastEnd = segments[segments.length - 1].endTime;
  const playUntil = lastEnd < windowEnd ? lastEnd : windowEnd;
  const playSeconds = Math.max(1, Math.round((playUntil.getTime() - playFrom.getTime()) / 1000));

  const user = (request as any).user;
  const token = MediaMtxService.generateStreamToken(camera.streamPath, user?.username ?? 'viewer', 3600);
  const params = new URLSearchParams({
    path: camera.streamPath,
    start: playFrom.toISOString(),
    duration: String(playSeconds),
    format: 'mp4',
    token,
  });

  return reply.status(200).send({
    cameraId: camera.id,
    streamPath: camera.streamPath,
    start: playFrom.toISOString(),
    durationSeconds: playSeconds,
    segmentsCount: segments.length,
    playbackUrl: `${config.mediamtx.playbackUrl.replace(/\/+$/, '')}/get?${params.toString()}`,
  });
}

export async function downloadClipHandler(request: FastifyRequest, reply: FastifyReply) {
  const { filename } = request.params as { filename: string };
  try {
    const clipInfo = RecordingsService.getClipFilePath(filename);
    if (!clipInfo.exists) {
      return reply.status(404).send({ message: 'Clip file not found' });
    }
    const stat = fs.statSync(clipInfo.fullPath);
    reply.header('Content-Type', 'video/mp4');
    const clip = await getPrisma().recordingClip.findFirst({ where: { filePath: `/recordings/clips/${clipInfo.filename}` }, select: { title: true } });
    const downloadName = clipDownloadName(clip?.title, clipInfo.filename);
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(clipInfo.filename)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    reply.header('Content-Length', stat.size);
    const stream = fs.createReadStream(clipInfo.fullPath);
    return reply.send(stream);
  } catch (err: any) {
    return reply.status(400).send({ message: err?.message || 'Invalid filename' });
  }
}

export async function recordingsRoutes(app: FastifyInstance) {
  app.get(
    '/timeline',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view'), guardCameraQuery()] },
    getTimelineHandler,
  );
  app.get(
    '/segments',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view'), guardCameraQuery()] },
    getSegmentsHandler,
  );
  app.post(
    '/clips',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('clips:export'), guardCameraBody()], onResponse: [viewLogHook('clip_export', (r) => (r.body as any)?.cameraId, (r) => ({ start: (r.body as any)?.startTime, end: (r.body as any)?.endTime }))] },
    exportClipHandler,
  );
  app.get(
    '/clips',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view')] },
    getClipsHandler,
  );
  app.delete(
    '/clips/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('clips:export'), guardClipParam()] },
    cancelClipHandler,
  );
  app.get(
    '/clips/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view'), guardClipParam()] },
    getClipByIdHandler,
  );
  app.get(
    '/coverage',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view'), guardCameraQuery()] },
    getCoverageHandler,
  );
  app.post(
    '/clips/:id/download-link',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('clips:export'), guardClipParam()], onResponse: [viewLogHook('clip_download', (r) => cameraOfClip({ id: (r.params as any).id }), (r) => ({ clip: (r.params as any).id }))] },
    createDownloadLinkHandler,
  );
  // Authorized by the signed `dl` token issued above, not by a bearer header.
  app.get('/clips/file/:filename', downloadClipByLinkHandler);
  app.get(
    '/clips/download/:filename',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('clips:export'), guardClipFilename], onResponse: [viewLogHook('clip_download', (r) => cameraOfClip({ filename: (r.params as any).filename }), (r) => ({ file: (r.params as any).filename }))] },
    downloadClipHandler,
  );

  app.patch(
    '/segments/:id/legal-hold',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardSegmentParam()] },
    toggleSegmentLegalHoldHandler,
  );
  app.patch(
    '/clips/:id/legal-hold',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardClipParam()] },
    toggleClipLegalHoldHandler,
  );
  app.post(
    '/seed-dev',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    seedDevRecordingsHandler,
  );
  app.get(
    '/playback-stream',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('playback:view'), guardCameraQuery()], onResponse: [viewLogHook('playback', (r) => (r.query as any).cameraId, (r) => ({ start: (r.query as any).start }))] },
    getPlaybackStreamHandler,
  );
}

