import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '../lib/errors.js';
import { getPrisma } from '../lib/prisma.js';

const roleHierarchy: Record<string, number> = {
  system: 100,
  admin: 80,
  operator: 50,
  viewer: 10,
};

export async function getUserPermissions(userId: string): Promise<string[]> {
  const prisma = getPrisma();
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return [];

  // Admin and system get '*' wildcard permission by default to prevent lockouts
  if (user.role === 'admin' || user.role === 'system') {
    return ['*'];
  }

  const role = await prisma.customRole.findUnique({
    where: { code: user.role },
  });

  const rolePermissions = Array.isArray(role?.permissions) ? (role.permissions as string[]) : [];
  const customPermissions = Array.isArray(user.customPermissions) ? (user.customPermissions as string[]) : [];

  return [...new Set([...rolePermissions, ...customPermissions])];
}

export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user || typeof user === 'string' || Buffer.isBuffer(user)) {
      throw new ForbiddenError('Authentication required');
    }

    const userRole = (user as Record<string, string>).role ?? '';
    const userLevel = roleHierarchy[userRole] ?? 0;
    const requiredLevel = Math.min(
      ...allowedRoles.map((r) => roleHierarchy[r] ?? 0),
    );

    if (userLevel < requiredLevel) {
      throw new ForbiddenError(
        `Insufficient role. Required: ${allowedRoles.join(' or ')}, got: ${userRole}`,
      );
    }
  };
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user || typeof user === 'string' || Buffer.isBuffer(user)) {
      throw new ForbiddenError('Authentication required');
    }

    const userRole = (user as Record<string, string>).role ?? '';
    if (userRole === 'system' || userRole === 'admin') {
      return; // system and admin bypass permission checks
    }

    const permissions = await getUserPermissions((user as Record<string, string>).id);
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      throw new ForbiddenError(`Insufficient permission. Required: ${permission}`);
    }
  };
}
