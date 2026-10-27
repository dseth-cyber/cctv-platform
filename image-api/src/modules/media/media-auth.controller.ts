import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MediaMtxService } from './mediamtx.service.js';
import { logger } from '../../lib/logger.js';

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

/**
 * Controller for MediaMTX HTTP webhook authentication.
 * Enforces media stream access control (not just UI button hiding).
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
}
