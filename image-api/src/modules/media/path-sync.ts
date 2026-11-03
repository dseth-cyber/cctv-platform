import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { openRtspUrl } from '../../lib/rtsp-credentials.js';
import { MediaMtxService } from './mediamtx.service.js';

/**
 * Keeps MediaMTX's runtime path config in line with the camera table, so every enabled camera is
 * pulled and recorded continuously — not only after someone opened its live view — and comes back
 * on its own after MediaMTX restarts (paths added through the API live only in memory).
 *
 * Paths under sim/ are the static test generators in mediamtx.yml and are never touched.
 */
export function cameraBasePath(camera: { id: string; streamPath: string | null }): string {
  return camera.streamPath || `camera_${camera.id.replace(/-/g, '').substring(0, 12)}`;
}

export const isSubStreamPath = (name: string) => name.endsWith('_sub');

export async function desiredCameraPaths(): Promise<Map<string, string>> {
  const cameras = await getPrisma().camera.findMany({
    where: { enabled: true, deletedAt: null, rtspUrl: { not: null } },
    select: { id: true, streamPath: true, rtspUrl: true, rtspUrlSub: true },
  });
  const desired = new Map<string, string>();
  for (const cam of cameras) {
    const base = cameraBasePath(cam).replace(/^\/+/, '');
    if (base.startsWith('sim/')) continue;
    const main = openRtspUrl(cam.rtspUrl);
    if (main) desired.set(base, main);
    const sub = openRtspUrl(cam.rtspUrlSub);
    if (sub) desired.set(`${base}_sub`, sub);
  }
  return desired;
}

export async function syncCameraPaths() {
  const desired = await desiredCameraPaths();
  const res = await MediaMtxService.apiFetch('/v3/config/paths/list?itemsPerPage=1000');
  if (!res.ok) throw new Error(`MediaMTX config list failed: HTTP ${res.status}`);
  const configured = ((await res.json()) as any)?.items ?? [];
  const current = new Map<string, string>(configured.map((p: any) => [String(p.name), String(p.source ?? '')]));

  const summary = { registered: 0, removed: 0, failed: 0 };
  for (const [name, source] of desired) {
    if (current.get(name) === source) continue;
    if (await MediaMtxService.registerStreamPath(name, source, { liveOnly: isSubStreamPath(name) })) summary.registered++;
    else summary.failed++;
  }
  // Camera pulls (rtsp sources) that no enabled camera wants any more: disabled, deleted or renamed.
  for (const [name, source] of current) {
    if (desired.has(name) || name.startsWith('sim/') || !/^rtsps?:\/\//i.test(source)) continue;
    if (await MediaMtxService.removeStreamPath(name)) summary.removed++;
    else summary.failed++;
  }
  if (summary.registered || summary.removed || summary.failed) {
    logger.info(summary, 'MediaMTX camera paths synced');
  }
  return summary;
}

let syncTimer: NodeJS.Timeout | null = null;

export function startCameraPathSync(intervalMs = Number(process.env.CAMERA_PATH_SYNC_INTERVAL_MS || 60_000)) {
  const run = () => syncCameraPaths().catch((err) => logger.warn({ err: err?.message ?? err }, 'MediaMTX camera path sync failed'));
  setTimeout(run, 5_000);
  if (intervalMs > 0) syncTimer = setInterval(run, intervalMs);
}

export function stopCameraPathSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}
