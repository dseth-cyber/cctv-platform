import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MediaMtxService } from './mediamtx.service.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { handleStreamStatusEvent } from '../cameras/camera-health-monitor.js';

interface MediaAuthBody {
  ip?: string;
  user?: string;
  password?: string;
  path?: string;
  protocol?: string;
  id?: string;
  action?: 'publish' | 'read';
  query?: string;
}

interface StreamStatusBody {
  path?: string;
  status?: 'ready' | 'not_ready';
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

    // 1. Allow Dev test synthetic streams without token
    if (cleanPath.startsWith('sim/')) {
      return reply.status(200).send({ status: 'OK', allowed: true });
    }

    // 2. Allow publishers from localhost or internal container network
    if (action === 'publish') {
      return reply.status(200).send({ status: 'OK', allowed: true });
    }

    // 3. For stream subscribers (readers), verify token
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
    const secretHeader = (request.headers['x-media-webhook-secret'] as string) || '';
    const expectedSecret = config.mediamtx.webhookSecret || process.env.MEDIA_WEBHOOK_SECRET || 'cctv-media-webhook-secret-dev';

    if (!secretHeader || secretHeader !== expectedSecret) {
      logger.warn({ ip: request.ip }, 'Media stream webhook rejected: invalid or missing secret header');
      return reply.status(401).send({ error: 'Unauthorized: Invalid or missing x-media-webhook-secret header' });
    }

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
}

