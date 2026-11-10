import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';

/**
 * Who looked at a camera marked sensitive (cameras.sensitive, e.g. HR interview rooms), and how: kept in the audit
 * log for privacy duties. Only a request that succeeded is written, and one person, camera and kind at most once
 * per window, since a live wall asks for the same stream again on every reconnect or HD switch.
 */
export type ViewKind = 'live' | 'still' | 'playback' | 'clip_export' | 'clip_download';
export const VIEW_LOG_WINDOW_MS = 10 * 60_000;
const SENSITIVE_CACHE_MS = 30_000;

const lastLogged = new Map<string, number>();
const sensitiveCache = new Map<string, { sensitive: boolean; name: string; at: number }>();

/** True when this view should be written now (and remembers it); false inside the window. */
export function dueForLog(key: string, now = Date.now()): boolean {
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < VIEW_LOG_WINDOW_MS) return false;
  lastLogged.set(key, now);
  if (lastLogged.size > 20_000) {
    for (const [k, t] of lastLogged) if (now - t >= VIEW_LOG_WINDOW_MS) lastLogged.delete(k);
  }
  return true;
}

async function cameraInfo(cameraId: string) {
  const hit = sensitiveCache.get(cameraId);
  if (hit && Date.now() - hit.at < SENSITIVE_CACHE_MS) return hit;
  const cam = await getPrisma().camera.findUnique({ where: { id: cameraId }, select: { sensitive: true, name: true } });
  const info = { sensitive: !!cam?.sensitive, name: cam?.name ?? '', at: Date.now() };
  sensitiveCache.set(cameraId, info);
  return info;
}

export async function logSensitiveView(request: FastifyRequest, cameraId: string | null | undefined, kind: ViewKind, extra?: Record<string, unknown>) {
  if (!cameraId) return;
  const cam = await cameraInfo(cameraId);
  if (!cam.sensitive) return;
  const user = (request as any).user;
  if (!dueForLog(`${user?.id ?? 'anon'}:${cameraId}:${kind}`)) return;
  await createAuditLog({
    userId: user?.id,
    action: 'camera_sensitive_view',
    entity: 'camera',
    entityId: cameraId,
    description: `${user?.username ?? 'unknown'} ${kind.replace('_', ' ')}: ${cam.name}`,
    metadata: { kind, camera: cam.name, ...extra },
    ipAddress: request.ip,
  });
}

/** Route hook: after a successful reply, log the view of the camera the request was about. */
export function viewLogHook(kind: ViewKind, cameraOf: (request: FastifyRequest) => string | null | undefined | Promise<string | null | undefined>, extra?: (request: FastifyRequest) => Record<string, unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.statusCode >= 400) return;
    try {
      await logSensitiveView(request, await cameraOf(request), kind, extra?.(request));
    } catch {
      // The view already happened; a log that could not be written must not turn it into an error.
    }
  };
}

/** The camera of a clip, by id or by its file name. */
export async function cameraOfClip(where: { id?: string; filename?: string }): Promise<string | null> {
  const prisma = getPrisma();
  if (where.id) return (await prisma.recordingClip.findUnique({ where: { id: where.id }, select: { cameraId: true } }))?.cameraId ?? null;
  if (where.filename) return (await prisma.recordingClip.findFirst({ where: { downloadUrl: { endsWith: `/${where.filename}` } }, select: { cameraId: true } }))?.cameraId ?? null;
  return null;
}

/** Forget the cached flag of a camera when it changes, so the next view is judged by the new value. */
export function forgetSensitive(cameraId: string) {
  sensitiveCache.delete(cameraId);
}
