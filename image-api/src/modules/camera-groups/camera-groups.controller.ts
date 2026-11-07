import { allowedCameraIds, guardAllCameras } from '../access/camera-scope.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import * as service from './camera-groups.service.js';

function audit(request: FastifyRequest, action: string, entityId: string, description: string, metadata?: Record<string, unknown>) {
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action,
    entity: 'camera_group',
    entityId,
    description: `${description} by ${user?.username ?? 'system'}`,
    metadata,
    ipAddress: request.ip,
  }).catch(() => {});
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const groups = await service.listCameraGroups();
  const allowed = await allowedCameraIds(request);
  if (allowed === null) return reply.send(groups);
  // A group shows with only the cameras within reach, or not at all.
  return reply.send(groups.map((g) => ({ ...g, cameraIds: g.cameraIds.filter((id: string) => allowed.includes(id)) })).filter((g) => g.cameraIds.length > 0));
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = service.createCameraGroupSchema.parse(request.body);
  const group = await service.createCameraGroup(input);
  audit(request, 'camera_group_create', group.id, `Camera group "${group.name}" created`, { cameras: input.cameraIds.length });
  return reply.status(201).send(group);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = service.updateCameraGroupSchema.parse(request.body);
  const group = await service.updateCameraGroup(id, input);
  audit(request, 'camera_group_update', id, `Camera group "${group.name}" updated`, input.cameraIds ? { cameras: input.cameraIds.length } : undefined);
  return reply.send(group);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const group = await service.deleteCameraGroup(id);
  audit(request, 'camera_group_delete', id, `Camera group "${group.name}" deleted`);
  return reply.status(204).send();
}

export async function cameraGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, listHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] }, updateHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] }, deleteHandler);
}
