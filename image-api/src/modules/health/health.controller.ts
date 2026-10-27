import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import os from 'os';
import fs from 'fs';
import { checkDatabaseConnection, getPrisma } from '../../lib/prisma.js';
import { getRedisClient } from '../../lib/redis.js';
import { storageRouter } from '../../lib/storage/storage-router.js';

interface HealthCheck {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    database: 'ok' | 'down';
    redis: 'ok' | 'down';
    storage: 'ok' | 'degraded' | 'down';
  };
  system: {
    hostname: string;
    platform: string;
    cpuCores: number;
    memoryTotal: number;
    memoryFree: number;
    memoryUsed: number;
    memoryUsagePercent: number;
    diskTotal: number;
    diskFree: number;
    diskUsed: number;
    diskUsagePercent: number;
    loadAvg: number[];
    nodeVersion: string;
  };
  queue: { wait: number; active: number; failed: number; delayed: number };
  providers: Array<{ id: string; name: string; type: string; status: 'ok' | 'down'; latencyMs: number }>;
}

async function checkStorageHealth(): Promise<{ status: 'ok' | 'degraded' | 'down'; providers: HealthCheck['providers'] }> {
  try {
    // The router keeps inactive providers registered too (so files already
    // stored on a since-disabled provider can still be resolved) — but a
    // disabled provider (e.g. an unused example entry) has no business
    // showing up as a health failure, so filter to active ones here.
    const prisma = getPrisma();
    const activeIds = new Set(
      (await prisma.storageProvider.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } }))
        .map((p) => p.id),
    );
    const all = storageRouter.getAll().filter((p) => activeIds.has(p.id));
    if (all.length === 0) return { status: 'down', providers: [] };

    const results = await Promise.all(all.map(async (p) => {
      const h = await p.health();
      return { id: p.id, name: p.name, type: p.type, status: h.ok ? 'ok' as const : 'down' as const, latencyMs: h.latencyMs };
    }));

    const anyDown = results.some(r => r.status === 'down');
    return { status: anyDown ? 'degraded' : 'ok', providers: results };
  } catch {
    return { status: 'down', providers: [] };
  }
}

async function checkRedis(): Promise<'ok' | 'down'> {
  try {
    const redis = getRedisClient();
    await redis.ping();
    return 'ok';
  } catch { return 'down'; }
}

async function getQueueMetrics() {
  try {
    const redis = getRedisClient();
    const [wait, active, failed, delayed] = await Promise.all([
      redis.llen('bull:image-processing:wait'),
      redis.llen('bull:image-processing:active'),
      redis.zcard('bull:image-processing:failed'),
      redis.zcard('bull:image-processing:delayed'),
    ]);
    return { wait, active, failed, delayed };
  } catch { return { wait: 0, active: 0, failed: 0, delayed: 0 }; }
}

function getSystemInfo() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;

  let diskTotal = 0, diskFree = 0;
  try {
    const stat = fs.statfsSync('/');
    diskTotal = stat.bsize * stat.blocks;
    diskFree = stat.bsize * stat.bavail;
  } catch { /* skip */ }

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCores: os.cpus().length,
    memoryTotal: memTotal,
    memoryFree: memFree,
    memoryUsed: memUsed,
    memoryUsagePercent: Math.round((memUsed / memTotal) * 1000) / 10,
    diskTotal,
    diskFree,
    diskUsed: diskTotal - diskFree,
    diskUsagePercent: diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 1000) / 10 : 0,
    loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100),
    nodeVersion: process.version,
  };
}

async function basicHealth(_request: FastifyRequest, reply: FastifyReply) {
  const [storageHealth, redisStatus, queue, dbOk] = await Promise.all([
    checkStorageHealth(),
    checkRedis(),
    getQueueMetrics(),
    checkDatabaseConnection(),
  ]);

  const allOk = dbOk && redisStatus === 'ok' && storageHealth.status !== 'down';

  const health: HealthCheck = {
    status: allOk ? 'ok' : 'degraded',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? 'ok' : 'down',
      redis: redisStatus,
      storage: storageHealth.status,
    },
    system: getSystemInfo(),
    queue,
    providers: storageHealth.providers,
  };

  return reply.status(200).send(health);
}

async function readinessCheck(_request: FastifyRequest, reply: FastifyReply) {
  const [dbOk, storageHealth, redisStatus, queue] = await Promise.all([
    checkDatabaseConnection(),
    checkStorageHealth(),
    checkRedis(),
    getQueueMetrics(),
  ]);

  const allOk = dbOk && redisStatus === 'ok' && storageHealth.status !== 'down';

  const health: HealthCheck = {
    status: allOk ? 'ok' : 'degraded',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? 'ok' : 'down',
      redis: redisStatus,
      storage: storageHealth.status,
    },
    system: getSystemInfo(),
    queue,
    providers: storageHealth.providers,
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  return reply.status(statusCode).send(health);
}

async function livenessCheck(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', basicHealth);
  app.get('/ready', readinessCheck);
  app.get('/live', livenessCheck);
}
