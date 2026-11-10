import { allowedCameraIds, assertCameraAccess, cameraWhere, guardAllCameras, guardCameraIdsBody, guardCameraParam, guardIncidentAttachment, guardIncidentParam } from '../access/camera-scope.js';
import { viewLogHook } from '../access/sensitive-view.js';
import { hasPermissionFor } from '../access/live-access.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cameraDeletionImpact } from './camera-deletion.js';
import { importCameraInfo } from './camera-info-import.js';
import { syncCameraPaths } from '../media/path-sync.js';
import { bulkUpdateCameraSchema, deletionImpactSchema, createCameraSchema, updateCameraSchema, cameraQuerySchema, detectStreamSchema } from './cameras.schema.js';
import { detectCameraStream } from './stream-detect.service.js';
import { getPrisma } from '../../lib/prisma.js';
import * as camerasService from './cameras.service.js';
import * as cameraAnalytics from './camera-analytics.service.js';
import * as incidentService from './camera-incident.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { requirePermission } from '../../middleware/rbac.js';
import { openRtspUrl, extractRtspPassword } from '../../lib/rtsp-credentials.js';
import { getRedisClient } from '../../lib/redis.js';
import { createAuditLog } from '../audit/audit.service.js';
import { createAlert } from '../alerts/alerts.service.js';
import { removeWorkOrderFiles } from '../work-orders/work-orders.service.js';
import { sendWebhook } from '../../lib/webhook.js';
import { formatDuration } from '../../lib/format.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';

const ATTACHMENT_DIR = '/app/incident-attachments';

function ensureAttachmentDir() {
  if (!existsSync(ATTACHMENT_DIR)) {
    mkdirSync(ATTACHMENT_DIR, { recursive: true });
  }
}

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  const filters = cameraQuerySchema.parse(request.query);
  const cameras = await camerasService.listCameras(await cameraWhere(request), filters);
  const role = (request as any).user?.role;
  return reply.status(200).send(cameras.map((c) => camerasService.toPublicCamera(c, role)));
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const camera = await camerasService.getCameraById(id);
  return reply.status(200).send(camerasService.toPublicCamera(camera, (request as any).user?.role));
}

/** Share of the total live limit past which automatic HD is served as the sub stream instead. */
export const AUTO_HD_SHARE = 0.75;

async function getStreamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { profile, auto } = (request.query as { profile?: 'main' | 'sub'; auto?: string }) || {};
  const camera = await camerasService.getCameraById(id);
  if (!camera) {
    return reply.status(404).send({ error: 'Camera not found' });
  }

  // The hard stop on total load: past it viewers get still images instead of slowing everyone down.
  const limit = Number((await getAllConfigs()).live_max_streams_total?.value ?? 64);
  const sessions = await MediaMtxService.countWebrtcSessions();
  if (sessions !== null && sessions >= limit) {
    return reply.status(429).send({ statusCode: 429, error: 'LiveLimit', message: 'Live stream limit reached', details: { code: 'LIVE_LIMIT', limit } });
  }

  // HD asked for by a wall setting, not by a person: near the total limit it falls back to the sub stream, so
  // an automatic upgrade never takes the last places from people who need them.
  const degraded = profile === 'main' && auto === '1' && Boolean(camera.rtspUrlSub) && sessions !== null && sessions >= Math.ceil(limit * AUTO_HD_SHARE);
  // Without the HD right the main stream is not handed out where a sub stream exists (a camera with only one stream
  // still shows it).
  const noHdRight = profile !== 'sub' && Boolean(camera.rtspUrlSub) && !(await hasPermissionFor((request as any).user?.id, 'live:hd'));
  const isSub = (profile === 'sub' || degraded || noHdRight) && Boolean(camera.rtspUrlSub);
  const targetRtsp = openRtspUrl(isSub ? camera.rtspUrlSub : camera.rtspUrl);
  const basePath = camera.streamPath || `camera_${camera.id.replace(/-/g, '').substring(0, 12)}`;
  const streamPath = isSub ? `${basePath}_sub` : basePath;

  if (targetRtsp) {
    await MediaMtxService.registerStreamPath(streamPath, targetRtsp, { liveOnly: isSub || (camera as any).recordingMode !== 'continuous' });
  }

  const user = (request as any).user;
  const token = MediaMtxService.generateStreamToken(streamPath, user?.id || user?.username || 'viewer');
  const urls = MediaMtxService.getStreamUrls(streamPath, token);

  return reply.status(200).send({
    cameraId: camera.id,
    name: camera.name,
    profile: isSub ? 'sub' : 'main',
    degraded,
    hdAllowed: !noHdRight,
    hasSubStream: Boolean(camera.rtspUrlSub),
    hasRtsp: Boolean(targetRtsp),
    ...urls,
  });
}

async function eventsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const query = request.query as Record<string, string>;
  const events = await camerasService.getCameraEvents(id, {
    since: query.since,
    until: query.until,
    limit: query.limit ? parseInt(query.limit, 10) : undefined,
  });
  return reply.status(200).send(events);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createCameraSchema.parse(request.body);
  const user = (request as any).user;
  const camera = await camerasService.createCamera({ ...input, createdBy: user?.username });
  const redis = getRedisClient();
  await redis.set('sync:scan-now', 'all', 'EX', 60);

  createAuditLog({
    userId: user?.id,
    action: 'camera_create',
    entity: 'camera',
    entityId: camera.id,
    description: `Camera "${camera.name}" created by ${user?.username ?? 'system'}`,
    metadata: { cameraName: camera.name, ipAddress: camera.ipAddress },
    ipAddress: request.ip,
  }).catch(() => {});

  // Reuses the camera_offline alertType (same convention as the delete alert below) so
  // it rides the existing "Camera Offline Alert" rule/Telegram channel — no new rule
  // needed.
  createAlert({
    alertType: 'camera_offline',
    severity: 'info',
    source: camera.id,
    title: `Camera created: ${camera.name}`,
    message: `Camera "${camera.name}" was created by ${user?.username ?? 'system'}${camera.ipAddress ? `. IP: ${camera.ipAddress}` : ''}`,
    details: { cameraId: camera.id, cameraName: camera.name, createdBy: user?.username, ipAddress: camera.ipAddress },
    skipDedup: true,
    // A deliberate one-off admin action — never suppress it via the flapping-camera
    // cooldown (see notifications/index.ts).
    bypassCooldown: true,
  }).catch(() => {});

  return reply.status(201).send(camerasService.toPublicCamera(camera, user?.role));
}

/** The same change on many cameras. One that cannot take it is reported and the others still change. */
const cameraInfoImportSchema = z.object({
  dryRun: z.boolean().default(true),
  items: z.array(z.object({
    id: z.string().uuid(),
    cameraType: z.string().max(128).nullish(),
    cameraBrand: z.string().max(128).nullish(),
    cameraModel: z.string().max(256).nullish(),
  })).min(1).max(2000),
});

/** Type/brand/model of many cameras from a filled-in sheet: a dry run shows what would change, then it is applied. */
async function cameraInfoImportHandler(request: FastifyRequest, reply: FastifyReply) {
  const { dryRun, items } = cameraInfoImportSchema.parse(request.body);
  // Only cameras this person may see can be in the sheet.
  for (const item of items) await assertCameraAccess(request, item.id);
  const result = await importCameraInfo(items, dryRun);
  if (!dryRun && result.applied > 0) {
    const user = (request as any).user;
    createAuditLog({
      userId: user?.id,
      action: 'camera_info_import',
      entity: 'camera',
      entityId: 'many',
      description: `Camera type/brand/model updated from a sheet for ${result.applied} camera(s) by ${user?.username ?? 'unknown'}`,
      metadata: { changes: result.results.filter((r) => r.status === 'update').map((r) => ({ id: r.id, name: r.name, changes: r.changes })) },
      ipAddress: request.ip,
    }).catch(() => {});
  }
  return reply.status(200).send(result);
}

async function bulkUpdateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids, changes } = bulkUpdateCameraSchema.parse(request.body);
  const user = (request as any).user;
  const failed: Array<{ id: string; name: string; message: string }> = [];
  let updated = 0;
  for (const id of ids) {
    try {
      await camerasService.updateCamera(id, { ...changes, _changedBy: user?.username } as any);
      updated++;
    } catch (err) {
      const row = await camerasService.getCameraById(id).catch(() => null);
      failed.push({ id, name: row?.name ?? id, message: err instanceof Error ? err.message : 'Failed' });
    }
  }
  createAuditLog({
    userId: user?.id,
    action: 'camera_bulk_update',
    entity: 'camera',
    description: `${updated} cameras updated together by ${user?.username ?? 'unknown'}`,
    metadata: { ids, changes: Object.keys(changes), failed: failed.length },
    ipAddress: request.ip,
  }).catch(() => {});
  if (changes.enabled !== undefined) void syncCameraPaths().catch(() => {});
  return reply.send({ updated, failed });
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, any>;
  const incidentFields = {
    reason: body.reason as string | undefined,
    incidentDescription: body.incidentDescription as string | undefined,
    rootCause: body.rootCause as string | undefined,
    estimatedFinish: body.estimatedFinish as string | undefined,
    resolution: body.resolution as string | undefined,
    correctiveAction: body.correctiveAction as string | undefined,
    preventiveAction: body.preventiveAction as string | undefined,
    priority: body.priority as string | undefined,
    impact: body.impact as string | undefined,
    assignedTo: body.assignedTo as string | undefined,
    problemDesc: body.problemDesc as string | undefined,
    resolutionDesc: body.resolutionDesc as string | undefined,
    observers: body.observers as any[] | undefined,
  };
  const input = updateCameraSchema.parse(body);
  const user = (request as any).user;

  const beforeCamera = await camerasService.getCameraById(id);
  const camera = await camerasService.updateCamera(id, { ...input, _changedBy: user?.username } as any);
  // A camera switched off stops being pulled now rather than at the next sync.
  if (input.enabled !== undefined && input.enabled !== beforeCamera.enabled) void syncCameraPaths().catch(() => {});

  if (input.status && input.status !== beforeCamera.status) {
    createAuditLog({
      userId: user?.id,
      action: 'camera_status_change',
      entity: 'camera',
      entityId: id,
      description: `Camera "${camera.name}" status changed: ${beforeCamera.status} → ${input.status} by ${user?.username ?? 'system'}`,
      metadata: { previousStatus: beforeCamera.status, newStatus: input.status },
      ipAddress: request.ip,
    }).catch(() => {});

    const statusLabels: Record<string, string> = { active: 'online', maintenance: 'maintenance', inactive: 'offline', error: 'error' };

    // Incident management runs BEFORE the alert is built (moved up from after) so the
    // alert message can reference the incident number and, when recovering, how long
    // the camera was actually down — none of that existed yet when this ran after.
    let incidentNumber: string | undefined;
    let downtimeLabel: string | undefined;
    const detailParts: string[] = [];
    const configs = await getAllConfigs();
    const incidentsUrl = configs.public_base_url?.value ? `${configs.public_base_url.value}/cctv/incidents` : null;

    if (input.status === 'active') {
      // Resolving: auto-resolve any open incident for this camera
      const openIncident = await incidentService.getOpenIncidentForCamera(id);
      if (openIncident) {
        // A person's work goes to be checked. A service key is the system itself, with nobody to check it.
        const closing = {
          resolution: incidentFields.resolution,
          rootCause: incidentFields.rootCause,
          correctiveAction: incidentFields.correctiveAction,
          preventiveAction: incidentFields.preventiveAction,
        };
        const resolved = user?.username && user.role !== 'system'
          ? await incidentService.submitForVerification(openIncident.id, { ...closing, submittedBy: user.username })
          : await incidentService.resolveIncident(openIncident.id, { ...closing, closedBy: user?.username ?? 'system' });
        incidentNumber = resolved.incidentNumber;
        downtimeLabel = formatDuration(Date.now() - openIncident.openedAt.getTime());
        detailParts.push(`Downtime: ${downtimeLabel}`);
        detailParts.push(`Incident ${incidentNumber} ${resolved.status === 'pending' ? 'waiting to be checked' : 'resolved'}`);
        if (incidentFields.resolution) detailParts.push(`Resolution: ${incidentFields.resolution}`);
        if (incidentFields.rootCause) detailParts.push(`RootCause: ${incidentFields.rootCause}`);
        if (incidentFields.correctiveAction) detailParts.push(`CorrectiveAction: ${incidentFields.correctiveAction}`);
        if (incidentFields.preventiveAction) detailParts.push(`PreventiveAction: ${incidentFields.preventiveAction}`);
        if (incidentFields.resolutionDesc) detailParts.push(`Notes: ${incidentFields.resolutionDesc}`);
        if (incidentsUrl) detailParts.push(`Link: ${incidentsUrl}?incident=${incidentNumber}`);
      }
    } else if (incidentFields.reason) {
      // Going to non-active status with a reason: create incident
      const created = await incidentService.createIncident({
        cameraId: id,
        fromStatus: beforeCamera.status,
        toStatus: input.status,
        reason: incidentFields.reason,
        rootCause: incidentFields.rootCause,
        description: incidentFields.incidentDescription,
        problemDesc: incidentFields.problemDesc,
        estimatedFinish: incidentFields.estimatedFinish,
        priority: incidentFields.priority,
        impact: incidentFields.impact,
        assignedTo: incidentFields.assignedTo,
        openedBy: user?.username ?? 'system',
        observers: incidentFields.observers,
      });
      incidentNumber = created.incidentNumber;
      detailParts.push(`Incident ${incidentNumber}`);
      detailParts.push(`Reason: ${incidentFields.reason}`);
      if (incidentFields.priority) detailParts.push(`Priority: ${incidentFields.priority}`);
      if (incidentFields.impact && incidentFields.impact !== 'none') detailParts.push(`Impact: ${incidentFields.impact}`);
      if (incidentFields.problemDesc) detailParts.push(`Details: ${incidentFields.problemDesc}`);
      // Attachments (if any) are uploaded in a separate follow-up request after this one
      // returns, so they never exist yet at alert-send time — link to the incident
      // instead of trying to inline a photo that isn't there.
      if (incidentsUrl) detailParts.push(`Link: ${incidentsUrl}?incident=${incidentNumber}`);
    }

    const baseMessage = `Camera "${camera.name}" status changed to ${input.status} by ${user?.username ?? 'system'}`;
    const message = detailParts.length > 0 ? `${baseMessage}. ${detailParts.join('. ')}.` : baseMessage;

    await createAlert({
      alertType: 'camera_offline',
      severity: input.status === 'active' ? 'info' : input.status === 'maintenance' ? 'warning' : 'critical',
      source: id,
      title: `Camera ${statusLabels[input.status] ?? input.status}: ${camera.name}`,
      message,
      details: {
        cameraId: id, cameraName: camera.name, previousStatus: beforeCamera.status, newStatus: input.status,
        changedBy: user?.username, incidentNumber, downtime: downtimeLabel,
        reason: incidentFields.reason, priority: incidentFields.priority, impact: incidentFields.impact,
      },
      skipDedup: true,
    });

    sendWebhook('camera.status_changed', { cameraId: id, cameraName: camera.name, previousStatus: beforeCamera.status, newStatus: input.status, changedBy: user?.username }).catch(() => {});
  } else if (Object.keys(input).length > 0 && user?.role !== 'system') {
    // Service-key callers (role 'system') update cameras as a heartbeat; auditing those
    // flooded audit_logs with no-op rows (incident_2026-08-07, from the former factory sync
    // worker). Real admin edits (any non-system caller) are still audited.
    createAuditLog({
      userId: user?.id,
      action: 'camera_update',
      entity: 'camera',
      entityId: id,
      description: `Camera "${camera.name}" updated by ${user?.username ?? 'system'}`,
      metadata: { changes: Object.keys(input) },
      ipAddress: request.ip,
    }).catch(() => {});
  }

  return reply.status(200).send(camerasService.toPublicCamera(camera, user?.role));
}

async function deleteCameraHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { password } = (request.body ?? {}) as { password: string };
  const user = (request as any).user;

  // Verify password
  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const camera = await camerasService.deleteCamera(id);

  createAuditLog({
    userId: user?.id,
    action: 'camera_delete',
    entity: 'camera',
    entityId: id,
    description: `Camera "${camera.name}" soft-deleted by ${user?.username ?? 'system'}`,
    metadata: { cameraName: camera.name, ipAddress: camera.ipAddress },
    ipAddress: request.ip,
  }).catch(() => {});

  await createAlert({
    alertType: 'camera_offline',
    severity: 'warning',
    source: id,
    title: `Camera deleted: ${camera.name}`,
    message: `Camera "${camera.name}" was deleted by ${user?.username ?? 'system'}${camera.ipAddress ? `. IP: ${camera.ipAddress}` : ''}`,
    details: { cameraId: id, cameraName: camera.name, deletedBy: user?.username, ipAddress: camera.ipAddress },
    skipDedup: true,
    // A deliberate one-off admin action — never suppress it via the flapping-camera
    // cooldown (see notifications/index.ts). Found 2026-08-08: a camera reusing the
    // same id across repeated delete/recreate test cycles only notified the first
    // time within the 60min cooldown window.
    bypassCooldown: true,
  });

  return reply.status(200).send({ deleted: true, camera });
}

async function permanentDeleteCameraHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { password } = (request.body ?? {}) as { password: string };
  const user = (request as any).user;

  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const camera = await camerasService.getCameraById(id);
  const { impact, files } = await camerasService.permanentlyDeleteCamera(id);

  createAuditLog({
    userId: user?.id,
    action: 'camera_permanent_delete',
    entity: 'camera',
    entityId: id,
    description: `Camera "${camera.name}" permanently deleted by ${user?.username ?? 'system'}`,
    metadata: {
      cameraName: camera.name,
      ipAddress: camera.ipAddress,
      recordings: impact.recordings,
      clips: impact.clipRecords.slice(0, 200),
      bytes: impact.bytes,
      filesRemoved: files.removed,
      filesNotRemoved: files.failed,
    },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(200).send({ deleted: true, filesRemoved: files.removed, filesNotRemoved: files.failed });
}

async function deletionImpactHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids } = deletionImpactSchema.parse(request.body);
  const { files: _files, clipRecords: _clips, ...impact } = await cameraDeletionImpact(ids);
  return reply.send(impact);
}

async function trashListHandler(request: FastifyRequest, reply: FastifyReply) {
  const cameras = await camerasService.listDeletedCameras(await cameraWhere(request));
  return reply.status(200).send(cameras);
}

async function restoreCameraHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;

  await camerasService.restoreCamera(id);

  createAuditLog({
    userId: user?.id,
    action: 'camera_restore',
    entity: 'camera',
    entityId: id,
    description: `Camera ${id} restored from trash by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(200).send({ restored: true });
}

async function emptyCameraTrashHandler(request: FastifyRequest, reply: FastifyReply) {
  const { password } = (request.body ?? {}) as { password: string };
  const user = (request as any).user;

  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const result = await camerasService.emptyCameraTrash();

  createAuditLog({
    userId: user?.id,
    action: 'camera_trash_empty',
    entity: 'camera',
    entityId: 'all',
    description: `Permanently deleted ${result.deleted} cameras from trash by ${user?.username ?? 'system'}`,
    metadata: { deleted: result.deleted, keptForLegalHold: result.keptForLegalHold, recordings: result.impact?.recordings, clips: result.impact?.clipRecords.slice(0, 200), filesRemoved: result.files?.removed, filesNotRemoved: result.files?.failed },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(200).send({ deleted: result.deleted, keptForLegalHold: result.keptForLegalHold, filesRemoved: result.files?.removed ?? 0, filesNotRemoved: result.files?.failed ?? [] });
}

async function analyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { period } = request.query as { period?: string };
  const result = await cameraAnalytics.getCameraDowntimeReport(id, period || '7d');
  return reply.send(result);
}

async function comparisonHandler(request: FastifyRequest, reply: FastifyReply) {
  const { period } = request.query as { period?: string };
  const result = await cameraAnalytics.getCameraComparisonReport(period || '7d', await cameraWhere(request));
  return reply.send(result);
}

// --- Incident Handlers ---

async function listIncidentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, status, page, limit } = request.query as {
    cameraId?: string; status?: string; page?: string; limit?: string;
  };
  const result = await incidentService.getIncidents({
    scope: await cameraWhere(request),
    cameraId,
    status,
    page: page ? parseInt(page) : undefined,
    limit: limit ? parseInt(limit) : undefined,
  });
  return reply.send(result);
}

async function getIncidentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const incident = await incidentService.getIncident(id);
  if (!incident) return reply.status(404).send({ error: 'Incident not found' });
  return reply.send(incident);
}

const resolveIncidentSchema = z.object({
  resolution: z.string().max(128).optional(),
  rootCause: z.string().max(128).optional(),
  correctiveAction: z.string().max(4000).optional(),
  preventiveAction: z.string().max(4000).optional(),
  resolutionDesc: z.string().max(4000).optional(),
});

async function resolveIncidentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const body = resolveIncidentSchema.parse(request.body ?? {});
  const before = await incidentService.getIncident(id);
  if (!before) return reply.status(404).send({ message: 'Incident not found' });
  if (before.status !== 'open') return reply.status(409).send({ message: 'This incident is already closed' });

  const incident = await incidentService.submitForVerification(id, { ...body, submittedBy: user?.username ?? 'system' });

  // A person who set the camera to error or inactive when opening this has now finished with it.
  // Maintenance set separately, or another incident still open, leaves the camera as it is.
  const camera = before.camera;
  const otherOpen = await incidentService.getOpenIncidentForCamera(before.cameraId);
  const cameraRestored = !otherOpen && !!camera && camera.status !== 'active' && camera.status === before.toStatus;
  if (cameraRestored) {
    await camerasService.updateCamera(before.cameraId, { status: 'active', _changedBy: user?.username } as any);
    await createAlert({
      alertType: 'camera_offline',
      severity: 'info',
      source: before.cameraId,
      title: `Camera online: ${camera.name}`,
      message: `Camera "${camera.name}" status changed to active by ${user?.username ?? 'system'}. Incident ${incident.incidentNumber} waiting to be checked.`,
      details: { cameraId: before.cameraId, cameraName: camera.name, previousStatus: camera.status, newStatus: 'active', changedBy: user?.username, incidentNumber: incident.incidentNumber },
      skipDedup: true,
      closeOnCreate: true,
    });
  }
  await createAuditLog({
    userId: user?.id,
    action: 'incident_resolve',
    entity: 'incident',
    entityId: id,
    description: `Incident ${incident.incidentNumber} sent to be checked by ${user?.username ?? 'system'}`,
    metadata: { cameraId: before.cameraId, resolution: body.resolution, rootCause: body.rootCause, cameraRestored },
    ipAddress: request.ip,
  });
  return reply.send({ ...incident, cameraRestored });
}

const verifyIncidentSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(4000).optional(),
});

async function verifyIncidentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const input = verifyIncidentSchema.parse(request.body);
  try {
    const incident = await incidentService.verifyIncident(id, { ...input, user: { username: user?.username ?? 'unknown', role: user?.role } });
    await createAuditLog({
      userId: user?.id,
      action: input.decision === 'approve' ? 'incident_approve' : 'incident_reject',
      entity: 'incident',
      entityId: id,
      description: `Incident ${incident.incidentNumber} ${input.decision === 'approve' ? 'approved' : 'sent back'} by ${user?.username ?? 'unknown'}`,
      metadata: { note: input.note, ownWork: incident.closedBy === user?.username, cameraId: incident.cameraId },
      ipAddress: request.ip,
    });
    if (input.decision === 'reject') {
      await createAlert({
        alertType: 'incident_escalation',
        severity: 'warning',
        source: id,
        title: `Incident sent back: ${incident.incidentNumber}`,
        message: `Incident ${incident.incidentNumber} was sent back by ${user?.username ?? 'unknown'}: ${input.note}`,
        details: { incidentId: id, incidentNumber: incident.incidentNumber, cameraId: incident.cameraId },
        skipDedup: true,
      });
    }
    return reply.send(incident);
  } catch (err) {
    if (err instanceof incidentService.VerificationError) return reply.status(err.statusCode).send({ message: err.message, details: { code: err.code } });
    throw err;
  }
}

async function updateIncidentWorkflowHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as Record<string, any>;
  const user = (request as any).user;
  const before = await incidentService.getIncident(id);

  const incident = await incidentService.updateIncidentWorkflow(id, {
    assignedTo: body.assignedTo,
    workflowStage: body.workflowStage,
    acknowledge: body.acknowledge,
    acknowledgedBy: user?.username,
  });

  const changes: string[] = [];
  if (body.acknowledge && !before?.acknowledgedAt) changes.push(`acknowledged by ${user?.username ?? 'system'}`);
  if (body.assignedTo !== undefined && body.assignedTo !== before?.assignedTo) {
    changes.push(before?.assignedTo ? `reassigned from "${before.assignedTo}" to "${body.assignedTo || '—'}"` : `assigned to "${body.assignedTo || '—'}"`);
  }
  if (body.workflowStage !== undefined && body.workflowStage !== before?.workflowStage) {
    changes.push(`workflow stage: ${before?.workflowStage ?? 'unassigned'} → ${body.workflowStage}`);
  }
  if (changes.length > 0) {
    createAuditLog({
      userId: user?.id,
      action: 'incident_workflow_update',
      entity: 'incident',
      entityId: id,
      description: `Incident "${(incident as any).incidentNumber}" ${changes.join(', ')} by ${user?.username ?? 'system'}`,
      metadata: { before: { assignedTo: before?.assignedTo, workflowStage: before?.workflowStage }, after: { assignedTo: (incident as any).assignedTo, workflowStage: (incident as any).workflowStage } },
      ipAddress: request.ip,
    }).catch(() => {});
  }

  return reply.send(incident);
}

async function uploadAttachmentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  ensureAttachmentDir();

  try {
    const data = await (request as any).file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const mimeType: string = data.mimetype || '';
    if (!mimeType.startsWith('image/')) {
      return reply.status(400).send({ error: 'Only image files are allowed', code: 'INVALID_TYPE' });
    }

    // Configurable max size (MB) from system config
    const { getAllConfigs } = await import('../system-config/system-config.service.js');
    const configs = await getAllConfigs();
    const maxMb = Number(configs.incident_attachment_max_mb?.value ?? 10);
    const maxBytes = maxMb * 1024 * 1024;

    const ext = extname(data.filename || '.jpg') || '.jpg';
    const filename = `${id}-${randomUUID()}${ext}`;
    const filePath = join(ATTACHMENT_DIR, filename);

    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      size += chunk.length;
      if (size > maxBytes) {
        return reply.status(413).send({
          error: 'File too large',
          code: 'FILE_TOO_LARGE',
          maxMb,
          message: `File size exceeds ${maxMb} MB limit`,
        });
      }
      chunks.push(chunk);
    }

    if ((data as any).file.truncated) {
      return reply.status(413).send({ error: 'File too large', code: 'FILE_TOO_LARGE', maxMb, message: `File size exceeds ${maxMb} MB limit` });
    }

    const { writeFile } = await import('fs/promises');
    await writeFile(filePath, Buffer.concat(chunks));

    const url = `/api/v1/cameras/incidents/attachments/${filename}`;

    // Persist attachment metadata into the incident's attachments JSON array
    const prisma = (await import('../../lib/prisma.js')).getPrisma();
    const incident = await prisma.cameraIncident.findUnique({ where: { id }, select: { attachments: true } });
    if (incident) {
      const existing = Array.isArray(incident.attachments) ? incident.attachments as any[] : [];
      existing.push({ filename, originalName: data.filename, size, url, uploadedAt: new Date().toISOString() });
      await prisma.cameraIncident.update({ where: { id }, data: { attachments: existing as never } });
    }

    return reply.status(201).send({
      filename,
      originalName: data.filename,
      size,
      url,
    });
  } catch (err: any) {
    return reply.status(500).send({ error: 'Upload failed', message: err?.message });
  }
}

async function serveAttachmentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { filename } = request.params as { filename: string };
  // Basic path traversal protection
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return reply.status(400).send({ error: 'Invalid filename' });
  }
  const filePath = join(ATTACHMENT_DIR, filename);
  if (!existsSync(filePath)) {
    return reply.status(404).send({ error: 'Attachment not found' });
  }
  const ext = extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';
  const { readFile } = await import('fs/promises');
  const fileBuffer = await readFile(filePath);
  return reply.header('Content-Type', contentType).send(fileBuffer);
}

async function incidentOptionsHandler(_request: FastifyRequest, reply: FastifyReply) {
  const options = await incidentService.getIncidentOptions();
  return reply.send(options);
}

async function searchIncidentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { siteId, zoneId, q, cameraId, reason, rootCause, status, priority, page, limit, sortBy, sortDir } = request.query as {
    siteId?: string; zoneId?: string; q?: string; cameraId?: string; reason?: string; rootCause?: string;
    status?: string; priority?: string; page?: string; limit?: string;
    sortBy?: string; sortDir?: string;
  };
  const result = await incidentService.searchIncidents({
    scope: await cameraWhere(request),
    siteId, zoneId, q, cameraId, reason, rootCause, status, priority,
    page: page ? parseInt(page) : undefined,
    limit: limit ? parseInt(limit) : undefined,
    sortBy, sortDir: sortDir === 'asc' ? 'asc' : sortDir === 'desc' ? 'desc' : undefined,
  });
  return reply.send(result);
}

async function incidentKnowledgeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId, days } = request.query as { cameraId?: string; days?: string };
  const result = await incidentService.getIncidentKnowledge({
    scope: await cameraWhere(request),
    cameraId,
    days: days ? parseInt(days) : undefined,
  });
  return reply.send(result);
}

async function relatedIncidentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await incidentService.getRelatedIncidents(id, await cameraWhere(request));
  return reply.send(result);
}

async function resolutionStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { reason, rootCause } = request.query as { reason?: string; rootCause?: string };
  const result = await incidentService.getResolutionStats({ ...({ reason, rootCause }), scope: await cameraWhere(request) });
  return reply.send(result);
}

async function topIncidentCausesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = request.query as { days?: string };
  const d = Math.min(730, Math.max(1, parseInt(days ?? '7', 10) || 7));
  return reply.send(await incidentService.getTopIncidentCauses(d, await cameraWhere(request)));
}

async function incidentMonthlyTrendHandler(request: FastifyRequest, reply: FastifyReply) {
  const { months } = request.query as { months?: string };
  const m = Math.min(24, Math.max(2, parseInt(months ?? '6', 10) || 6));
  return reply.send(await incidentService.getIncidentMonthlyTrend(m, await cameraWhere(request)));
}

async function createWorkOrderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const incident = await incidentService.createWorkOrder(id, user?.username ?? 'system');
  return reply.send(incident);
}

async function updateWorkOrderStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { status } = request.body as { status: string };
  const incident = await incidentService.updateWorkOrderStatus(id, status);
  return reply.send(incident);
}

async function deleteIncidentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  const prisma = (await import('../../lib/prisma.js')).getPrisma();

  const incident = await prisma.cameraIncident.findUnique({
    where: { id },
    select: { id: true, incidentNumber: true, attachments: true },
  });
  if (!incident) return reply.status(404).send({ error: 'Incident not found' });

  // Remove this incident's evidence files from disk (mirrors clear-all).
  const atts = Array.isArray(incident.attachments) ? (incident.attachments as any[]) : [];
  const { unlink } = await import('fs/promises');
  for (const a of atts) {
    if (a?.filename) {
      const fp = join(ATTACHMENT_DIR, a.filename);
      if (existsSync(fp)) await unlink(fp).catch(() => {});
    }
  }

  await removeWorkOrderFiles({ incidentId: id });
  // SOP check logs have no DB cascade — clear them first.
  await prisma.cameraIncident.delete({ where: { id } });

  await createAuditLog({
    userId: user.id,
    action: 'delete',
    entity: 'camera',
    entityId: id,
    description: `Deleted incident ${incident.incidentNumber} (and its attachments) by ${user.username}`,
  }).catch(() => {});

  return reply.send({ deleted: true });
}

async function clearAllIncidentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  const { password, retentionYears } = (request.body ?? {}) as { password?: string; retentionYears?: number };
  if (!password) {
    return reply.status(400).send({ error: 'Password required', code: 'PASSWORD_REQUIRED' });
  }

  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  
  const bcrypt = await import('bcryptjs');
  const compare = bcrypt.default?.compare || bcrypt.compare;
  if (!dbUser || !(await compare(password, dbUser.password))) {
    return reply.status(403).send({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
  }

  let deleteWhere = {};
  let filenamesToDelete: string[] = [];

  const { readdir, unlink } = await import('fs/promises');

  if (retentionYears && retentionYears > 0) {
    const cutoffDate = new Date(Date.now() - retentionYears * 365 * 24 * 60 * 60 * 1000);
    deleteWhere = { openedAt: { lt: cutoffDate } };

    // Get specific attachments to delete
    try {
      const targets = await prisma.cameraIncident.findMany({
        where: deleteWhere,
        select: { attachments: true }
      });
      for (const t of targets) {
        const atts = Array.isArray(t.attachments) ? t.attachments as any[] : [];
        for (const a of atts) {
          if (a.filename) {
            filenamesToDelete.push(a.filename);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 1. Delete physical attachment files from disk
  try {
    if (retentionYears && retentionYears > 0) {
      // Delete only targeted files
      for (const fn of filenamesToDelete) {
        const filePath = join(ATTACHMENT_DIR, fn);
        if (existsSync(filePath)) {
          await unlink(filePath).catch(() => {});
        }
      }
    } else {
      // Delete all files in the directory
      if (existsSync(ATTACHMENT_DIR)) {
        const files = await readdir(ATTACHMENT_DIR);
        for (const file of files) {
          if (file !== '.' && file !== '..') {
            await unlink(join(ATTACHMENT_DIR, file)).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    // ignore
  }

  // 2. Delete targeted records from CameraIncident table
  await removeWorkOrderFiles({ incident: deleteWhere });
  const result = await prisma.cameraIncident.deleteMany({ where: deleteWhere });

  // 3. Create audit log
  await createAuditLog({
    userId: user.id,
    action: 'bulk_delete',
    entity: 'camera',
    description: retentionYears
      ? `Cleared ${result.count} incidents older than ${retentionYears} years (and their attachments) by ${user.username}`
      : `Cleared all ${result.count} incidents and their physical attachments by ${user.username}`,
  }).catch(() => {});

  return reply.send({ success: true, count: result.count });
}

function favoriteUserId(request: FastifyRequest): string | null {
  const id = (request as any).user?.id;
  // API keys and service tokens have no user row to attach stars to.
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function listFavoritesHandler(request: FastifyRequest, reply: FastifyReply) {
  const userId = favoriteUserId(request);
  if (!userId) return reply.send([]);
  const rows = await getPrisma().cameraFavorite.findMany({ where: { userId }, select: { cameraId: true } });
  const allowed = await allowedCameraIds(request);
  return reply.send(rows.map((r) => r.cameraId).filter((id) => allowed === null || allowed.includes(id)));
}

async function setFavoriteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const userId = favoriteUserId(request);
  if (!userId) return reply.status(400).send({ message: 'Favorites need a user account' });
  await getPrisma().cameraFavorite.upsert({
    where: { userId_cameraId: { userId, cameraId: id } },
    update: {},
    create: { userId, cameraId: id },
  });
  return reply.status(204).send();
}

async function removeFavoriteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const userId = favoriteUserId(request);
  if (!userId) return reply.status(400).send({ message: 'Favorites need a user account' });
  await getPrisma().cameraFavorite.deleteMany({ where: { userId, cameraId: id } });
  return reply.status(204).send();
}

async function detectStreamHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = detectStreamSchema.parse(request.body);
  let password = input.password || null;
  if (!password && input.cameraId) {
    const camera = await getPrisma().camera.findUnique({ where: { id: input.cameraId }, select: { rtspUrl: true } });
    password = extractRtspPassword(camera?.rtspUrl);
  }
  const result = await detectCameraStream({ ...input, password });
  return reply.send(result);
}

export async function cameraRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    listHandler,
  );
  app.get(
    '/analytics/comparison',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    comparisonHandler,
  );
  app.get(
    '/trash',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    trashListHandler,
  );
  app.post(
    '/trash/empty',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardAllCameras] },
    emptyCameraTrashHandler,
  );
  app.get(
    '/incidents',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    listIncidentsHandler,
  );
  app.get(
    '/incidents/options',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    incidentOptionsHandler,
  );
  app.post(
    '/incidents/clear-all',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardAllCameras] },
    clearAllIncidentsHandler,
  );
  app.get(
    '/incidents/attachments/:filename',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardIncidentAttachment] },
    serveAttachmentHandler,
  );
  app.get(
    '/incidents/search',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    searchIncidentsHandler,
  );
  app.get(
    '/incidents/knowledge',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    incidentKnowledgeHandler,
  );
  app.get(
    '/incidents/resolution-stats',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    resolutionStatsHandler,
  );
  app.get(
    '/incidents/top-causes',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    topIncidentCausesHandler,
  );
  app.get(
    '/incidents/monthly-trend',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    incidentMonthlyTrendHandler,
  );
  app.get(
    '/incidents/:id/related',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardIncidentParam()] },
    relatedIncidentsHandler,
  );
  // A viewer's own stars, so reading cameras is all it takes.
  app.get('/favorites', { preHandler: [app.authenticate, requirePermission('cameras:read')] }, listFavoritesHandler);
  app.put('/:id/favorite', { preHandler: [app.authenticate, requirePermission('cameras:read'), guardCameraParam()] }, setFavoriteHandler);
  app.delete('/:id/favorite', { preHandler: [app.authenticate, requirePermission('cameras:read'), guardCameraParam()] }, removeFavoriteHandler);
  app.post(
    '/detect-stream',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    detectStreamHandler,
  );
  app.post(
    '/incidents/:id/work-order',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardIncidentParam()] },
    createWorkOrderHandler,
  );
  app.patch(
    '/incidents/:id/work-order',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardIncidentParam()] },
    updateWorkOrderStatusHandler,
  );
  app.get(
    '/incidents/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardIncidentParam()] },
    getIncidentHandler,
  );
  app.delete(
    '/incidents/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardIncidentParam()] },
    deleteIncidentHandler,
  );
  app.post(
    '/incidents/:id/resolve',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardIncidentParam()] },
    resolveIncidentHandler,
  );
  app.post(
    '/incidents/:id/verify',
    { preHandler: [app.authenticate, requirePermission('incidents:verify'), guardIncidentParam()] },
    verifyIncidentHandler,
  );
  app.patch(
    '/incidents/:id/workflow',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardIncidentParam()] },
    updateIncidentWorkflowHandler,
  );
  app.post(
    '/incidents/:id/attachments',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardIncidentParam()] },
    uploadAttachmentHandler,
  );
  app.get(
    '/:id/analytics',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardCameraParam()] },
    analyticsHandler,
  );
  app.post(
    '/:id/restore',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardCameraParam()] },
    restoreCameraHandler,
  );
  app.delete(
    '/:id/permanent',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardCameraParam()] },
    permanentDeleteCameraHandler,
  );
  app.get(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardCameraParam()] },
    getByIdHandler,
  );
  app.get(
    '/:id/events',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardCameraParam()] },
    eventsHandler,
  );
  app.get(
    '/:id/stream',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), requirePermission('live:view'), guardCameraParam()],
      onResponse: [viewLogHook('live', (r) => (r.params as any).id, (r) => ({ profile: (r.query as any)?.profile ?? 'main' }))] },
    getStreamHandler,
  );
  app.post(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    createHandler,
  );
  // Only reads, but a list of ids is too long for a query string.
  app.post(
    '/deletion-impact',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardCameraIdsBody()] },
    deletionImpactHandler,
  );
  app.post(
    '/info-import',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    cameraInfoImportHandler,
  );
  app.patch(
    '/bulk',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardCameraIdsBody()] },
    bulkUpdateHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardCameraParam()] },
    updateHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardCameraParam()] },
    deleteCameraHandler,
  );
}
