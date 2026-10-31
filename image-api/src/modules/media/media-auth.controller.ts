import crypto from 'node:crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MediaMtxService } from './mediamtx.service.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { handleStreamStatusEvent } from '../cameras/camera-health-monitor.js';
import { indexSegment, resolveSegmentPath } from '../recordings/segment-indexer.js';

interface MediaAuthBody {
  ip?: string;
  user?: string;
  password?: string;
  path?: string;
  protocol?: string;
  id?: string;
  action?: 'publish' | 'read' | 'playback' | 'api' | 'metrics' | 'pprof';
  query?: string;
}

interface SegmentCompleteBody {
  path?: string;
  segmentPath?: string;
}

interface StreamStatusBody {
  path?: string;
  status?: 'ready' | 'not_ready';
}

/** User name image-api presents to the MediaMTX control API (password = MEDIA_WEBHOOK_SECRET). */
export const MEDIAMTX_API_USER = 'image-api';

function secretMatches(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Controller for MediaMTX HTTP webhook authentication and stream status events.
 * Enforces media stream access control and real-time health webhook integration.
 */
export async function mediaAuthRoutes(app: FastifyInstance) {
  app.post('/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as MediaAuthBody;
    const { action = 'read', path = '', query = '', ip } = body;

    const cleanPath = path.replace(/^\/+/, '');

    // 1. Cameras are pulled by MediaMTX (path `source:`), so the only legitimate publisher is a
    // process inside the MediaMTX container (the sim/ test generators). Anyone else publishing
    // could replace a camera's live feed.
    if (action === 'publish') {
      if (isLoopback(ip)) {
        return reply.status(200).send({ status: 'OK', allowed: true });
      }
      logger.warn({ path: cleanPath, ip }, 'Media publish rejected (non-loopback publisher)');
      return reply.status(401).send({ status: 'Unauthorized', allowed: false });
    }

    // 2. The control API, metrics and pprof are for image-api only, which signs in with the shared secret.
    if (action === 'api' || action === 'metrics' || action === 'pprof') {
      if (body.user === MEDIAMTX_API_USER && secretMatches(body.password, config.mediamtx.webhookSecret)) {
        return reply.status(200).send({ status: 'OK', allowed: true });
      }
      logger.warn({ ip, action }, 'MediaMTX control API access rejected');
      return reply.status(401).send({ status: 'Unauthorized', allowed: false });
    }

    // 3. Allow Dev test synthetic streams without token
    if (cleanPath.startsWith('sim/')) {
      return reply.status(200).send({ status: 'OK', allowed: true });
    }

    // 4. For stream subscribers (readers, playback), verify token
    let token = '';
    if (query) {
      const parsed = new URLSearchParams(query);
      token = parsed.get('token') || '';
    }
    if (!token && body.password) {
      token = body.password;
    }

    // Check token validity
    const isValid = MediaMtxService.verifyStreamToken(cleanPath, token);

    if (isValid) {
      logger.debug({ path: cleanPath, ip }, 'Media stream authorization granted');
      return reply.status(200).send({ status: 'OK', allowed: true });
    }

    logger.warn({ path: cleanPath, ip, action }, 'Media stream authorization rejected (invalid or missing token)');
    return reply.status(403).send({ error: 'Forbidden: Invalid or expired stream token' });
  });

  /**
   * Real-time MediaMTX stream status webhook (< 3s detection) [ENH-01].
   * Gated by x-media-webhook-secret header.
   */
  app.post('/events/stream-status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!webhookAuthorized(request, reply)) return reply;

    const body = (request.body || {}) as StreamStatusBody;
    const { path: streamPath, status } = body;

    if (!streamPath || !status || !['ready', 'not_ready'].includes(status)) {
      return reply.status(400).send({ error: 'Bad Request: path and valid status ("ready" | "not_ready") are required' });
    }

    try {
      const result = await handleStreamStatusEvent(streamPath, status);
      return reply.status(200).send(result);
    } catch (err: any) {
      logger.error({ err, path: streamPath, status }, 'Failed to process media webhook event');
      return reply.status(500).send({ error: 'Internal Server Error processing stream status event' });
    }
  });

  /**
   * MediaMTX runOnRecordSegmentComplete hook: adds the finished segment to the recording index.
   * Gated by x-media-webhook-secret header.
   */
  app.post('/events/segment-complete', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!webhookAuthorized(request, reply)) return reply;

    const { path: streamPath, segmentPath } = (request.body || {}) as SegmentCompleteBody;
    if (!streamPath || !segmentPath) {
      return reply.status(400).send({ error: 'Bad Request: path and segmentPath are required' });
    }

    let filePath: string;
    try {
      filePath = resolveSegmentPath(segmentPath);
    } catch (err: any) {
      logger.warn({ path: streamPath, segmentPath }, 'Segment webhook rejected: invalid segment path');
      return reply.status(400).send({ error: err.message });
    }

    try {
      const result = await indexSegment(streamPath, filePath, true);
      return reply.status(200).send(result);
    } catch (err: any) {
      logger.error({ err, path: streamPath, filePath }, 'Failed to index recording segment from webhook');
      return reply.status(500).send({ error: 'Failed to index recording segment' });
    }
  });
}

function webhookAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  const secretHeader = (request.headers['x-media-webhook-secret'] as string) || '';
  if (secretHeader && secretMatches(secretHeader, config.mediamtx.webhookSecret)) return true;
  logger.warn({ ip: request.ip, url: request.url }, 'Media webhook rejected: invalid or missing secret header');
  reply.status(401).send({ error: 'Unauthorized: Invalid or missing x-media-webhook-secret header' });
  return false;
}
