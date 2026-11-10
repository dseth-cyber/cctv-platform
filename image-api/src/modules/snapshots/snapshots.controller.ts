import { allowedCameraIds, guardCameraParam } from '../access/camera-scope.js';
import { viewLogHook } from '../access/sensitive-view.js';
import { hasPermissionFor, liveQuotaFor } from '../access/live-access.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { openRtspUrl, parseRtspLogin } from '../../lib/rtsp-credentials.js';
import { logger } from '../../lib/logger.js';
import { requirePermission } from '../../middleware/rbac.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { computeSnapshotAdvice } from './snapshot-advice.js';
import { SnapshotScheduler, type SchedulerSettings } from './snapshot-scheduler.js';
import { fetchSnapshot, type SnapshotTarget } from './snapshot-sources.js';
import { resolveRefreshSeconds } from './refresh-tiers.js';

const MAX_IDS_PER_REQUEST = 500;
const TARGET_CACHE_MS = 30_000;
const SETTINGS_CACHE_MS = 15_000;
const RTSP_CONCURRENCY = 4;

let settings: SchedulerSettings & { staleSeconds: number; maxStreamsPerUser: number; autoHd: Record<string, boolean> } = {
  refreshSeconds: 30, deviceConcurrency: 3, globalConcurrency: 16, rtspConcurrency: RTSP_CONCURRENCY,
  cacheBytes: 128 * 1024 * 1024, staleSeconds: 120, maxStreamsPerUser: 16, autoHd: { '1x1': true, '2x2': true, '3x3': false, '4x4': false },
};
let settingsLoadedAt = 0;

async function refreshSettings() {
  if (Date.now() - settingsLoadedAt < SETTINGS_CACHE_MS) return settings;
  settingsLoadedAt = Date.now();
  const c = await getAllConfigs();
  settings = {
    refreshSeconds: Number(c.live_snapshot_refresh_seconds?.value ?? 30),
    deviceConcurrency: Number(c.live_snapshot_device_concurrency?.value ?? 3),
    globalConcurrency: Number(c.live_snapshot_global_concurrency?.value ?? 16),
    rtspConcurrency: RTSP_CONCURRENCY,
    cacheBytes: Number(c.live_snapshot_cache_mb?.value ?? 128) * 1024 * 1024,
    staleSeconds: Number(c.live_snapshot_stale_seconds?.value ?? 120),
    maxStreamsPerUser: Number(c.live_max_streams_per_user?.value ?? 16),
    autoHd: {
      '1x1': true,
      // getAllConfigs parses booleans; a missing row falls back to the default (2x2 on, 3x3/4x4 off).
      '2x2': c.live_auto_hd_2x2?.value !== false,
      '3x3': c.live_auto_hd_3x3?.value === true,
      '4x4': c.live_auto_hd_4x4?.value === true,
    },
  };
  return settings;
}

const scheduler = new SnapshotScheduler(fetchSnapshot, () => settings);
let timer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

export function startSnapshotScheduler() {
  if (timer) return;
  timer = setInterval(() => scheduler.pump(), 1000);
  sweepTimer = setInterval(() => scheduler.sweep(), 60_000);
  timer.unref();
  sweepTimer.unref();
}

export function stopSnapshotScheduler() {
  if (timer) clearInterval(timer);
  if (sweepTimer) clearInterval(sweepTimer);
  timer = sweepTimer = null;
}

/** What it takes to fetch a camera, decrypted only here and kept in memory for a short while. */
const targetCache = new Map<string, { target: SnapshotTarget | null; loadedAt: number }>();

async function loadTargets(ids: string[]): Promise<{ id: string; target: SnapshotTarget | null }[]> {
  const now = Date.now();
  const stale = ids.filter((id) => now - (targetCache.get(id)?.loadedAt ?? 0) > TARGET_CACHE_MS);
  if (stale.length > 0) {
    const rows = await getPrisma().camera.findMany({
      where: { id: { in: stale }, deletedAt: null },
      select: {
        id: true, ipAddress: true, channelNumber: true, metadata: true, rtspUrl: true, rtspUrlSub: true, snapshotRefreshSeconds: true,
        device: { select: { ipAddress: true, brand: true, httpPort: true, snapshotRefreshSeconds: true } },
        groupMemberships: { select: { group: { select: { snapshotRefreshSeconds: true } } } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of stale) {
      const row = byId.get(id);
      targetCache.set(id, { target: row ? toTarget(row) : null, loadedAt: now });
    }
  }
  return ids.map((id) => ({ id, target: targetCache.get(id)?.target ?? null }));
}

function toTarget(row: any): SnapshotTarget | null {
  const rtspUrl = openRtspUrl(row.rtspUrlSub) ?? openRtspUrl(row.rtspUrl);
  const login = parseRtspLogin(rtspUrl);
  const host = row.device?.ipAddress ?? row.ipAddress ?? login.host;
  if (!host || !rtspUrl) return null;
  const connection = row.metadata?.connection;
  return {
    cameraId: row.id,
    host,
    httpPort: row.device?.httpPort ?? 80,
    loginKey: crypto.createHash('sha256').update(`${login.username}:${login.password}`).digest('hex'),
    username: login.username,
    password: login.password,
    brand: row.device?.brand ?? connection?.brand ?? null,
    channel: row.channelNumber ?? connection?.channel ?? 1,
    rtspUrl,
    refreshSeconds: ownRefresh(row),
  };
}

/** The camera's own refresh from its levels, or null when it follows the system value (read live by the scheduler). */
function ownRefresh(row: any): number | null {
  const r = resolveRefreshSeconds({
    camera: row.snapshotRefreshSeconds,
    groups: (row.groupMemberships ?? []).map((m: any) => m.group?.snapshotRefreshSeconds),
    device: row.device?.snapshotRefreshSeconds,
    system: 0,
  });
  return r.source === 'system' ? null : r.seconds;
}

const requestSchema = z.object({ ids: z.array(z.guid()).max(MAX_IDS_PER_REQUEST) });

async function requestHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids } = requestSchema.parse(request.body);
  const allowed = await allowedCameraIds(request);
  const current = await refreshSettings();
  const items = scheduler.request(await loadTargets(allowed === null ? ids : ids.filter((id) => allowed.includes(id))));
  return reply.send({ items, refreshSeconds: current.refreshSeconds, behind: scheduler.stats().behind });
}

async function imageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const held = scheduler.image(id);
  if (!held) return reply.status(404).send({ message: 'No image yet' });
  // Live evidence of a site: not to be kept by shared caches or on disk by the browser.
  return reply.header('cache-control', 'private, no-store').header('x-captured-at', String(held.capturedAt)).type('image/jpeg').send(held.image);
}

async function settingsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { refreshSeconds, staleSeconds, maxStreamsPerUser, autoHd } = await refreshSettings();
  const userId = (request as any).user?.id;
  // This person's own limit (user, then role, then system) and what they may do with live video.
  return reply.send({
    refreshSeconds, staleSeconds, autoHd,
    maxStreamsPerUser: await liveQuotaFor(userId, maxStreamsPerUser),
    hdAllowed: await hasPermissionFor(userId, 'live:hd'),
  });
}

const adviceSchema = z.object({
  refreshSeconds: z.coerce.number().min(1).max(86_400).optional(),
  deviceConcurrency: z.coerce.number().int().min(1).max(1000).optional(),
  globalConcurrency: z.coerce.number().int().min(1).max(1000).optional(),
});

async function adviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const q = adviceSchema.parse(request.query);
  const current = await refreshSettings();
  const cameras = await getPrisma().camera.findMany({
    where: { enabled: true, deletedAt: null, rtspUrl: { not: null } },
    select: { id: true, deviceId: true, ipAddress: true },
  });
  const perDevice = new Map<string, number>();
  for (const c of cameras) {
    const key = c.deviceId ?? c.ipAddress ?? c.id;
    perDevice.set(key, (perDevice.get(key) ?? 0) + 1);
  }
  const stats = scheduler.stats();
  const advice = computeSnapshotAdvice({
    cameras: cameras.length,
    busiestDeviceCameras: Math.max(0, ...perDevice.values()),
    refreshSeconds: q.refreshSeconds ?? current.refreshSeconds,
    deviceConcurrency: q.deviceConcurrency ?? current.deviceConcurrency,
    globalConcurrency: q.globalConcurrency ?? current.globalConcurrency,
    avgMs: stats.avgMs,
    avgBytes: stats.avgBytes,
    samples: stats.samples,
  });
  return reply.send({ advice, now: { demanded: stats.demanded, imagesPerMinute: stats.imagesPerMinute, behind: stats.behind, cacheMb: Math.round(stats.cacheBytes / 1048576) } });
}

export async function snapshotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/request', { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('live:view')] }, requestHandler);
  app.get('/image/:id', { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('live:view'), guardCameraParam()], onResponse: [viewLogHook('still', (r) => (r.params as any).id)] }, imageHandler);
  app.get('/settings', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, settingsHandler);
  app.get('/advice', { preHandler: [app.authenticate, requirePermission('system-config:read')] }, adviceHandler);
  refreshSettings().catch((err) => logger.warn({ err }, 'Could not load snapshot settings yet'));
}
