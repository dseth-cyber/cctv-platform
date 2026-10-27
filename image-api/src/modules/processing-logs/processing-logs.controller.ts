import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { processingLogSearchSchema } from './processing-logs.schema.js';
import * as processingLogsService from './processing-logs.service.js';
import { requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import { getRedisClient } from '../../lib/redis.js';

const QUEUE_WAIT = 'bull:image-processing:wait';
const QUEUE_ACTIVE = 'bull:image-processing:active';
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

async function searchHandler(request: FastifyRequest, reply: FastifyReply) {
  const params = processingLogSearchSchema.parse(request.query);
  const result = await processingLogsService.searchProcessingLogs(params);
  return reply.status(200).send(result);
}

async function statsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { timebase } = request.query as { timebase?: string };
  const tb = timebase === 'capture' ? 'capture' : 'ingestion';
  const stats = await processingLogsService.getProcessingStats(tb);
  return reply.status(200).send(stats);
}

async function executiveDefectsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days, limit } = request.query as { days?: string; limit?: string };
  const d = Math.min(730, Math.max(1, parseInt(days ?? '7', 10) || 7));
  const l = Math.min(100, Math.max(1, parseInt(limit ?? '10', 10) || 10));
  const result = await processingLogsService.getExecutiveDefectStats(d, l);
  return reply.status(200).send(result);
}

async function defectHeatmapHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = request.query as { days?: string };
  const d = Math.min(730, Math.max(1, parseInt(days ?? '7', 10) || 7));
  return reply.send(await processingLogsService.getDefectHeatmap(d));
}

async function trendsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { period, timebase } = request.query as { period?: string; timebase?: string };
  const tb = timebase === 'capture' ? 'capture' : 'ingestion';
  const result = await processingLogsService.getTrends(period ?? '7d', tb);
  return reply.status(200).send(result);
}

async function retryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await processingLogsService.retryJob(id);
  return reply.status(200).send(result);
}

async function rejectHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await processingLogsService.rejectJob(id);
  return reply.status(200).send(result);
}

async function dlqSummaryHandler(_request: FastifyRequest, reply: FastifyReply) {
  const result = await processingLogsService.getDlqSummary();
  return reply.status(200).send(result);
}

async function bulkRetryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { jobType } = request.query as { jobType?: string };
  const result = await processingLogsService.bulkRetryDlq(jobType || undefined);
  return reply.status(200).send(result);
}

async function bulkRejectHandler(request: FastifyRequest, reply: FastifyReply) {
  const { jobType } = request.query as { jobType?: string };
  const result = await processingLogsService.bulkRejectDlq(jobType || undefined);
  return reply.status(200).send(result);
}

async function bulkDeletePreviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = request.query as { days: string };
  const d = parseInt(days, 10);
  if (!d || d < 1) return reply.status(400).send({ error: 'Invalid days parameter' });
  const result = await processingLogsService.bulkDeleteLogsPreview(d);
  return reply.status(200).send(result);
}

async function bulkDeleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days, password } = request.body as { days: number; password: string };
  const user = (request as any).user;

  // Verify password
  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const result = await processingLogsService.bulkDeleteLogsByAge(days, user.username);

  createAuditLog({
    userId: user.id,
    action: 'bulk_delete',
    entity: 'processing_log',
    entityId: `age>${days}d`,
    description: `Bulk deleted ${result.deleted} processing logs older than ${days} days by ${user.username}`,
    metadata: { days, deleted: result.deleted },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(200).send(result);
}

async function streamHandler(_request: FastifyRequest, reply: FastifyReply) {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  let running = true;
  const onClose = () => { running = false; };
  reply.raw.on('close', onClose);
  reply.raw.on('finish', onClose);

  const push = (event: string, data: unknown) => {
    if (!running) return;
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const tick = async () => {
    try {
      const { stats, logs } = await processingLogsService.getStreamData();
      push('stats', stats);
      push('logs', logs);
    } catch { /* next tick will retry */ }
  };

  await tick();

  const statsTimer = setInterval(tick, 2_000);
  const heartbeat = setInterval(() => push('heartbeat', { ts: Date.now() }), 15_000);

  reply.raw.on('close', () => {
    clearInterval(statsTimer);
    clearInterval(heartbeat);
  });
}

async function queueHealthHandler(_request: FastifyRequest, reply: FastifyReply) {
  const redis = getRedisClient();
  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const [waiting, active, recentCompleted, recentFailed] = await Promise.all([
    redis.llen(QUEUE_WAIT),
    redis.llen(QUEUE_ACTIVE),
    prisma.processingJob.count({ where: { status: 'completed', completedAt: { gte: threshold } } }),
    prisma.processingJob.count({ where: { status: 'failed', completedAt: { gte: threshold } } }),
  ]);

  // Stale = active jobs exist but nothing has *completed* in the window.
  let stale = 0;
  let isStale = false;
  let cause: 'jobs_failing' | 'worker_unresponsive' | null = null;
  if (active > 0 && recentCompleted === 0) {
    stale = active;
    isStale = true;
    // Distinguish a real cause: if jobs ARE failing, the worker is alive but the
    // source is broken (camera/SMB unreachable, bad files) — the answer is the Dead
    // Letter Queue, not "recover". Only when nothing fails either is the worker
    // likely genuinely unresponsive (the case "recover" is actually for).
    cause = recentFailed > 0 ? 'jobs_failing' : 'worker_unresponsive';
  }

  return reply.send({ waiting, active, stale, isStale, recentFailed, cause });
}

async function recoverQueueHandler(request: FastifyRequest, reply: FastifyReply) {
  const redis = getRedisClient();
  let recovered = 0;
  while (true) {
    const job = await redis.rpoplpush(QUEUE_ACTIVE, QUEUE_WAIT);
    if (!job) break;
    recovered++;
  }
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'queue_recover',
    entity: 'processing_queue',
    entityId: 'active',
    description: `Queue recovered: moved ${recovered} stale jobs back to wait by ${user?.username}`,
    metadata: { recovered },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ recovered, message: `กู้คืน ${recovered} งานสำเร็จ` });
}

async function purgeActiveQueueHandler(request: FastifyRequest, reply: FastifyReply) {
  const redis = getRedisClient();
  await redis.del(QUEUE_ACTIVE);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'queue_purge',
    entity: 'processing_queue',
    entityId: 'active',
    description: `Queue purged: cleared active queue by ${user?.username}`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ purged: true, message: 'ล้างคิวงานค้างสำเร็จ' });
}

async function getQueuePauseHandler(_request: FastifyRequest, reply: FastifyReply) {
  const redis = getRedisClient();
  const val = await redis.get('queue:paused');
  return reply.send({ paused: val === 'true' });
}

async function toggleQueuePauseHandler(request: FastifyRequest, reply: FastifyReply) {
  const redis = getRedisClient();
  const { paused } = request.body as { paused: boolean };
  if (paused) {
    await redis.set('queue:paused', 'true');
  } else {
    await redis.del('queue:paused');
  }
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'queue_pause_toggle',
    entity: 'processing_queue',
    entityId: 'paused',
    description: `Queue pause toggled to ${paused} by ${user?.username}`,
    metadata: { paused },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ paused, message: paused ? 'พักคิวงานเรียบร้อย' : 'เริ่มทำงานคิวต่อเรียบร้อย' });
}

export async function processingLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, searchHandler);
  app.get('/stats', { preHandler: [app.authenticate] }, statsHandler);
  app.get('/trends', { preHandler: [app.authenticate] }, trendsHandler);
  app.get('/executive-defects', { preHandler: [app.authenticate, requirePermission('executive:read')] }, executiveDefectsHandler);
  app.get('/defect-heatmap', { preHandler: [app.authenticate, requirePermission('executive:read')] }, defectHeatmapHandler);
  app.get('/bulk-delete-preview', { preHandler: [app.authenticate, requirePermission('processing:create')] }, bulkDeletePreviewHandler);
  app.post('/bulk-delete', { preHandler: [app.authenticate, requirePermission('processing:create')] }, bulkDeleteHandler);
  app.get('/stream', streamHandler);
  app.post('/:id/retry', { preHandler: [app.authenticate, requirePermission('processing:create')] }, retryHandler);
  app.post('/:id/reject', { preHandler: [app.authenticate, requirePermission('processing:create')] }, rejectHandler);
  app.get('/queue-health', { preHandler: [app.authenticate] }, queueHealthHandler);
  app.post('/queue-recover', { preHandler: [app.authenticate, requirePermission('processing:create')] }, recoverQueueHandler);
  app.post('/queue-purge', { preHandler: [app.authenticate, requirePermission('processing:create')] }, purgeActiveQueueHandler);
  app.get('/queue-pause', { preHandler: [app.authenticate] }, getQueuePauseHandler);
  app.post('/queue-pause', { preHandler: [app.authenticate, requirePermission('processing:create')] }, toggleQueuePauseHandler);
  app.get('/dlq/summary', { preHandler: [app.authenticate] }, dlqSummaryHandler);
  app.post('/dlq/bulk-retry', { preHandler: [app.authenticate, requirePermission('dead-letter:create')] }, bulkRetryHandler);
  app.post('/dlq/bulk-reject', { preHandler: [app.authenticate, requirePermission('dead-letter:create')] }, bulkRejectHandler);
}
