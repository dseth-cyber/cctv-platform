import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  closePlaybackSession,
  getDeviceTimeline,
  openPlaybackSession,
  PlaybackError,
  startDeviceClip,
} from './device-playback.service.js';
import { FAST_SPEEDS } from './fast-playback-proxy.js';

const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const wallTime = z.string().regex(WALL_TIME).refine((v) => !Number.isNaN(new Date(`${v}Z`).getTime()));

const timelineSchema = z.object({ cameraId: z.guid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const sessionSchema = z.object({
  cameraId: z.guid(),
  start: wallTime,
  canPlayH265: z.boolean(),
  speed: z.number().refine((n) => n === 1 || (FAST_SPEEDS as readonly number[]).includes(n)).optional(),
});
const clipSchema = z.object({
  cameraId: z.guid(),
  start: wallTime,
  end: wallTime,
  title: z.string().trim().min(1).max(256),
  incidentId: z.guid().optional(),
  legalHold: z.boolean().optional(),
});

const userIdOf = (request: FastifyRequest) => {
  const user = (request as any).user;
  return String(user?.id ?? user?.username ?? 'viewer');
};

async function respond(reply: FastifyReply, work: () => Promise<unknown>, okStatus = 200) {
  try {
    return reply.status(okStatus).send(await work());
  } catch (err) {
    if (err instanceof PlaybackError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, error: err.code, message: err.message, details: { code: err.code, ...err.details } });
    }
    throw err;
  }
}

/** Recordings on a DVR/NVR's own HDD: the server only reads them, and keeps nothing unless a clip is asked for. */
export async function devicePlaybackRoutes(app: FastifyInstance) {
  app.get('/timeline', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, async (request, reply) => {
    const { cameraId, date } = timelineSchema.parse(request.query);
    return respond(reply, () => getDeviceTimeline(cameraId, date));
  });

  app.post('/sessions', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, async (request, reply) => {
    const input = sessionSchema.parse(request.body);
    return respond(reply, () => openPlaybackSession(userIdOf(request), input), 201);
  });

  app.delete('/sessions/:id', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await closePlaybackSession(id, userIdOf(request));
    return reply.status(204).send();
  });

  // The same permission as exporting a clip from the server's own recordings.
  app.post('/clips', { preHandler: [app.authenticate, requirePermission('cameras:create')] }, async (request, reply) => {
    const input = clipSchema.parse(request.body);
    const user = (request as any).user;
    return respond(reply, () => startDeviceClip(user?.username ?? 'operator', input), 202);
  });
}
