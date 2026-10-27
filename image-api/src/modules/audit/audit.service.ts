import { getPrisma } from '../../lib/prisma.js';

export interface CreateAuditLogInput {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createAuditLog(input: CreateAuditLogInput) {
  const prisma = getPrisma();
  
  const validUserId = input.userId && UUID_REGEX.test(input.userId) ? input.userId : null;

  return prisma.auditLog.create({
    data: {
      userId: validUserId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      description: input.description ?? null,
      metadata: (input.metadata ?? {}) as any,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

const AUDIT_LOG_SORT_FIELDS: Record<string, (dir: 'asc' | 'desc') => any> = {
  createdAt: (dir) => ({ createdAt: dir }),
  username: (dir) => ({ user: { username: dir } }),
  action: (dir) => ({ action: dir }),
  entity: (dir) => ({ entity: dir }),
  entityId: (dir) => ({ entityId: dir }),
  description: (dir) => ({ description: dir }),
  ipAddress: (dir) => ({ ipAddress: dir }),
};

export async function searchAuditLogs(params: {
  page?: number;
  limit?: number;
  action?: string;
  entity?: string;
  entityId?: string;
  userId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const prisma = getPrisma();
  const { page = 1, limit = 50, action, entity, entityId, userId, from, to } = params;

  const where: Record<string, any> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const dir = params.sortDir ?? 'desc';
  const orderBy = params.sortBy && AUDIT_LOG_SORT_FIELDS[params.sortBy]
    ? AUDIT_LOG_SORT_FIELDS[params.sortBy](dir)
    : { createdAt: 'desc' };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { username: true } } },
    }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user?.username ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      description: r.description,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function bulkDeleteAuditPreview(days: number) {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - days * 86400000);
  const count = await prisma.auditLog.count({
    where: { createdAt: { lt: cutoff } },
  });
  return { days, cutoffDate: cutoff.toISOString(), count };
}

export async function bulkDeleteAuditByAge(days: number, _username: string) {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - days * 86400000);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: result.count, days, cutoffDate: cutoff.toISOString() };
}
