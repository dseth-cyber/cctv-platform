import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import { readPressureState } from './storage-pressure.service.js';
import { planCleanup, type CleanupPlan, type CleanupTrigger } from './cleanup-planner.service.js';
import { runCleanup } from './cleanup-executor.service.js';

function summarizePlan(plan: CleanupPlan) {
  const byFileType: Record<string, { count: number; bytes: number }> = {};
  for (const c of plan.candidates) {
    const entry = byFileType[c.fileType] ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += c.bytes;
    byFileType[c.fileType] = entry;
  }
  return {
    providerId: plan.providerId,
    usedBytes: plan.usedBytes,
    totalBytes: plan.totalBytes,
    usagePercent: plan.usagePercent,
    targetBytesToFree: plan.targetBytesToFree,
    candidateCount: plan.candidates.length,
    candidateBytes: plan.candidateBytes,
    wouldFreeToPercent: plan.wouldFreeToPercent,
    affectedCameras: plan.affectedCameras,
    byFileType,
  };
}

async function pressureStateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const state = await readPressureState(id);
  if (!state) return reply.status(404).send({ error: 'Storage provider not found' });
  return reply.send(state);
}

async function simulateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { trigger } = (request.body as { trigger?: CleanupTrigger }) ?? {};
  const plan = await planCleanup(id, trigger === 'emergency' ? 'emergency' : 'manual');
  return reply.send(summarizePlan(plan));
}

async function executeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { trigger, password } = request.body as { trigger?: CleanupTrigger; password?: string };
  const user = (request as any).user;

  if (!password) return reply.status(400).send({ error: 'Password required', code: 'PASSWORD_REQUIRED' });

  const prisma = getPrisma();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const bcrypt = await import('bcryptjs');
  const compare = (bcrypt as any).default?.compare || (bcrypt as any).compare;
  if (!dbUser || !(await compare(password, dbUser.password))) {
    return reply.status(403).send({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
  }

  const effectiveTrigger: CleanupTrigger = trigger === 'emergency' ? 'emergency' : 'manual';
  const result = await runCleanup(id, effectiveTrigger, { dryRun: false, triggeredBy: user.username });

  const provider = await prisma.storageProvider.findUnique({ where: { id }, select: { name: true } });

  await createAuditLog({
    userId: user.id,
    action: effectiveTrigger === 'emergency' ? 'emergency_cleanup' : 'manual_cleanup',
    entity: 'storage_provider',
    entityId: id,
    description: `${effectiveTrigger === 'emergency' ? 'Emergency' : 'Manual'} cleanup on "${provider?.name ?? id}" freed ${result.filesDeleted} files / ${(result.bytesFreed / 1024 / 1024 / 1024).toFixed(2)} GB by ${user.username}`,
    metadata: { providerId: id, trigger: effectiveTrigger, filesDeleted: result.filesDeleted, bytesFreed: result.bytesFreed },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send({
    runId: result.runId,
    filesDeleted: result.filesDeleted,
    bytesFreed: result.bytesFreed,
    errors: result.errors,
  });
}

async function cleanupRunsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const query = request.query as { page?: string; limit?: string };
  const prisma = getPrisma();
  const page = query.page ? parseInt(query.page, 10) : 1;
  const limit = Math.min(query.limit ? parseInt(query.limit, 10) : 20, 100);

  const [total, data] = await Promise.all([
    prisma.cleanupRun.count({ where: { storageProviderId: id } }),
    prisma.cleanupRun.findMany({
      where: { storageProviderId: id },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return reply.send({
    data: data.map((r) => ({ ...r, bytesFreed: Number(r.bytesFreed) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function storageLifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/:id/pressure-state',
    { preHandler: [app.authenticate, requirePermission('storage:read')] },
    pressureStateHandler,
  );
  app.post(
    '/:id/cleanup/simulate',
    { preHandler: [app.authenticate, requirePermission('storage:read')] },
    simulateHandler,
  );
  app.post(
    '/:id/cleanup/execute',
    { preHandler: [app.authenticate, requirePermission('storage:delete')] },
    executeHandler,
  );
  app.get(
    '/:id/cleanup-runs',
    { preHandler: [app.authenticate, requirePermission('storage:read')] },
    cleanupRunsHandler,
  );
}
