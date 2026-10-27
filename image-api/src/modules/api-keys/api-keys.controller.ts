import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as apiKeysService from './api-keys.service.js';
import { createAuditLog } from '../audit/audit.service.js';

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, string>;
  const result = await apiKeysService.listApiKeys({
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
  });
  return reply.send(result);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const key = await apiKeysService.getApiKeyById(id);
  if (!key) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'API key not found' });
  return reply.send(key);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  const user = (request as any).user;
  const result = await apiKeysService.createApiKey({
    name: String(body.name),
    permissions: body.permissions as string[] | undefined,
    expiresAt: body.expiresAt ? String(body.expiresAt) : undefined,
    createdBy: user?.username ?? 'system',
  });
  await createAuditLog({
    userId: user?.id,
    action: 'create',
    entity: 'api_key',
    entityId: (result as any).id,
    description: `Created API key "${String(body.name)}" by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(201).send(result);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, unknown>;
  const rule = await apiKeysService.updateApiKey(id, {
    name: body.name !== undefined ? String(body.name) : undefined,
    permissions: body.permissions as string[] | undefined,
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
    expiresAt: body.expiresAt !== undefined ? (body.expiresAt ? String(body.expiresAt) : null) : undefined,
  });
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'update',
    entity: 'api_key',
    entityId: id,
    description: `Updated API key "${(rule as any).name ?? id}" by ${user?.username ?? 'system'}`,
    metadata: { fields: Object.keys(body) },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send(rule);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const target = await apiKeysService.getApiKeyById(id);
  await apiKeysService.deleteApiKey(id);
  await createAuditLog({
    userId: user?.id,
    action: 'delete',
    entity: 'api_key',
    entityId: id,
    description: `Deleted API key "${(target as any)?.name ?? id}" by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(204).send();
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('api-keys:read')] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('api-keys:read')] }, getByIdHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('api-keys:create')] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('api-keys:update')] }, updateHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('api-keys:delete')] }, deleteHandler);
}
