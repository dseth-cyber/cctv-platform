import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { ZodError } from 'zod';
import * as backupService from './backup.service.js';
import { BackupSettingsError, backupDestinations, backupTimeZone, destinationWritable, getBackupSettings, saveBackupSettings } from './backup-settings.js';
import { diskOverview } from './disk-overview.js';
import { createAuditLog } from '../audit/audit.service.js';

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

/** The schedule and where backups go, plus which destinations this server has mounted. */
async function getSettingsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const settings = await getBackupSettings();
  const destinations = backupDestinations().map((d) => ({ id: d.id, hostPath: d.hostPath, writable: destinationWritable(d.dir) }));
  return reply.status(200).send({ settings, destinations, timeZone: backupTimeZone() });
}

async function saveSettingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  const before = await getBackupSettings();
  try {
    const settings = await saveBackupSettings(request.body);
    createAuditLog({
      userId: user?.id,
      action: 'backup_settings_update',
      entity: 'backup',
      description: `Backup settings changed by ${user?.username ?? 'unknown'}`,
      metadata: { before, after: settings },
      ipAddress: request.ip,
    }).catch(() => {});
    return reply.status(200).send({ settings });
  } catch (err) {
    if (err instanceof BackupSettingsError) return reply.status(400).send({ message: err.message, details: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ message: 'Invalid backup settings', details: { code: 'INVALID', issues: err.issues.map((i) => i.path.join('.')) } });
    throw err;
  }
}

async function disksHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({ items: await diskOverview() });
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', { preHandler: [app.authenticate, requirePermission('backup:read')] }, getSettingsHandler);
  app.put('/settings', { preHandler: [app.authenticate, requirePermission('backup:read'), requirePermission('system-config:update')] }, saveSettingsHandler);
  app.get('/disks', { preHandler: [app.authenticate, requirePermission('backup:read')] }, disksHandler);
  app.get('/status', { preHandler: [app.authenticate, requirePermission('backup:read')] }, getStatusHandler);
  app.get('/', { preHandler: [app.authenticate, requirePermission('backup:read')] }, listHandler);
  app.post('/run/database', { preHandler: [app.authenticate, requirePermission('backup:create')] }, runDbBackupHandler);
  app.post('/run/storage', { preHandler: [app.authenticate, requirePermission('backup:create')] }, runStorageBackupHandler);
  app.post('/:id/restore-test', { preHandler: [app.authenticate, requirePermission('backup:create')] }, restoreTestHandler);
}
