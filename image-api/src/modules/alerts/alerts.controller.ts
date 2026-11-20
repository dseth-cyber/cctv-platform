import { allowedAlertSources, guardAlertParam } from '../access/camera-scope.js';
import { createAuditLog } from '../audit/audit.service.js';
import { acknowledgeEscalation } from '../escalation/escalation.service.js';
import { withSourceInfo } from './alert-source.js';
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
  const sources = await allowedAlertSources(request);
  const result = await alertsService.listAlerts({
    ...(sources ? { sources } : {}),
    siteId: query.siteId,
    zoneId: query.zoneId,
    severity: query.severity,
    resolved: query.resolved === 'true' ? true : query.resolved === 'false' ? false : undefined,
    trash: query.trash === 'true',
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    sortBy: query.sortBy,
    sortDir: query.sortDir === 'asc' ? 'asc' : query.sortDir === 'desc' ? 'desc' : undefined,
  });
  // What each alert is about, in words a person can read (camera or recorder name, or which check raised it).
  return reply.send({ ...result, data: await withEscalation(await withSourceInfo(result.data)) });
}

/** Where each open alert is in its escalation chain (next reminder, step, due time of an acknowledgement). */
async function withEscalation<T extends { id: string }>(alerts: T[]) {
  if (!alerts.length) return alerts;
  const rows = await getPrisma().alertEscalation.findMany({ where: { alertId: { in: alerts.map((a) => a.id) } } });
  const byId = new Map(rows.map((r) => [r.alertId, r]));
  return alerts.map((a) => {
    const e = byId.get(a.id);
    return { ...a, escalation: e ? { stepIndex: e.stepIndex, nextNotifyAt: e.nextNotifyAt, dueAt: e.dueAt, ackNote: e.ackNote, notifyCount: e.notifyCount, workOrderId: e.workOrderId } : null };
  });
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const alert = await alertsService.getAlertById(id);
  if (!alert) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'Alert not found' });
  return reply.send((await withEscalation(await withSourceInfo([alert])))[0]);
}

async function acknowledgeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  // Optional (escalation): until when the person expects it fixed, and a note. Reminders pause until then.
  const body = (request.body ?? {}) as { dueAt?: string | null; note?: string | null; workOrderId?: string | null };
  if (body.workOrderId && !/^[0-9a-f-]{36}$/i.test(body.workOrderId)) {
    return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: 'workOrderId is not an id' });
  }
  const requestedDue = body.dueAt ? new Date(body.dueAt) : null;
  if (requestedDue && Number.isNaN(requestedDue.getTime())) {
    return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: 'dueAt is not a date' });
  }
  let escalation;
  try {
    escalation = await acknowledgeEscalation(id, { dueAt: requestedDue, note: body.note ?? null, workOrderId: body.workOrderId ?? null });
  } catch (err: any) {
    if (err?.statusCode === 400) return reply.status(400).send({ statusCode: 400, error: 'BadRequest', message: err.message });
    throw err;
  }
  const alert = await alertsService.acknowledgeAlert(id, user?.username ?? 'system');
  createAuditLog({
    userId: user?.id, action: 'alert_acknowledge', entity: 'alert', entityId: id,
    description: `Alert "${alert.title}" acknowledged by ${user?.username ?? 'system'} until ${escalation.dueAt.toISOString()}`,
    metadata: { dueAt: escalation.dueAt, note: escalation.note, workOrderId: escalation.workOrderId }, ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ ...alert, escalation });
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
  const sources = await allowedAlertSources(request);
  const user = (request as any).user;
  const result = await prisma.alert.updateMany({
    where: { acknowledgedAt: null, ...(sources ? { source: { in: sources } } : {}) },
    data: { acknowledgedAt: new Date(), acknowledgedBy: user?.username ?? 'system' },
  });
  return reply.send({ acknowledged: result.count });
}

/** Destructive alert actions ask for the password again. Sends the refusal itself and returns false. */
async function passwordConfirmed(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = (request as any).user;
  const { password } = (request.body ?? {}) as { password?: string };
  if (!password) {
    reply.status(400).send({ error: 'Password required', code: 'PASSWORD_REQUIRED' });
    return false;
  }
  const dbUser = await getPrisma().user.findUnique({ where: { id: user.id } });
  const bcrypt = await import('bcryptjs');
  const compare = bcrypt.default?.compare || bcrypt.compare;
  if (!dbUser || !(await compare(password, dbUser.password))) {
    reply.status(403).send({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    return false;
  }
  return true;
}

async function auditAlerts(request: FastifyRequest, action: string, description: string) {
  const user = (request as any).user;
  const { createAuditLog } = await import('../audit/audit.service.js');
  await createAuditLog({
    userId: user.id,
    action,
    entity: 'alert',
    description: `${description} by ${user.username}`,
    ipAddress: request.ip,
  }).catch(() => {});
}

async function clearAllHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!(await passwordConfirmed(request, reply))) return reply;
  const cleared = await alertsService.moveAllToTrash((request as any).user?.username ?? 'system', (await allowedAlertSources(request)) ?? undefined);
  await auditAlerts(request, 'bulk_clear', `Moved ${cleared} alerts to the trash`);
  return reply.send({ cleared });
}

async function moveToTrashHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const moved = await alertsService.moveToTrash(id, (request as any).user?.username ?? 'system');
  if (moved === 0) return reply.status(404).send({ error: 'Alert not found' });
  await auditAlerts(request, 'delete', `Moved alert ${id} to the trash`);
  return reply.send({ moved });
}

async function restoreHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const restored = await alertsService.restoreFromTrash(id);
  if (restored === 0) return reply.status(404).send({ error: 'Not in the trash' });
  await auditAlerts(request, 'restore', `Restored alert ${id} from the trash`);
  return reply.send({ restored });
}

async function restoreAllHandler(request: FastifyRequest, reply: FastifyReply) {
  const restored = await alertsService.restoreFromTrash(undefined, (await allowedAlertSources(request)) ?? undefined);
  await auditAlerts(request, 'restore', `Restored ${restored} alerts from the trash`);
  return reply.send({ restored });
}

async function deleteForGoodHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!(await passwordConfirmed(request, reply))) return reply;
  const { id } = request.params as { id: string };
  const deleted = await alertsService.deleteFromTrash(id);
  if (deleted === 0) return reply.status(404).send({ error: 'Not in the trash' });
  await auditAlerts(request, 'delete_permanent', `Permanently deleted alert ${id}`);
  return reply.send({ deleted });
}

async function emptyTrashHandler(request: FastifyRequest, reply: FastifyReply) {
  if (!(await passwordConfirmed(request, reply))) return reply;
  const deleted = await alertsService.deleteFromTrash(undefined, (await allowedAlertSources(request)) ?? undefined);
  await auditAlerts(request, 'delete_permanent', `Emptied the alert trash (${deleted} alerts)`);
  return reply.send({ deleted });
}

async function unacknowledgedCountHandler(request: FastifyRequest, reply: FastifyReply) {
  const prisma = getPrisma();
  const sources = await allowedAlertSources(request);
  // A closed alert asks nothing of anyone, even if nobody acknowledged it first.
  const count = await prisma.alert.count({ where: { acknowledgedAt: null, resolvedAt: null, deletedAt: null, ...(sources ? { source: { in: sources } } : {}) } });
  return reply.send({ count });
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: [app.authenticate, requirePermission('alerts:create')] }, createHandler);
  app.get('/', { preHandler: [app.authenticate, requirePermission('alerts:read')] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('alerts:read'), guardAlertParam()] }, getByIdHandler);
  app.patch('/:id/acknowledge', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, acknowledgeHandler);
  app.post('/:id/snooze', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, snoozeHandler);
  app.patch('/:id/resolve', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, resolveHandler);
  app.post('/acknowledge-all', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, acknowledgeAllHandler);
  app.get('/unacknowledged-count', { preHandler: [app.authenticate] }, unacknowledgedCountHandler);
  app.post('/clear-all', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, clearAllHandler);
  app.post('/trash/restore-all', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, restoreAllHandler);
  app.post('/trash/empty', { preHandler: [app.authenticate, requirePermission('alerts:update')] }, emptyTrashHandler);
  app.post('/trash/:id/restore', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, restoreHandler);
  app.post('/trash/:id/delete', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, deleteForGoodHandler);
  app.post('/:id/trash', { preHandler: [app.authenticate, requirePermission('alerts:update'), guardAlertParam()] }, moveToTrashHandler);
}
