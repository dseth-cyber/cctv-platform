import { cameraWhere, guardWorkOrderParam } from '../access/camera-scope.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import {
  addAttachment,
  attachmentFile,
  getWorkOrder,
  listWorkOrders,
  listWorkOrdersSchema,
  removeAttachment,
  updateWorkOrder,
  updateWorkOrderSchema,
  WorkOrderError,
} from './work-orders.service.js';

async function respond(reply: FastifyReply, work: () => Promise<unknown>, okStatus = 200) {
  try {
    return reply.status(okStatus).send(await work());
  } catch (err) {
    if (err instanceof WorkOrderError) return reply.status(err.statusCode).send({ message: err.message, details: { code: err.code } });
    throw err;
  }
}

const audit = (request: FastifyRequest, action: string, id: string, description: string, metadata: Record<string, unknown>) => {
  const user = (request as any).user;
  createAuditLog({ userId: user?.id, action, entity: 'work_order', entityId: id, description: `${description} by ${user?.username ?? 'system'}`, metadata, ipAddress: request.ip }).catch(() => {});
};

const canSeeCost = async (request: FastifyRequest) => {
  const permissions = await getUserPermissions((request as any).user?.id ?? '');
  return permissions.includes('*') || permissions.includes('workorders:cost');
};

/** What a job cost goes only to those allowed to see it, whichever way they ask. */
const withoutCost = <T extends { cost?: unknown }>(order: T) => ({ ...order, cost: undefined });

export async function workOrderRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, async (request, reply) =>
    respond(reply, async () => {
      const result = await listWorkOrders(listWorkOrdersSchema.parse(request.query), await cameraWhere(request));
      return (await canSeeCost(request)) ? result : { ...result, data: result.data.map(withoutCost) };
    }));

  app.get('/:id', { preHandler: [app.authenticate, requirePermission('cameras:read'), guardWorkOrderParam()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return respond(reply, async () => {
      const order = await getWorkOrder(id);
      return (await canSeeCost(request)) ? order : withoutCost(order);
    });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardWorkOrderParam()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateWorkOrderSchema.parse(request.body);
    return respond(reply, async () => {
      const seesCost = await canSeeCost(request);
      if (!seesCost) delete input.cost;
      const order = await updateWorkOrder(id, input);
      audit(request, 'work_order_update', id, `Work order ${order.number} updated`, { changes: Object.keys(input), status: input.status });
      return seesCost ? order : withoutCost(order);
    });
  });

  app.post('/:id/attachments', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardWorkOrderParam()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    return respond(reply, async () => {
      const file = await (request as any).file();
      if (!file) throw new WorkOrderError('NO_FILE', 400, 'No file uploaded');
      const maxMb = Number((await getAllConfigs()).incident_attachment_max_mb?.value ?? 10);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of file.file) {
        size += chunk.length;
        if (size > maxMb * 1024 * 1024) throw new WorkOrderError('FILE_TOO_LARGE', 413, `File size exceeds ${maxMb} MB limit`);
        chunks.push(chunk);
      }
      if (file.file.truncated) throw new WorkOrderError('FILE_TOO_LARGE', 413, `File size exceeds ${maxMb} MB limit`);
      const attachment = await addAttachment(id, file.filename ?? 'file', Buffer.concat(chunks), user?.username ?? 'system');
      audit(request, 'work_order_attachment_add', id, `Attachment ${attachment.originalName} added to a work order`, { filename: attachment.filename });
      return attachment;
    }, 201);
  });

  app.get('/:id/attachments/:filename', { preHandler: [app.authenticate, requirePermission('cameras:read'), guardWorkOrderParam()] }, async (request, reply) => {
    const { id, filename } = request.params as { id: string; filename: string };
    try {
      const file = await attachmentFile(id, filename);
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(await readFile(file.path));
    } catch (err) {
      if (err instanceof WorkOrderError) return reply.status(err.statusCode).send({ message: err.message, details: { code: err.code } });
      throw err;
    }
  });

  app.delete('/:id/attachments/:filename', { preHandler: [app.authenticate, requirePermission('cameras:update'), guardWorkOrderParam()] }, async (request, reply) => {
    const { id, filename } = request.params as { id: string; filename: string };
    return respond(reply, async () => {
      await removeAttachment(id, filename);
      audit(request, 'work_order_attachment_remove', id, `Attachment ${filename} removed from a work order`, { filename });
      return { removed: true };
    });
  });
}
