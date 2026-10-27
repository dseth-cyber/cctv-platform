import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as backupService from './backup.service.js';

async function getStatusHandler(_request: FastifyRequest, reply: FastifyReply) {
  const status = await backupService.getBackupStatus();
  return reply.status(200).send(status);
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, any>;
  const result = await backupService.listBackupRecords({
    page: query.page ? parseInt(query.page) : 1,
    limit: query.limit ? parseInt(query.limit) : 50,
    type: query.type,
  });
  return reply.status(200).send(result);
}

async function runDbBackupHandler(_request: FastifyRequest, reply: FastifyReply) {
  const result = await backupService.runDatabaseBackup();
  return reply.status(result.status === 'failed' ? 500 : 200).send(result);
}

async function runStorageBackupHandler(_request: FastifyRequest, reply: FastifyReply) {
  const result = await backupService.runStorageBackup();
  return reply.status(result.status === 'failed' ? 500 : 200).send(result);
}

async function restoreTestHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await backupService.runRestoreTest(id);
  return reply.status(200).send(result);
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', { preHandler: [app.authenticate] }, getStatusHandler);
  app.get('/', { preHandler: [app.authenticate] }, listHandler);
  app.post('/run/database', { preHandler: [app.authenticate, requirePermission('backup:create')] }, runDbBackupHandler);
  app.post('/run/storage', { preHandler: [app.authenticate, requirePermission('backup:create')] }, runStorageBackupHandler);
  app.post('/:id/restore-test', { preHandler: [app.authenticate, requirePermission('backup:create')] }, restoreTestHandler);
}
