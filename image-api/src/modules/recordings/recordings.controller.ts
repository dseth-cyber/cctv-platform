import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import { RecordingsService } from './recordings.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { requirePermission } from '../../middleware/rbac.js';
import { config } from '../../config/index.js';

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
    const clip = await RecordingsService.exportClip({
      ...body,
      exportedBy: user?.username ?? 'operator',
    });
    return reply.status(201).send(clip);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failed to export clip' });
  }
}

export async function getClipsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, incidentId } = request.query as { cameraId?: string; incidentId?: string };
  const clips = await RecordingsService.getClips(cameraId, incidentId);
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
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(clipInfo.filename)}"`);
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
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getTimelineHandler,
  );
  app.get(
    '/segments',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getSegmentsHandler,
  );
  app.post(
    '/clips',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    exportClipHandler,
  );
  app.get(
    '/clips',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getClipsHandler,
  );
  app.get(
    '/clips/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getClipByIdHandler,
  );
  app.get(
    '/clips/download/:filename',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    downloadClipHandler,
  );

  app.patch(
    '/segments/:id/legal-hold',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    toggleSegmentLegalHoldHandler,
  );
  app.patch(
    '/clips/:id/legal-hold',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    toggleClipLegalHoldHandler,
  );
  app.post(
    '/seed-dev',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    seedDevRecordingsHandler,
  );
  app.get(
    '/playback-stream',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getPlaybackStreamHandler,
  );
}

