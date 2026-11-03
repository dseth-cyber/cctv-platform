import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { searchAuditLogs, bulkDeleteAuditPreview, bulkDeleteAuditByAge, createAuditLog } from './audit.service.js';
import { requirePermission } from '../../middleware/rbac.js';

async function searchHandler(request: FastifyRequest, reply: FastifyReply) {
  const params = request.query as Record<string, any>;
  const result = await searchAuditLogs({
    page: params.page ? parseInt(params.page) : 1,
    limit: params.limit ? parseInt(params.limit) : 50,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    userId: params.userId,
    from: params.from,
    to: params.to,
    sortBy: params.sortBy,
    sortDir: params.sortDir === 'asc' ? 'asc' : params.sortDir === 'desc' ? 'desc' : undefined,
  });
  return reply.status(200).send(result);
}

async function bulkDeletePreviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = request.query as { days: string };
  const d = parseInt(days, 10);
  if (!d || d < 1) return reply.status(400).send({ error: 'Invalid days parameter' });
  const result = await bulkDeleteAuditPreview(d);
  return reply.status(200).send(result);
}

async function bulkDeleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days, password } = (request.body ?? {}) as { days: number; password: string };
  const user = (request as any).user;

  // Verify password
  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const result = await bulkDeleteAuditByAge(days, user.username);

  createAuditLog({
    userId: user.id,
    action: 'bulk_delete',
    entity: 'audit_log',
    entityId: `age>${days}d`,
    description: `Bulk deleted ${result.deleted} audit logs older than ${days} days by ${user.username}`,
    metadata: { days, deleted: result.deleted },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(200).send(result);
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate, requirePermission('audit-log:read')] }, searchHandler);
  app.get('/bulk-delete-preview', { preHandler: [app.authenticate, requirePermission('audit-log:read')] }, bulkDeletePreviewHandler);
  app.post('/bulk-delete', { preHandler: [app.authenticate, requirePermission('audit-log:delete')] }, bulkDeleteHandler);
}
