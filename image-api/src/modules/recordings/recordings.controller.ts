import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RecordingsService } from './recordings.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { requirePermission } from '../../middleware/rbac.js';

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
  const { cameraId, date } = request.body as { cameraId: string; date?: string };
  if (!cameraId) {
    return reply.status(400).send({ message: 'cameraId is required' });
  }
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  const count = await RecordingsService.seedDevRecordings(cameraId, dateStr);
  return reply.status(200).send({ message: `Seeded ${count} recording segments for ${dateStr}`, count });
}

export async function getPlaybackStreamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, timestamp } = request.query as { cameraId: string; timestamp?: string };
  if (!cameraId) {
    return reply.status(400).send({ message: 'cameraId is required' });
  }

  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { id: true, name: true, streamPath: true },
  });

  if (!camera) {
    return reply.status(404).send({ message: 'Camera not found' });
  }

  const streamPath = camera.streamPath ?? `ch1`;
  const user = (request as any).user;
  const token = MediaMtxService.generateStreamToken(streamPath, user?.username ?? 'viewer');
  const streamUrls = MediaMtxService.getStreamUrls(streamPath, token);

  return reply.status(200).send({
    ...streamUrls,
    playbackTimestamp: timestamp ?? new Date().toISOString(),
    hlsPlaybackUrl: timestamp ? `${streamUrls.hlsUrl}&start=${encodeURIComponent(timestamp)}` : streamUrls.hlsUrl,
  });
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
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    exportClipHandler,
  );
  app.get(
    '/clips',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getClipsHandler,
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

