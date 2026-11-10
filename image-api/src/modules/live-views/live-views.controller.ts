import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { allowedCameraIds } from '../access/camera-scope.js';
import { getUserPermissions, requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import * as service from './live-views.service.js';

async function viewerOf(request: FastifyRequest): Promise<service.Viewer> {
  const id = (request as any).user.id as string;
  const permissions = await getUserPermissions(id);
  return { id, allowed: await allowedCameraIds(request), canShare: permissions.includes('*') || permissions.includes('cameras:update') };
}

/** Only what the team sees is audited; a person's own private views are their business. */
function audit(request: FastifyRequest, action: string, view: { id: string; name: string }, metadata?: Record<string, unknown>) {
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action,
    entity: 'live_view',
    entityId: view.id,
    description: `Shared live view "${view.name}" ${action.replace('live_view_', '')} by ${user?.username ?? 'system'}`,
    metadata,
    ipAddress: request.ip,
  }).catch(() => {});
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(await service.listLiveViews(await viewerOf(request)));
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = service.createLiveViewSchema.parse(request.body);
  const view = await service.createLiveView(await viewerOf(request), input);
  if (view.shared) audit(request, 'live_view_shared', view, { cameras: input.slots.length, layout: input.layout });
  return reply.status(201).send(view);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = z.object({ id: z.guid() }).parse(request.params);
  const input = service.updateLiveViewSchema.parse(request.body);
  const { before, after } = await service.updateLiveView(await viewerOf(request), id, input);
  if (before.shared && !after.shared) audit(request, 'live_view_unshared', after, { owner: before.ownerId });
  else if (!before.shared && after.shared) audit(request, 'live_view_shared', after, { cameras: (after.slots as unknown[]).length });
  else if (after.shared) audit(request, 'live_view_updated', after, { renamedFrom: before.name !== after.name ? before.name : undefined, slotsChanged: input.slots !== undefined });
  return reply.send(after);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = z.object({ id: z.guid() }).parse(request.params);
  const view = await service.deleteLiveView(await viewerOf(request), id);
  if (view.shared) audit(request, 'live_view_deleted', view, { owner: view.ownerId });
  return reply.status(204).send();
}

export async function liveViewRoutes(app: FastifyInstance): Promise<void> {
  // Saving your own views only needs to see cameras; sharing is checked inside, per request.
  const pre = { preHandler: [app.authenticate, requirePermission('cameras:read')] };
  app.get('/', pre, listHandler);
  app.post('/', pre, createHandler);
  app.patch('/:id', pre, updateHandler);
  app.delete('/:id', pre, deleteHandler);
}
