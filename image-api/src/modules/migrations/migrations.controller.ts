import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createMigrationSchema, migrationQuerySchema } from './migrations.schema.js';
import * as migrationEngine from '../../lib/storage/migration-engine.js';
import { requirePermission } from '../../middleware/rbac.js';

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const filters = migrationQuerySchema.parse(request.query);
  const jobs = await migrationEngine.listMigrationJobs(filters);
  return reply.status(200).send(jobs);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createMigrationSchema.parse(request.body);
  const jobId = await migrationEngine.createMigrationJob(input.sourceId, input.targetId, input.fileType);
  return reply.status(201).send({ id: jobId });
}

async function runHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await migrationEngine.runMigrationJob(id);
  return reply.status(200).send(result);
}

async function cancelHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const job = await migrationEngine.cancelMigrationJob(id);
  return reply.status(200).send(job);
}

export async function migrationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('storage:read')] }, listHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('storage:create')] }, createHandler);
  app.post('/:id/run', { preHandler: [app.authenticate, requirePermission('storage:update')] }, runHandler);
  app.post('/:id/cancel', { preHandler: [app.authenticate, requirePermission('storage:update')] }, cancelHandler);
}
