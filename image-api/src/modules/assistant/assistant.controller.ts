import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac.js';
import { answer } from './assistant.service.js';

const askSchema = z.object({ text: z.string().trim().max(300), lang: z.string().max(8).optional() });

async function askHandler(request: FastifyRequest, reply: FastifyReply) {
  const { text, lang } = askSchema.parse(request.body);
  // Answers are written in Thai and English; other languages get English.
  return reply.send(await answer(request, text, lang === 'th' ? 'th' : 'en'));
}

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  // Read-only: it only reads data the asker may already see.
  app.post('/ask', { preHandler: [app.authenticate, requirePermission('cameras:read')], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, askHandler);
}
