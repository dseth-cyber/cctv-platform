import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.controller.js';
import { checkDatabaseConnection, getPrisma } from '../../lib/prisma.js';

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: vi.fn(),
  checkDatabaseConnection: vi.fn(),
}));

vi.mock('../../lib/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue('PONG'),
    llen: vi.fn().mockResolvedValue(0),
    scard: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
  }),
}));

vi.mock('../../lib/storage/storage-router.js', () => ({
  storageRouter: {
    getAll: vi.fn().mockReturnValue([
      {
        id: 'mock-provider',
        name: 'Mock Storage',
        type: 'local',
        health: vi.fn().mockResolvedValue({ ok: true, latencyMs: 2 }),
      },
    ]),
  },
}));

async function buildTestApp() {
  const app = Fastify();
  await app.register(healthRoutes, { prefix: '/api/v1/health' });
  return app;
}

describe('HealthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDatabaseConnection).mockResolvedValue(true);
    vi.mocked(getPrisma).mockReturnValue({
      storageProvider: {
        findMany: vi.fn().mockResolvedValue([{ id: 'mock-provider' }]),
      },
    } as any);
  });

  it('GET /api/v1/health should return ok', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('GET /api/v1/health/live should return ok', async () => {
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
  });

  it('GET /api/v1/health/ready should return 200 when DB is up', async () => {
    vi.mocked(checkDatabaseConnection).mockResolvedValue(true);
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.checks.database).toBe('ok');
  });

  it('GET /api/v1/health/ready should return 503 when DB is down', async () => {
    vi.mocked(checkDatabaseConnection).mockResolvedValue(false);
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.checks.database).toBe('down');
    expect(body.status).toBe('degraded');
  });
});
