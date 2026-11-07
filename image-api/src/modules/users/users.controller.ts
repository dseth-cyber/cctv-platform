import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as usersService from './users.service.js';
import * as rolesService from '../roles/roles.service.js';
import { createUserSchema, updateUserSchema } from './users.schema.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as sessionService from '../auth/user-session.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { ForbiddenError } from '../../lib/errors.js';
import { isLocked, unlockUser } from '../../lib/login-security.js';

// Blocks a viewer from acting on (or seeing) an account whose role outranks
// their own — e.g. an operator can't view/edit/delete an admin account.
async function assertCanManageRole(actorSortOrder: number, targetRoleCode: string): Promise<void> {
  const targetRole = await rolesService.getRoleByCode(targetRoleCode);
  const targetSortOrder = targetRole ? targetRole.sortOrder : Infinity;
  if (targetSortOrder < actorSortOrder) {
    throw new ForbiddenError('You do not have permission to manage this user');
  }
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, string>;
  const actor = (request as any).user;
  const minRoleSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  const result = await usersService.listUsers({
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
    enabled: query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined,
    minRoleSortOrder,
  });
  // Cross-cutting concern (Redis lockout state, not part of the User record itself) —
  // enriched here rather than in the service, which stays DB-only.
  const data = await Promise.all(result.data.map(async (u) => ({ ...u, isLocked: await isLocked(u.username) })));
  return reply.send({ ...result, data });
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const actor = (request as any).user;
  const minRoleSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  const user = await usersService.getUserById(id, minRoleSortOrder);
  if (!user) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'User not found' });
  return reply.send({ ...user, isLocked: await isLocked(user.username) });
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createUserSchema.parse(request.body);
  const actor = (request as any).user;
  const actorSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  if (actorSortOrder !== null) await assertCanManageRole(actorSortOrder, input.role);
  const user = await usersService.createUser(input);
  await createAuditLog({
    userId: actor?.id,
    action: 'create',
    entity: 'user',
    entityId: user.id,
    description: `Created user "${user.username}" (role: ${user.role}) by ${actor?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(201).send(user);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateUserSchema.parse(request.body);
  const actor = (request as any).user;
  const actorSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  // Checked for everyone, admins too: a deleted account must not be switched back on through an edit.
  const target = await usersService.getUserById(id, actorSortOrder);
  if (!target) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'User not found' });
  if (actorSortOrder !== null && input.role !== undefined) await assertCanManageRole(actorSortOrder, input.role);
  const user = await usersService.updateUser(id, input);
  await createAuditLog({
    userId: actor?.id,
    action: 'update',
    entity: 'user',
    entityId: id,
    description: `Updated user "${user.username}" by ${actor?.username ?? 'system'}`,
    metadata: { fields: Object.keys(input) },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send(user);
}

async function deactivateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const actor = (request as any).user;
  const actorSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  const target = await usersService.getUserById(id, actorSortOrder);
  if (!target) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'User not found' });
  let user;
  try {
    user = await usersService.deactivateUser(id, { id: actor?.id, username: actor?.username });
  } catch (err) {
    if (err instanceof usersService.UserDeleteError) return reply.status(409).send({ statusCode: 409, error: err.code, message: err.message, details: { code: err.code } });
    throw err;
  }
  await createAuditLog({
    userId: actor?.id,
    action: 'delete',
    entity: 'user',
    entityId: id,
    description: `Deleted user "${target?.username ?? id}" by ${actor?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send(user);
}

async function unlockHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const actor = (request as any).user;
  const actorSortOrder = await usersService.getViewerMinRoleSortOrder(actor?.role);
  const target = await usersService.getUserById(id, actorSortOrder);
  if (!target) return reply.status(404).send({ statusCode: 404, error: 'NotFound', message: 'User not found' });

  const wasLocked = await unlockUser(target.username);
  if (wasLocked) {
    await createAuditLog({
      userId: actor?.id,
      action: 'account_unlocked',
      entity: 'user',
      entityId: id,
      description: `Account "${target.username}" manually unlocked by ${actor?.username ?? 'system'}`,
      ipAddress: request.ip,
    }).catch(() => {});
  }
  return reply.send({ wasLocked });
}

async function userActivityHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const query = request.query as Record<string, string>;
  const period = query.period || '7d';
  const stats = await sessionService.getUserStats(id, period);
  return reply.send(stats);
}

async function usersActivitySummaryHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as Record<string, string>;
  const period = query.period || '7d';
  const stats = await sessionService.getAllUsersStats(period);
  return reply.send(stats);
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/activity/summary', { preHandler: [app.authenticate, requirePermission('users:read')] }, usersActivitySummaryHandler);
  app.get('/', { preHandler: [app.authenticate, requirePermission('users:read')] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate, requirePermission('users:read')] }, getByIdHandler);
  app.get('/:id/activity', { preHandler: [app.authenticate, requirePermission('users:read')] }, userActivityHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('users:create')] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('users:update')] }, updateHandler);
  app.post('/:id/unlock', { preHandler: [app.authenticate, requirePermission('users:update')] }, unlockHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('users:delete')] }, deactivateHandler);
}
