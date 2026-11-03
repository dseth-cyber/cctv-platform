import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import * as incidentService from './camera-incident.service.js';
import { formatDuration } from '../../lib/format.js';
import { probeCameraHealth } from './camera-probe.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';

let cronTask: ScheduledTask | null = null;

// Flapping detection: cameraId -> array of offline transition timestamps (ms)
export const cameraFlapHistory = new Map<string, number[]>();

export function checkAndRecordFlap(cameraId: string, windowMs = 15 * 60 * 1000, maxFlaps = 3): boolean {
  const now = Date.now();
  const history = (cameraFlapHistory.get(cameraId) || []).filter((t) => now - t <= windowMs);
  history.push(now);
  cameraFlapHistory.set(cameraId, history);
  return history.length >= maxFlaps;
}

// Deterministic keyword lookup — not ML. "confidence" reflects how specific/unambiguous
// the matched pattern is, not a statistical probability, so operators should treat it as
// a suggestion to verify, not a conclusion.
export function suggestRootCause(message: string): { rootCause: string; confidence: string } | null {
  const text = (message || '').toLowerCase();
  if (/enospc|disk full|no space left/.test(text)) return { rootCause: 'storage', confidence: 'high' };
  if (/etimedout|econnrefused|enetunreach|ehostunreach|network is unreachable|\btimeout\b/.test(text)) {
    return { rootCause: 'network', confidence: 'high' };
  }
  if (/rtsp|554|stream connection|whep/.test(text)) {
    return { rootCause: 'rtsp_stream', confidence: 'high' };
  }
  if (/logon_failure|access_denied|authentication|permission denied|invalid credentials/.test(text)) {
    return { rootCause: 'smb', confidence: 'medium' };
  }
  if (/bad_network_name|enoent|share not found|no such file or directory/.test(text)) {
    return { rootCause: 'smb', confidence: 'medium' };
  }
  return null;
}

async function getRecentErrorMessage(cameraId: string): Promise<string | null> {
  const prisma = getPrisma();
  const alert = await prisma.alert.findFirst({
    where: { alertType: 'camera_offline', source: cameraId },
    orderBy: { createdAt: 'desc' },
  });
  return alert?.message ?? null;
}

export function computeEscalatedPriority(offlineMs: number, highMin: number, criticalMin: number): string {
  const offlineMin = offlineMs / 60000;
  if (offlineMin >= criticalMin) return 'critical';
  if (offlineMin >= highMin) return 'high';
  return 'medium';
}

export async function checkCameraHealth(): Promise<void> {
  const prisma = getPrisma();
  const configs = await getAllConfigs();
  const offlineThresholdMin = Number(configs.camera_offline_threshold_minutes?.value ?? 5);
  const thresholdMs = offlineThresholdMin * 60 * 1000;
  const autoIncidentEnabled = configs.camera_auto_incident_enabled?.value === true;
  const autoResolveEnabled = configs.camera_auto_resolve_enabled?.value === true;
  const autoWorkOrderEnabled = configs.camera_auto_workorder_enabled?.value === true;
  const escalateHighMin = Number(configs.camera_incident_escalate_high_minutes?.value ?? 15);
  const escalateCriticalMin = Number(configs.camera_incident_escalate_critical_minutes?.value ?? 30);
  const recoveryGraceMs = Number(configs.camera_recovery_grace_minutes?.value ?? 1) * 60 * 1000;

  const cameras = await prisma.camera.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      status: true,
      ipAddress: true,
      rtspUrl: true,
      streamPath: true,
      device: { select: { ipAddress: true, rtspPort: true } },
      lastPolledAt: true,
      operationalStatus: true,
      operationalSince: true,
    },
  });

  // A path MediaMTX reports as ready is receiving video right now: the strongest evidence a camera is up.
  const readyPaths = new Set(
    (await MediaMtxService.getLivePaths()).filter((p: any) => p?.ready).map((p: any) => String(p.name)),
  );

  for (const cam of cameras) {
    // Maintenance mode suppression: if camera is in maintenance, skip offline alert and incident
    if (cam.status === 'maintenance') {
      continue;
    }

    // Actively probe the camera's network/RTSP/SMB target
    const streamReady = !!cam.streamPath && readyPaths.has(cam.streamPath.replace(/^\/+/, ''));
    const probeResult = streamReady
      ? { reachable: true, latencyMs: 0 }
      : await probeCameraHealth(cam);
    const isProbeSuccess = probeResult.reachable;

    const timeSinceLastPoll = cam.lastPolledAt ? Date.now() - new Date(cam.lastPolledAt).getTime() : Infinity;
    const isOffline = cam.status === 'error' || cam.status === 'inactive' || (!isProbeSuccess && timeSinceLastPoll > thresholdMs);
    const rawNext = isOffline ? 'offline' : 'online';
    const prev = cam.operationalStatus;

    // First-ever observation for this camera — record a baseline only, no event/alert noise.
    if (prev === 'unknown') {
      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: rawNext as any, operationalSince: new Date() } });
      continue;
    }

    // online/recovering -> offline
    if ((prev === 'online' || prev === 'recovering') && rawNext === 'offline') {
      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: 'offline', operationalSince: new Date() } });
      logger.warn({ camera: cam.name, cameraId: cam.id, status: cam.status, lastPoll: cam.lastPolledAt }, 'Camera went offline');

      // Flapping check: if camera flaps repeatedly within 15m, suppress repeated notifications
      const isFlapping = checkAndRecordFlap(cam.id);
      if (isFlapping) {
        logger.warn({ camera: cam.name, cameraId: cam.id }, 'Camera connection is flapping — alert throttled');
        await prisma.cameraEvent.create({
          data: {
            cameraId: cam.id,
            eventType: 'error',
            source: 'health_monitor',
            message: `Camera "${cam.name}" connection is flapping (intermittent disconnects). Notifications throttled.`,
            metadata: { isFlapping: true, lastPolledAt: cam.lastPolledAt },
          },
        });
        continue;
      }

      await prisma.cameraEvent.create({
        data: {
          cameraId: cam.id,
          eventType: 'offline',
          source: 'health_monitor',
          message: `Camera "${cam.name}" went offline (status: ${cam.status}, last poll: ${timeSinceLastPoll > 86400000 ? 'never' : Math.floor(timeSinceLastPoll / 1000) + 's ago'})`,
          metadata: { status: cam.status, lastPolledAt: cam.lastPolledAt, timeSinceLastPollMs: timeSinceLastPoll },
        },
      });

      const recentAlert = await prisma.alert.findFirst({
        where: {
          alertType: 'camera_offline',
          source: cam.id,
          resolvedAt: null,
          createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        },
      });

      if (!recentAlert) {
        await createAlert({
          alertType: 'camera_offline',
          severity: 'critical',
          source: cam.id,
          title: `Camera offline: ${cam.name}`,
          message: `Camera "${cam.name}" is offline. Status: ${cam.status}. Last poll: ${cam.lastPolledAt ? new Date(cam.lastPolledAt).toISOString() : 'never'}`,
          details: { cameraId: cam.id, cameraName: cam.name, status: cam.status, lastPolledAt: cam.lastPolledAt },
        });
      }

      if (autoIncidentEnabled) {
        const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
        if (!openIncident) {
          const errMsg = await getRecentErrorMessage(cam.id);
          const suggestion = errMsg ? suggestRootCause(errMsg) : null;
          const created = await incidentService.createIncident({
            cameraId: cam.id,
            fromStatus: cam.status,
            toStatus: cam.status,
            reason: cam.rtspUrl ? 'rtsp_unreachable' : 'smb_unreachable',
            rootCause: suggestion?.rootCause ?? (cam.rtspUrl ? 'rtsp_stream' : 'smb'),
            description: `Auto-detected: ${probeResult.reason || `no response for over ${offlineThresholdMin} minute(s)`}.`,
            priority: 'medium',
            impact: 'none',
            openedBy: 'system',
            detectionSource: 'health_monitor',
            rootCauseConfidence: suggestion?.confidence ?? 'medium',
          });
          logger.info({ camera: cam.name, incident: created.incidentNumber, rootCause: suggestion?.rootCause }, 'Auto-created incident for offline camera');
        }
      }
      continue;
    }

    // offline -> first successful poll: don't declare fully "online" yet, confirm on next tick.
    if (prev === 'offline' && rawNext === 'online') {
      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: 'recovering', operationalSince: new Date() } });
      await prisma.cameraEvent.create({
        data: {
          cameraId: cam.id,
          eventType: 'recovering',
          source: 'health_monitor',
          message: `Camera "${cam.name}" is responding again — confirming stability before marking online`,
        },
      });
      continue;
    }

    // recovering -> stayed reachable: confirm fully online (after the configured grace period), resolve/notify.
    if (prev === 'recovering' && rawNext === 'online') {
      const recoveringSince = cam.operationalSince ? new Date(cam.operationalSince).getTime() : 0;
      if (Date.now() - recoveringSince < recoveryGraceMs) {
        // Still within the grace period — stay in "recovering" and check again next tick.
        continue;
      }

      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: 'online', operationalSince: new Date() } });
      logger.info({ camera: cam.name, cameraId: cam.id }, 'Camera confirmed back online');

      await prisma.cameraEvent.create({
        data: { cameraId: cam.id, eventType: 'online', source: 'health_monitor', message: `Camera "${cam.name}" is back online`, metadata: { status: cam.status } },
      });

      const openAlert = await prisma.alert.findFirst({
        where: { alertType: 'camera_offline', source: cam.id, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      let downtimeMs = 0;
      if (openAlert) {
        downtimeMs = Date.now() - new Date(openAlert.createdAt).getTime();
        await prisma.alert.update({
          where: { id: openAlert.id },
          data: {
            resolvedAt: new Date(),
            resolvedBy: 'system',
            details: {
              ...(openAlert.details as any ?? {}),
              resolvedReason: 'Camera back online',
              downtimeMs,
              downtimeFormatted: formatDuration(downtimeMs),
            },
          },
        });
        logger.info({ camera: cam.name, downtime: formatDuration(downtimeMs) }, 'Camera offline alert resolved');
      }

      await createAlert({
        alertType: 'camera_offline',
        severity: 'info',
        source: cam.id,
        title: `Camera online: ${cam.name}`,
        message: `Camera "${cam.name}" is back online${openAlert ? '. Downtime: ' + formatDuration(downtimeMs) : ''}`,
        details: { cameraId: cam.id, cameraName: cam.name, event: 'back_online' },
      });

      if (autoResolveEnabled) {
        const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
        if (openIncident && openIncident.detectionSource === 'health_monitor') {
          const openDurationMs = downtimeMs || (Date.now() - new Date(openIncident.openedAt).getTime());
          await incidentService.resolveIncident(openIncident.id, {
            resolution: `Camera reconnected automatically after ${formatDuration(openDurationMs)} offline.`,
            closedBy: 'system',
            autoResolved: true,
          });
          logger.info({ camera: cam.name, incident: openIncident.incidentNumber }, 'Auto-resolved incident on recovery');
        }
      }
      continue;
    }

    // Still offline: escalate the auto-created incident's priority as downtime grows.
    if (prev === 'offline' && rawNext === 'offline' && autoIncidentEnabled) {
      const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
      if (openIncident && openIncident.detectionSource === 'health_monitor') {
        const offlineMs = Date.now() - new Date(openIncident.openedAt).getTime();
        const nextPriority = computeEscalatedPriority(offlineMs, escalateHighMin, escalateCriticalMin);
        if (nextPriority !== openIncident.priority) {
          await prisma.cameraIncident.update({ where: { id: openIncident.id }, data: { priority: nextPriority } });
          logger.info({ camera: cam.name, incident: openIncident.incidentNumber, priority: nextPriority }, 'Escalated auto-incident priority');

          if (nextPriority === 'high' && openIncident.workflowStage === 'unassigned') {
            await createAlert({
              alertType: 'incident_escalation',
              severity: 'warning',
              source: openIncident.id,
              title: `Incident still unassigned: ${openIncident.incidentNumber}`,
              message: `Camera "${cam.name}" has been offline for over ${escalateHighMin} minute(s) and incident ${openIncident.incidentNumber} has not been assigned to anyone yet.`,
              details: { cameraId: cam.id, cameraName: cam.name, incidentId: openIncident.id, incidentNumber: openIncident.incidentNumber },
            });
          }

          if (nextPriority === 'critical') {
            await createAlert({
              alertType: 'incident_escalation',
              severity: 'critical',
              source: openIncident.id,
              title: `Incident escalated to Critical: ${openIncident.incidentNumber}`,
              message: `Camera "${cam.name}" has been offline for over ${escalateCriticalMin} minute(s). Incident ${openIncident.incidentNumber} needs attention.`,
              details: { cameraId: cam.id, cameraName: cam.name, incidentId: openIncident.id, incidentNumber: openIncident.incidentNumber },
            });
          }

          if (nextPriority === 'critical' && autoWorkOrderEnabled && !openIncident.workOrderNumber) {
            const wo = await incidentService.createWorkOrder(openIncident.id, 'system');
            logger.info({ camera: cam.name, workOrder: (wo as any).workOrderNumber }, 'Auto-created work order for critical incident');
          }
        }
      }
    }
  }
}

export function startCameraHealthMonitor(): void {
  if (cronTask) return;

  cronTask = cron.schedule('* * * * *', async () => {
    try {
      await checkCameraHealth();
    } catch (err) {
      logger.error({ err }, 'Camera health monitor failed');
    }
    // Runs after checkCameraHealth so it reads the operationalStatus that tick just wrote,
    // and in its own try/catch so a failure here can't stop the offline detection above.
  });

  logger.info('Camera health monitor scheduled (every 1 minute)');

  setTimeout(() => {
    checkCameraHealth().catch((err) => {
      logger.error({ err }, 'Initial camera health check failed');
    });
  }, 10000);
}

export function stopCameraHealthMonitor(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Camera health monitor stopped');
  }
}

/**
 * Real-time stream status handler (< 3s detection) triggered via MediaMTX HTTP webhook [ENH-01].
 * Instantly transitions camera to offline / recovering / online without waiting for background cron,
 * while preserving anti-flapping suppression and recovery grace periods.
 */
export async function handleStreamStatusEvent(
  streamPath: string,
  status: 'ready' | 'not_ready'
): Promise<{ success: boolean; cameraId?: string; status: string; message: string }> {
  const prisma = getPrisma();
  const cleanPath = (streamPath || '').replace(/^\/+/, '');
  const basePath = cleanPath.replace(/_sub$/, '');

  // 1. Resolve camera by streamPath or id (a camera may also be mapped to a sim/ test stream)
  const idCandidate = cleanPath.replace(/^camera_/, '').replace(/_sub$/, '');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idCandidate);
  let camera = await prisma.camera.findFirst({
    where: {
      OR: [
        { streamPath: cleanPath },
        { streamPath: basePath },
        // id is a uuid column; a non-uuid value would make the query throw.
        ...(isUuid ? [{ id: idCandidate }] : []),
      ],
    },
  });

  // 2. Dev simulated stream with no camera mapped to it: acknowledge only
  if (!camera && cleanPath.startsWith('sim/')) {
    logger.debug({ streamPath: cleanPath, status }, 'MediaMTX simulated stream event acknowledged');
    return {
      success: true,
      status: status === 'ready' ? 'online' : 'offline',
      message: `Simulated dev stream "${cleanPath}" acknowledged as ${status}`,
    };
  }

  if (!camera) {
    // Fallback scan: check synthetic path camera_${camera.id.replace(/-/g, '').substring(0, 12)}
    const allCams = await prisma.camera.findMany({
      where: { enabled: true },
      select: { id: true, name: true, streamPath: true, status: true, operationalStatus: true, operationalSince: true, rtspUrl: true },
    });
    for (const c of allCams) {
      const synthetic = `camera_${c.id.replace(/-/g, '').substring(0, 12)}`;
      if (basePath === synthetic || cleanPath === synthetic || c.name === cleanPath || c.name === basePath) {
        camera = c as any;
        break;
      }
    }
  }

  if (!camera) {
    logger.warn({ streamPath: cleanPath, status }, 'Webhook received for unmapped camera stream path');
    return {
      success: false,
      status: 'not_found',
      message: `No active camera mapped to stream path "${cleanPath}"`,
    };
  }

  const configs = await getAllConfigs();
  const autoIncidentEnabled = configs.camera_auto_incident_enabled?.value === true;
  const autoResolveEnabled = configs.camera_auto_resolve_enabled?.value === true;
  const recoveryGraceMs = Number(configs.camera_recovery_grace_minutes?.value ?? 1) * 60 * 1000;
  const prev = camera.operationalStatus;

  // Stream went down (not_ready)
  if (status === 'not_ready') {
    if (camera.status === 'maintenance') {
      return { success: true, cameraId: camera.id, status: 'maintenance', message: 'Camera is in maintenance mode' };
    }

    await prisma.camera.update({
      where: { id: camera.id },
      data: { operationalStatus: 'offline', operationalSince: new Date() },
    });

    const isFlapping = checkAndRecordFlap(camera.id);
    if (isFlapping) {
      logger.warn({ camera: camera.name, cameraId: camera.id }, 'Camera connection flapping via webhook — alert throttled');
      await prisma.cameraEvent.create({
        data: {
          cameraId: camera.id,
          eventType: 'error',
          source: 'webhook',
          message: `Camera "${camera.name}" connection is flapping (rapid stream drops). Webhook alerts throttled.`,
          metadata: { isFlapping: true, streamPath: cleanPath },
        },
      });
      return {
        success: true,
        cameraId: camera.id,
        status: 'flapping_throttled',
        message: `Camera ${camera.name} is offline (flapping throttled)`,
      };
    }

    await prisma.cameraEvent.create({
      data: {
        cameraId: camera.id,
        eventType: 'offline',
        source: 'webhook',
        message: `Real-time stream drop detected for camera "${camera.name}" (stream: ${cleanPath})`,
        metadata: { streamPath: cleanPath, trigger: 'runOnNotReady' },
      },
    });

    const recentAlert = await prisma.alert.findFirst({
      where: {
        alertType: 'camera_offline',
        source: camera.id,
        resolvedAt: null,
        createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });

    if (!recentAlert) {
      await createAlert({
        alertType: 'camera_offline',
        severity: 'critical',
        source: camera.id,
        title: `Camera offline: ${camera.name}`,
        message: `Camera "${camera.name}" stream disconnected instantly (< 3s detection). Stream: ${cleanPath}.`,
        details: { cameraId: camera.id, cameraName: camera.name, streamPath: cleanPath, detectionSource: 'realtime_webhook' },
      });
    }

    if (autoIncidentEnabled) {
      const openIncident = await incidentService.getOpenIncidentForCamera(camera.id);
      if (!openIncident) {
        await incidentService.createIncident({
          cameraId: camera.id,
          fromStatus: camera.status,
          toStatus: 'error',
          reason: 'rtsp_stream_dropped',
          rootCause: 'rtsp_stream',
          description: `Real-time webhook: MediaMTX stream became unready for ${cleanPath}`,
          priority: 'medium',
          impact: 'none',
          openedBy: 'system',
          detectionSource: 'realtime_webhook',
          rootCauseConfidence: 'high',
        });
      }
    }

    return {
      success: true,
      cameraId: camera.id,
      status: 'offline',
      message: `Camera ${camera.name} marked offline in real-time`,
    };
  }

  // Stream is up (ready)
  if (status === 'ready') {
    if (prev === 'offline') {
      await prisma.camera.update({
        where: { id: camera.id },
        data: { operationalStatus: 'recovering', operationalSince: new Date(), lastPolledAt: new Date() },
      });

      await prisma.cameraEvent.create({
        data: {
          cameraId: camera.id,
          eventType: 'recovering',
          source: 'webhook',
          message: `Camera "${camera.name}" stream resumed — entered recovery grace period`,
        },
      });

      return {
        success: true,
        cameraId: camera.id,
        status: 'recovering',
        message: `Camera ${camera.name} stream active, entered recovery grace period`,
      };
    }

    if (prev === 'recovering') {
      const recoveringSince = camera.operationalSince ? new Date(camera.operationalSince).getTime() : 0;
      if (Date.now() - recoveringSince < recoveryGraceMs) {
        return {
          success: true,
          cameraId: camera.id,
          status: 'recovering',
          message: `Camera ${camera.name} stream active, within grace period`,
        };
      }

      await prisma.camera.update({
        where: { id: camera.id },
        data: { operationalStatus: 'online', operationalSince: new Date(), lastPolledAt: new Date() },
      });

      await prisma.cameraEvent.create({
        data: {
          cameraId: camera.id,
          eventType: 'online',
          source: 'webhook',
          message: `Camera "${camera.name}" confirmed back online via real-time stream`,
        },
      });

      const openAlert = await prisma.alert.findFirst({
        where: { alertType: 'camera_offline', source: camera.id, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
      });

      let downtimeMs = 0;
      if (openAlert) {
        downtimeMs = Date.now() - new Date(openAlert.createdAt).getTime();
        await prisma.alert.update({
          where: { id: openAlert.id },
          data: {
            resolvedAt: new Date(),
            resolvedBy: 'system',
            details: {
              ...(openAlert.details as any ?? {}),
              resolvedReason: 'Stream reconnected in real-time',
              downtimeMs,
              downtimeFormatted: formatDuration(downtimeMs),
            },
          },
        });
      }

      await createAlert({
        alertType: 'camera_offline',
        severity: 'info',
        source: camera.id,
        title: `Camera online: ${camera.name}`,
        message: `Camera "${camera.name}" is back online via real-time webhook${openAlert ? '. Downtime: ' + formatDuration(downtimeMs) : ''}`,
        details: { cameraId: camera.id, cameraName: camera.name, event: 'back_online', detectionSource: 'realtime_webhook' },
      });

      if (autoResolveEnabled) {
        const openIncident = await incidentService.getOpenIncidentForCamera(camera.id);
        if (openIncident && ['health_monitor', 'realtime_webhook'].includes(openIncident.detectionSource || '')) {
          const openDurationMs = downtimeMs || (Date.now() - new Date(openIncident.openedAt).getTime());
          await incidentService.resolveIncident(openIncident.id, {
            resolution: `Camera reconnected via real-time webhook after ${formatDuration(openDurationMs)}.`,
            closedBy: 'system',
            autoResolved: true,
          });
        }
      }

      return {
        success: true,
        cameraId: camera.id,
        status: 'online',
        message: `Camera ${camera.name} confirmed online`,
      };
    }

    // Already online or unknown
    await prisma.camera.update({
      where: { id: camera.id },
      data: { operationalStatus: 'online', lastPolledAt: new Date() },
    });

    return {
      success: true,
      cameraId: camera.id,
      status: 'online',
      message: `Camera ${camera.name} is streaming and online`,
    };
  }

  return {
    success: false,
    status: 'invalid_status',
    message: `Unknown status "${status}"`,
  };
}

