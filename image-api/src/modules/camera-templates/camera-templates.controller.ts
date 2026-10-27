import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createCameraTemplateSchema,
  updateCameraTemplateSchema,
} from './camera-templates.schema.js';
import * as templatesService from './camera-templates.service.js';
import { requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';

async function listHandler(_request: FastifyRequest, reply: FastifyReply) {
  const templates = await templatesService.listCameraTemplates();
  return reply.status(200).send(templates);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const template = await templatesService.getCameraTemplateById(id);
  return reply.status(200).send(template);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createCameraTemplateSchema.parse(request.body);
  const template = await templatesService.createCameraTemplate(input);
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'create',
    entity: 'camera_template',
    entityId: (template as any).id,
    description: `Created camera template "${(template as any).name}" by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(201).send(template);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateCameraTemplateSchema.parse(request.body);
  const template = await templatesService.updateCameraTemplate(id, input);
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'update',
    entity: 'camera_template',
    entityId: id,
    description: `Updated camera template "${(template as any).name}" by ${user?.username ?? 'system'}`,
    metadata: { fields: Object.keys(input) },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(template);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const target = await templatesService.getCameraTemplateById(id);
  const result = await templatesService.deleteCameraTemplate(id);
  await createAuditLog({
    userId: user?.id,
    action: 'delete',
    entity: 'camera_template',
    entityId: id,
    description: `Deleted camera template "${(target as any)?.name ?? id}" by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(result);
}

export async function cameraTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('camera-template:read')] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('camera-template:read')] }, getByIdHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('camera-template:create')] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('camera-template:update')] }, updateHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('camera-template:delete')] }, deleteHandler);
}
