import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as telegramUsers from './telegram-users.service.js';
import { createAuditLog } from '../audit/audit.service.js';

async function listHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ data: await telegramUsers.listTelegramUsers() });
}

async function addHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { telegramId?: string; firstName?: string };
  const telegramId = String(body.telegramId ?? '').trim();
  if (!/^\d{5,20}$/.test(telegramId)) {
    return reply.status(400).send({
      statusCode: 400, error: 'BadRequest',
      message: 'telegramId must be a numeric Telegram user ID',
    });
  }

  const user = (request as any).user;
  const record = await telegramUsers.addApprovedUser({
    telegramId,
    firstName: body.firstName ? String(body.firstName).trim() : undefined,
    decidedBy: user?.username ?? 'system',
  });

  await createAuditLog({
    userId: user?.id,
    action: 'create',
    entity: 'telegram_user',
    entityId: telegramId,
    description: `Granted Telegram bot access to ${body.firstName || telegramId} by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(201).send(record);
}

async function setStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { telegramId } = request.params as { telegramId: string };
  const body = request.body as { status?: string };
  const status = String(body.status ?? '');
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return reply.status(400).send({
      statusCode: 400, error: 'BadRequest',
      message: 'status must be approved, rejected or pending',
    });
  }

  const user = (request as any).user;
  const record = await telegramUsers.setStatus(telegramId, status as any, user?.username ?? 'system');

  await createAuditLog({
    userId: user?.id,
    action: 'update',
    entity: 'telegram_user',
    entityId: telegramId,
    description: `Set Telegram bot access for ${telegramId} to ${status} by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send(record);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { telegramId } = request.params as { telegramId: string };
  const user = (request as any).user;
  await telegramUsers.deleteTelegramUser(telegramId);

  await createAuditLog({
    userId: user?.id,
    action: 'delete',
    entity: 'telegram_user',
    entityId: telegramId,
    description: `Revoked Telegram bot access for ${telegramId} by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(204).send();
}

export async function telegramUserRoutes(app: FastifyInstance): Promise<void> {
  // Reuses the telegram-bot permissions the Settings > Telegram Bot page already uses,
  // since this list is part of that same page.
  app.get('/', { preHandler: [app.authenticate, requirePermission('telegram-bot:read')] }, listHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, addHandler);
  app.patch('/:telegramId', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, setStatusHandler);
  app.delete('/:telegramId', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, deleteHandler);
}
