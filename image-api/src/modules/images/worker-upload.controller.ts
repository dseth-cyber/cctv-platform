import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { workerUploadSchema } from './worker-upload.schema.js';
import { recordWorkerUpload } from './images.service.js';

async function workerUploadHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = workerUploadSchema.parse(request.body);
  const result = await recordWorkerUpload(input);
  return reply.status(201).send(result);
}

export async function workerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/worker-upload', workerUploadHandler);
}
