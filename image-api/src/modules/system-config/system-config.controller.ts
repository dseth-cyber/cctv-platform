import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as configService from './system-config.service.js';
import { createAuditLog } from '../audit/audit.service.js';

async function getAllHandler(_request: FastifyRequest, reply: FastifyReply) {
  const configs = await configService.getAllConfigs();
  return reply.send(configs);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, string>;
  await configService.updateConfigs(body);
  return reply.send({ ok: true });
}

async function getRequiredFieldsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const config = await configService.getRequiredFields();
  return reply.send(config);
}

async function updateRequiredFieldsHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = (request.body ?? {}) as Record<string, string[]>;
  await configService.setRequiredFields(body);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'required_fields_update',
    entity: 'system-config',
    entityId: 'required_fields',
    description: `Required field configuration updated by ${user?.username ?? 'system'}`,
    metadata: { entities: Object.keys(body ?? {}) },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ ok: true });
}

export async function systemConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', getAllHandler);
  app.post('/bulk-update', { preHandler: [app.authenticate, requirePermission('system-config:update')] }, updateHandler);
  app.patch('/', { preHandler: [app.authenticate, requirePermission('system-config:update')] }, updateHandler);

  // Required-fields configuration (dedicated endpoint used by the Required Fields Settings page).
  app.get('/required-fields', { preHandler: [app.authenticate, requirePermission('system-config:read')] }, getRequiredFieldsHandler);
  app.put('/required-fields', { preHandler: [app.authenticate, requirePermission('system-config:update')] }, updateRequiredFieldsHandler);
}
