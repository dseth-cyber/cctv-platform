import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { getPrisma } from '../../lib/prisma.js';
import * as alertsService from './alerts.service.js';

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, unknown>;
  const alert = await alertsService.createAlert({
    alertType: String(body.alertType) as any,
    severity: (body.severity as any) ?? 'warning',
    source: body.source ? String(body.source) : undefined,
    title: String(body.title),
    message: String(body.message),
    details: body.details as Record<string, unknown> | undefined,
  });
  return reply.status(201).send(alert);
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, string>;
  const result = await alertsService.listAlerts({
    severity: query.severity,
    resolved: query.resolved === 'true' ? true : query.resolved === 'false' ? false : undefined,
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortBy: query.sortBy,
    sortDir: query.sortDir === 'asc' ? 'asc' : query.sortDir === 'desc' ? 'desc' : undefined,
  });
  return reply.send(result);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const alert = await alertsService.getAlertById(id);
  if (!alert) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'Alert not found' });
  return reply.send(alert);
}

async function acknowledgeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const alert = await alertsService.acknowledgeAlert(id, user?.username ?? 'system');
  return reply.send(alert);
}

async function resolveHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const alert = await alertsService.resolveAlert(id, user?.username ?? 'system');
  return reply.send(alert);
}

async function snoozeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const { hours = 4 } = (request.body as { hours?: number }) || {};
  const alert = await alertsService.snoozeAlert(id, Number(hours), user?.username ?? 'system');
  return reply.send(alert);
}

async function acknowledgeAllHandler(request: FastifyRequest, reply: FastifyReply) {
  const prisma = getPrisma();
  const user = (request as any).user;
  const result = await prisma.alert.updateMany({
    where: { acknowledgedAt: null },
    data: { acknowledgedAt: new Date(), acknowledgedBy: user?.username ?? 'system' },
  });
  return reply.send({ acknowledged: result.count });
}

async function clearAllHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  const { password } = (request.body ?? {}) as { password?: string };
  if (!password) {
    return reply.status(400).send({ error: 'Password required', code: 'PASSWORD_REQUIRED' });
  }

  const prisma = getPrisma();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });

  const bcrypt = await import('bcryptjs');
  const compare = bcrypt.default?.compare || bcrypt.compare;
  if (!dbUser || !(await compare(password, dbUser.password))) {
    return reply.status(403).send({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
  }

  const result = await prisma.alert.updateMany({
    where: { resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedBy: user?.username ?? 'system' },
  });

  const { createAuditLog } = await import('../audit/audit.service.js');
  await createAuditLog({
    userId: user.id,
    action: 'bulk_clear',
    entity: 'alert',
    description: `Cleared ${result.count} active alerts by ${user.username}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send({ cleared: result.count });
}

async function unacknowledgedCountHandler(_request: FastifyRequest, reply: FastifyReply) {
  const prisma = getPrisma();
  const count = await prisma.alert.count({ where: { acknowledgedAt: null } });
  return reply.send({ count });
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: [app.authenticate, requirePermission('alerts:create')] }, createHandler);
  app.get('/', { preHandler: [app.authenticate, requirePermission('alerts:read')] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('alerts:read')] }, getByIdHandler);
  app.patch('/:id/acknowledge', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, acknowledgeHandler);
  app.post('/:id/snooze', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, snoozeHandler);
  app.patch('/:id/resolve', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, resolveHandler);
  app.post('/acknowledge-all', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, acknowledgeAllHandler);
  app.get('/unacknowledged-count', { preHandler: [app.authenticate] }, unacknowledgedCountHandler);
  app.post('/clear-all', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, clearAllHandler);
}
