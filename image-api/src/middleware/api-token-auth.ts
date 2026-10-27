import type { FastifyReply, FastifyRequest } from 'fastify';
import { validateApiToken } from '../modules/api-keys/api-keys.service.js';

export async function apiTokenAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.headers['x-api-token'] as string | undefined;
  if (!token) {
    reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing x-api-token header' });
    return;
  }

  const valid = await validateApiToken(token);
  if (!valid) {
    reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired API token' });
    return;
  }
}
