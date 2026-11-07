import bcrypt from 'bcryptjs';
import { getPrisma } from '../../lib/prisma.js';
import type { CreateUserInput, UpdateUserInput } from './users.schema.js';

// Roles are ranked by CustomRole.sortOrder — lower number = more senior (admin=1,
// operator=2, viewer=3, ...). A viewer may only see accounts at their rank or
// junior to it, so admins stay invisible to everyone but admins.
export async function getViewerMinRoleSortOrder(viewerRoleCode: string | undefined): Promise<number | null> {
  if (!viewerRoleCode || viewerRoleCode === 'admin' || viewerRoleCode === 'system') return null;
  const prisma = getPrisma();
  const role = await prisma.customRole.findUnique({ where: { code: viewerRoleCode }, select: { sortOrder: true } });
  // Unknown/unconfigured role: fail closed rather than exposing every account.
  return role ? role.sortOrder : Infinity;
}

export async function listUsers(params: { page?: number; limit?: number; enabled?: boolean; minRoleSortOrder?: number | null }) {
  const prisma = getPrisma();
  const where: any = { deletedAt: null };
  if (params.enabled !== undefined) where.enabled = params.enabled;
  if (params.minRoleSortOrder !== undefined && params.minRoleSortOrder !== null) {
    where.roleRelation = { sortOrder: { gte: params.minRoleSortOrder } };
  }

  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, username: true, email: true, role: true, customPermissions: true, cameraScope: true, enabled: true, lastLogin: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getUserById(id: string, minRoleSortOrder?: number | null) {
  const prisma = getPrisma();
  const where: any = { id, deletedAt: null };
  if (minRoleSortOrder !== undefined && minRoleSortOrder !== null) {
    where.roleRelation = { sortOrder: { gte: minRoleSortOrder } };
  }
  return prisma.user.findFirst({
    where,
    select: { id: true, username: true, email: true, role: true, customPermissions: true, cameraScope: true, enabled: true, lastLogin: true, createdAt: true, updatedAt: true },
  });
}

export async function createUser(input: CreateUserInput) {
  const prisma = getPrisma();
  const hashed = await bcrypt.hash(input.password, 10);

  return prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      password: hashed,
      role: input.role,
      customPermissions: input.customPermissions ?? [],
      ...(input.cameraScope ? { cameraScope: input.cameraScope } : {}),
    },
    select: { id: true, username: true, email: true, role: true, customPermissions: true, cameraScope: true, enabled: true, lastLogin: true, createdAt: true, updatedAt: true },
  });
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const prisma = getPrisma();
  const data: any = {};

  if (input.email !== undefined) data.email = input.email;
  if (input.role !== undefined) data.role = input.role;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.customPermissions !== undefined) data.customPermissions = input.customPermissions;
  if (input.cameraScope !== undefined) data.cameraScope = input.cameraScope;
  if (input.password) data.password = await bcrypt.hash(input.password, 10);

  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, email: true, role: true, customPermissions: true, cameraScope: true, enabled: true, lastLogin: true, createdAt: true, updatedAt: true },
  });
}

export class UserDeleteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'UserDeleteError';
  }
}

/**
 * Ends an account without erasing who it was. The audit log, sessions and favourites all point at it, and the log
 * has to keep saying who did what. It goes out of every list and can no longer sign in or use a token it holds.
 */
export async function deactivateUser(id: string, actor: { id?: string; username?: string }) {
  const prisma = getPrisma();
  if (actor.id === id) throw new UserDeleteError('SELF_DELETE', 'You cannot delete your own account');
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (target?.role === 'admin') {
    const others = await prisma.user.count({ where: { role: 'admin', enabled: true, deletedAt: null, id: { not: id } } });
    if (others === 0) throw new UserDeleteError('LAST_ADMIN', 'This is the last administrator');
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { enabled: false, deletedAt: now, deletedBy: actor.username ?? 'system' } }),
    prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  return { id, deleted: true };
}
