import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as masterdataService from './masterdata.service.js';
import { createAuditLog } from '../audit/audit.service.js';

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, string>;
  const type = String(query.type);
  if (!masterdataService.MASTERDATA_TYPES.includes(type as any)) {
    return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: `Invalid type. Must be one of: ${masterdataService.MASTERDATA_TYPES.join(', ')}` });
  }
  const result = await masterdataService.listMasterdata({
    type: type as any,
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    isActive: query.isActive !== undefined ? query.isActive === 'true' : undefined,
  });
  return reply.send(result);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const item = await masterdataService.getMasterdataById(id);
  if (!item) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'Masterdata not found' });
  return reply.send(item);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  const type = String(body.type);
  if (!masterdataService.MASTERDATA_TYPES.includes(type as any)) {
    return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: `Invalid type. Must be one of: ${masterdataService.MASTERDATA_TYPES.join(', ')}` });
  }
  const item = await masterdataService.createMasterdata({
    type: type as any,
    code: String(body.code),
    nameTh: body.nameTh ? String(body.nameTh) : undefined,
    nameEn: body.nameEn ? String(body.nameEn) : undefined,
    nameCn: body.nameCn ? String(body.nameCn) : undefined,
    nameMm: body.nameMm ? String(body.nameMm) : undefined,
    nameJp: body.nameJp ? String(body.nameJp) : undefined,
    description: body.description ? String(body.description) : undefined,
    sortOrder: body.sortOrder !== undefined ? parseInt(String(body.sortOrder), 10) : undefined,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
    config: body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : undefined,
  });
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'create',
    entity: 'masterdata',
    entityId: (item as any).id,
    description: `Created masterdata "${(item as any).code}" (type: ${type}) by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(201).send(item);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, unknown>;
  const item = await masterdataService.updateMasterdata(id, {
    code: body.code !== undefined ? String(body.code) : undefined,
    nameTh: body.nameTh !== undefined ? String(body.nameTh) : undefined,
    nameEn: body.nameEn !== undefined ? String(body.nameEn) : undefined,
    nameCn: body.nameCn !== undefined ? String(body.nameCn) : undefined,
    nameMm: body.nameMm !== undefined ? String(body.nameMm) : undefined,
    nameJp: body.nameJp !== undefined ? String(body.nameJp) : undefined,
    description: body.description !== undefined ? String(body.description) : undefined,
    sortOrder: body.sortOrder !== undefined ? parseInt(String(body.sortOrder), 10) : undefined,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
    config: body.config !== undefined ? (body.config as Record<string, unknown> | null) : undefined,
  });
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'update',
    entity: 'masterdata',
    entityId: id,
    description: `Updated masterdata "${(item as any).code}" by ${user?.username ?? 'system'}`,
    metadata: { fields: Object.keys(body) },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send(item);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const target = await masterdataService.getMasterdataById(id);
  await masterdataService.deleteMasterdata(id);
  await createAuditLog({
    userId: user?.id,
    action: 'delete',
    entity: 'masterdata',
    entityId: id,
    description: `Deleted masterdata "${(target as any)?.code ?? id}" by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(204).send();
}

async function optionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const type = String((request.query as Record<string, string>).type);
  if (!masterdataService.OPTION_TYPES.includes(type as any)) {
    return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: 'Invalid type' });
  }
  return reply.send(await masterdataService.listMasterdataOptions(type as any));
}

export async function masterdataRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('masterdata:read')] }, listHandler);
  app.get('/options', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, optionsHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('masterdata:read')] }, getByIdHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('masterdata:create')] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('masterdata:update')] }, updateHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('masterdata:delete')] }, deleteHandler);
}
