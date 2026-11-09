import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import * as incidentService from './camera-incident.service.js';
import { formatDuration } from '../../lib/format.js';
import { liveLinkLine } from './live-link.js';
import { NO_PROBE_TARGET, probeCameraHealth } from './camera-probe.service.js';
import { MediaMtxService } from '../media/mediamtx.service.js';
import { isKnownNoSignal, readChannelsWithoutSignal } from './device-channel-signal.js';
import { checkRecorders, recorderIfDown, withRecorderLock, type Recorder } from './recorder-outage.js';
import { isDelayOver, loadAlertLevels, offlineThresholdMs, outageElapsedMs, resolveAlertLevel, type AlertLevel } from './alert-levels.js';

let cronTask: ScheduledTask | null = null;

// The check runs once a minute but never exactly 60 s apart: without this, a 1 minute grace waits for a second tick.
const TICK_JITTER_MS = 5000;
const AUTO_DETECTED_INCIDENT_SOURCES = ['health_monitor', 'realtime_webhook'];

// Info alerts share this type ("Camera online", "Camera created") and say nothing about an outage.
const openOutageAlert = (cameraId: string) => ({
  alertType: 'camera_offline' as const,
  source: cameraId,
  resolvedAt: null,
  severity: { not: 'info' as const },
});

/** From the last time the camera answered until it answered again, not from when the system noticed. */
export function computeDowntimeMs(
  alert: { createdAt: Date | string; details?: unknown },
  respondingAgainAt: Date | string | null | undefined,
  now = Date.now(),
): number {
  const lastSeen = (alert.details as { lastPolledAt?: string | null } | null)?.lastPolledAt;
  const from = new Date(lastSeen ?? alert.createdAt).getTime();
  const to = respondingAgainAt ? new Date(respondingAgainAt).getTime() : now;
  return Math.max(0, to - from);
}

/** An on-demand stream also closes when the last viewer leaves, so ask the camera itself. */
async function cameraStoppedResponding(cameraId: string): Promise<boolean> {
  const target = await getPrisma().camera.findUnique({
    where: { id: cameraId },
    select: { id: true, name: true, ipAddress: true, rtspUrl: true, device: { select: { ipAddress: true, rtspPort: true } } },
  });
  if (!target) return false;
  const probe = await probeCameraHealth(target);
  return !probe.reachable && probe.reason !== NO_PROBE_TARGET;
}

// Flapping detection: cameraId -> array of offline transition timestamps (ms)
export const cameraFlapHistory = new Map<string, number[]>();

export function checkAndRecordFlap(cameraId: string, windowMs = 15 * 60 * 1000, maxFlaps = 3): boolean {
  const now = Date.now();
  const history = (cameraFlapHistory.get(cameraId) || []).filter((t) => now - t <= windowMs);
  history.push(now);
  cameraFlapHistory.set(cameraId, history);
  return history.length >= maxFlaps;
}

function isFlappingNow(cameraId: string, windowMs = 15 * 60 * 1000, maxFlaps = 3): boolean {
  const now = Date.now();
  return (cameraFlapHistory.get(cameraId) || []).filter((t) => now - t <= windowMs).length >= maxFlaps;
}

interface OutageCamera {
  id: string;
  name: string;
  status?: string | null;
  channelNumber?: number | null;
  lastPolledAt?: Date | string | null;
  operationalSince?: Date | string | null;
  outageAlertedAt?: Date | string | null;
  outageIncidentAt?: Date | string | null;
}

/**
 * Raises what this camera's alert level says is due by now, once per outage. Runs on every check of a camera
 * that is down, because the delay usually ends long after the camera was called offline.
 */
async function notifyOutage(
  cam: OutageCamera,
  level: AlertLevel,
  settings: { autoIncidentEnabled: boolean; reopenMinutes: number },
  notice: { alert: Parameters<typeof createAlert>[0]; incident: () => Promise<Parameters<typeof incidentService.createIncident>[0]> },
  recorder?: Recorder,
): Promise<void> {
  if (isFlappingNow(cam.id)) return;
  if (recorder) return withRecorderLock(recorder.id, () => notifyRecorderOutage(cam, recorder, level, settings));
  const prisma = getPrisma();
  const elapsed = outageElapsedMs(cam);
  const raised: { outageAlertedAt?: Date; outageIncidentAt?: Date } = {};

  if (!cam.outageAlertedAt && isDelayOver(level.alertDelayMinutes, elapsed)) {
    const recentAlert = await prisma.alert.findFirst({
      where: { ...openOutageAlert(cam.id), createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
    });
    if (!recentAlert) await createAlert(notice.alert);
    raised.outageAlertedAt = new Date();
  }

  if (settings.autoIncidentEnabled && !cam.outageIncidentAt && isDelayOver(level.incidentDelayMinutes, elapsed)) {
    const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
    if (!openIncident) {
      const reopened = await incidentService.reopenRecentIncident(cam.id, settings.reopenMinutes);
      if (reopened) {
        await prisma.cameraEvent.create({
          data: {
            cameraId: cam.id,
            eventType: 'error',
            source: 'health_monitor',
            message: `Camera "${cam.name}" dropped again, so incident ${reopened.incidentNumber} was reopened`,
            metadata: { incidentId: reopened.id, reopenCount: reopened.reopenCount },
          },
        });
        logger.info({ camera: cam.name, incident: reopened.incidentNumber }, 'Reopened incident: camera dropped again');
      } else {
        const created = await incidentService.createIncident(await notice.incident());
        logger.info({ camera: cam.name, incident: created.incidentNumber }, 'Auto-created incident for offline camera');
      }
    }
    raised.outageIncidentAt = new Date();
  }

  if (raised.outageAlertedAt || raised.outageIncidentAt) {
    await prisma.camera.update({ where: { id: cam.id }, data: raised });
  }
}

/** The same delays as a camera on its own, but raised once for the recorder, however many of its cameras are down. */
async function notifyRecorderOutage(
  cam: OutageCamera,
  recorder: Recorder,
  level: AlertLevel,
  settings: { autoIncidentEnabled: boolean },
): Promise<void> {
  const prisma = getPrisma();
  const elapsed = outageElapsedMs(cam);
  const raised: { outageAlertedAt?: Date; outageIncidentAt?: Date } = {};

  if (!cam.outageAlertedAt && isDelayOver(level.alertDelayMinutes, elapsed)) {
    const open = await prisma.alert.findFirst({ where: openOutageAlert(recorder.id) });
    if (!open) {
      await createAlert({
        alertType: 'camera_offline',
        severity: 'critical',
        source: recorder.id,
        title: `Recorder offline: ${recorder.name}`,
        message: `Recorder "${recorder.name}" (${recorder.ipAddress}) is not answering, so none of its ${recorder.cameraCount} cameras can be seen. This one alert stands for all of them.`,
        details: { scope: 'recorder', deviceId: recorder.id, deviceName: recorder.name, cameraCount: recorder.cameraCount, lastPolledAt: cam.lastPolledAt ?? null },
      });
      logger.warn({ recorder: recorder.name, cameras: recorder.cameraCount }, 'Recorder offline: one alert for all its cameras');
    }
    raised.outageAlertedAt = new Date();
  }

  if (settings.autoIncidentEnabled && !cam.outageIncidentAt && isDelayOver(level.incidentDelayMinutes, elapsed)) {
    // A camera already down on its own before the recorder went keeps its own incident.
    if (!(await incidentService.getOpenIncidentForCamera(cam.id))) {
      const { incident, created } = await incidentService.addCameraToRecorderIncident(recorder, cam);
      if (created) logger.info({ recorder: recorder.name, incident: incident.incidentNumber }, 'Auto-created one incident for a recorder that is down');
    }
    raised.outageIncidentAt = new Date();
  }

  if (raised.outageAlertedAt || raised.outageIncidentAt) {
    await prisma.camera.update({ where: { id: cam.id }, data: { ...raised, outageViaDevice: true } });
  }
}

/**
 * A recorder that answers again ends what was raised for it. Its cameras still down after that are a fault of
 * their own now, so they go back to being raised one by one.
 */
async function closeRecorderOutages(answering: Set<string>, autoResolveEnabled: boolean): Promise<void> {
  if (answering.size === 0) return;
  const prisma = getPrisma();
  const ids = [...answering];
  const [alerts, incidents, stillDown] = await Promise.all([
    prisma.alert.findMany({ where: { alertType: 'camera_offline', source: { in: ids }, resolvedAt: null, severity: { not: 'info' } } }),
    autoResolveEnabled
      ? prisma.cameraIncident.findMany({ where: { deviceId: { in: ids }, status: 'open', detectionSource: { in: AUTO_DETECTED_INCIDENT_SOURCES } } })
      : Promise.resolve([]),
    prisma.camera.findMany({ where: { deviceId: { in: ids }, outageViaDevice: true, operationalStatus: 'offline' }, select: { id: true, deviceId: true } }),
  ]);

  for (const alert of alerts) {
    const downtimeMs = computeDowntimeMs(alert, null);
    const details = (alert.details as Record<string, unknown> | null) ?? {};
    const name = String(details.deviceName ?? alert.source);
    const left = stillDown.filter((c) => c.deviceId === alert.source).length;
    await prisma.alert.update({
      where: { id: alert.id },
      data: { resolvedAt: new Date(), resolvedBy: 'system', details: { ...details, resolvedReason: 'Recorder answering again', downtimeMs, downtimeFormatted: formatDuration(downtimeMs) } },
    });
    await createAlert({
      alertType: 'camera_offline',
      severity: 'info',
      source: alert.source ?? undefined,
      title: `Recorder online: ${name}`,
      message: `Recorder "${name}" is answering again. Downtime: ${formatDuration(downtimeMs)}.${left > 0 ? ` ${left} camera(s) on it are still down and are reported on their own from now.` : ''}`,
      details: { scope: 'recorder', deviceId: alert.source, deviceName: name, event: 'back_online', stillDown: left },
      skipDedup: true,
      closeOnCreate: true,
    });
    logger.info({ recorder: name, downtime: formatDuration(downtimeMs), stillDown: left }, 'Recorder answering again');
  }

  for (const incident of incidents) {
    const openMs = Date.now() - new Date(incident.lastReopenedAt ?? incident.openedAt).getTime();
    await incidentService.resolveIncident(incident.id, {
      resolution: `Recorder answered again after ${formatDuration(openMs)}.`,
      closedBy: 'system',
      autoResolved: true,
    });
  }

  if (stillDown.length > 0) {
    await prisma.camera.updateMany({
      where: { id: { in: stillDown.map((c) => c.id) } },
      data: { outageViaDevice: false, outageAlertedAt: null, outageIncidentAt: null },
    });
  }
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
  // Before the generic RTSP match: an RTSP 401 is a credential problem, not a stream fault.
  if (/\b401\b|unauthorized|authentication|invalid credentials/.test(text)) {
    return { rootCause: 'credentials', confidence: 'medium' };
  }
  if (/rtsp|554|stream connection|whep/.test(text)) {
    return { rootCause: 'rtsp_stream', confidence: 'high' };
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
  const outageSettings = { autoIncidentEnabled, reopenMinutes: Number(configs.camera_incident_reopen_minutes?.value ?? 30) };
  const alertLevels = await loadAlertLevels();
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
      channelNumber: true,
      operationalReason: true,
      alertLevel: true,
      outageAlertedAt: true,
      outageIncidentAt: true,
      outageViaDevice: true,
      device: { select: { alertLevel: true, id: true, name: true, brand: true, ipAddress: true, httpPort: true, rtspPort: true, username: true, passwordEncrypted: true } },
      lastPolledAt: true,
      operationalStatus: true,
      operationalSince: true,
    },
  });

  // A path MediaMTX reports as ready is receiving video right now: the strongest evidence a camera is up.
  const readyPaths = new Set(
    (await MediaMtxService.getLivePaths()).filter((p: any) => p?.ready).map((p: any) => String(p.name)),
  );

  // A recorder answers on the network even when a channel has no picture, so ask it about the channel itself.
  const noSignal = await readChannelsWithoutSignal(cameras.map((c) => c.device));

  // A recorder that does not answer at all takes every camera on it down: that is raised once, for the recorder.
  const recorders = await checkRecorders(cameras, readyPaths);
  // The first camera found stands for the recorder on its incident, so make that the lowest channel.
  cameras.sort((a, b) => (a.channelNumber ?? Number.MAX_SAFE_INTEGER) - (b.channelNumber ?? Number.MAX_SAFE_INTEGER));

  for (const cam of cameras) {
    // Maintenance mode suppression: if camera is in maintenance, skip offline alert and incident
    if (cam.status === 'maintenance') {
      continue;
    }

    const level = resolveAlertLevel(cam.alertLevel, cam.device?.alertLevel, alertLevels);
    const recorder = cam.device?.id ? recorders.down.get(cam.device.id) : undefined;

    // Actively probe the camera's network/RTSP/SMB target
    const streamReady = !!cam.streamPath && readyPaths.has(cam.streamPath.replace(/^\/+/, ''));
    const probeResult = streamReady
      ? { reachable: true, latencyMs: 0 }
      : await probeCameraHealth(cam);
    const isProbeSuccess = probeResult.reachable;
    if (streamReady) {
      await prisma.camera.update({ where: { id: cam.id }, data: { lastPolledAt: new Date() } });
    }
    const prev = cam.operationalStatus;
    // The threshold only delays the first verdict. A camera already down stays down until it answers.
    const alreadyDown = prev === 'offline' || prev === 'recovering';

    const timeSinceLastPoll = cam.lastPolledAt ? Date.now() - new Date(cam.lastPolledAt).getTime() : Infinity;
    const channelProblem = cam.device?.id && cam.channelNumber !== null ? noSignal.get(cam.device.id)?.get(cam.channelNumber) : undefined;
    const hasNoSignal = !!channelProblem;
    const isOffline = hasNoSignal || cam.status === 'error' || cam.status === 'inactive' || (!isProbeSuccess && (alreadyDown || timeSinceLastPoll > offlineThresholdMs(thresholdMs, level)));
    const rawNext = isOffline ? 'offline' : 'online';
    // What the recorder says comes first: the network being fine says nothing about a camera behind it.
    const offlineReason = !isOffline ? null : channelProblem ?? (cam.status === 'error' || cam.status === 'inactive' ? 'status_set' : recorder ? 'recorder_offline' : 'unreachable');
    if ((cam.operationalReason ?? null) !== offlineReason) {
      await prisma.camera.update({ where: { id: cam.id }, data: { operationalReason: offlineReason } });
    }

    const outageNotice = {
      alert: {
          alertType: 'camera_offline' as const,
          severity: 'critical' as const,
          source: cam.id,
          title: `Camera offline: ${cam.name}`,
          message: `Camera "${cam.name}" is offline.${channelProblem === 'no_signal' ? ' The recorder reports no video signal on this channel.' : channelProblem ? ' The recorder cannot reach this camera.' : ''} Status: ${cam.status}. Last poll: ${cam.lastPolledAt ? new Date(cam.lastPolledAt).toISOString() : 'never'}${await liveLinkLine(cam.id)}`,
          details: { cameraId: cam.id, cameraName: cam.name, status: cam.status, lastPolledAt: cam.lastPolledAt },
      },
      incident: async () => {
        const errMsg = await getRecentErrorMessage(cam.id);
        const suggestion = errMsg ? suggestRootCause(errMsg) : null;
        return {
            cameraId: cam.id,
            fromStatus: cam.status,
            toStatus: cam.status,
            reason: 'rtsp_unreachable',
            rootCause: suggestion?.rootCause ?? 'rtsp_stream',
            description: `Auto-detected: ${probeResult.reason || `no response for over ${offlineThresholdMin} minute(s)`}.`,
            priority: 'medium',
            impact: 'none',
            openedBy: 'system',
            detectionSource: 'health_monitor',
            rootCauseConfidence: suggestion?.confidence ?? 'medium',
        };
      },
    };

    // First-ever observation for this camera — record a baseline only, no event/alert noise.
    if (prev === 'unknown') {
      const baseline = new Date();
      await prisma.camera.update({
        where: { id: cam.id },
        data: { operationalStatus: rawNext as any, operationalSince: baseline, ...(rawNext === 'offline' ? { outageAlertedAt: baseline, outageIncidentAt: baseline } : {}) },
      });
      continue;
    }

    // online/recovering -> offline
    if ((prev === 'online' || prev === 'recovering') && rawNext === 'offline') {
      // Falling back while recovering is the same outage, so what it already raised still counts.
      const handled = prev === 'online' ? { outageAlertedAt: null, outageIncidentAt: null } : {};
      const offlineSince = new Date();
      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: 'offline', operationalSince: offlineSince, ...handled } });
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
          message: `Camera "${cam.name}" went offline (${channelProblem === 'no_signal' ? 'recorder reports no video signal on this channel, ' : channelProblem ? 'recorder cannot reach this camera, ' : ''}status: ${cam.status}, last poll: ${timeSinceLastPoll > 86400000 ? 'never' : Math.floor(timeSinceLastPoll / 1000) + 's ago'})`,
          metadata: { status: cam.status, lastPolledAt: cam.lastPolledAt, timeSinceLastPollMs: timeSinceLastPoll },
        },
      });

      await notifyOutage({ ...cam, operationalSince: offlineSince, ...handled }, level, outageSettings, outageNotice, recorder);
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
      if (Date.now() - recoveringSince < recoveryGraceMs - TICK_JITTER_MS) {
        // Still within the grace period — stay in "recovering" and check again next tick.
        continue;
      }

      await prisma.camera.update({ where: { id: cam.id }, data: { operationalStatus: 'online', operationalSince: new Date(), ...(cam.outageViaDevice ? { outageViaDevice: false } : {}) } });
      logger.info({ camera: cam.name, cameraId: cam.id }, 'Camera confirmed back online');

      await prisma.cameraEvent.create({
        data: { cameraId: cam.id, eventType: 'online', source: 'health_monitor', message: `Camera "${cam.name}" is back online`, metadata: { status: cam.status } },
      });

      const openAlert = await prisma.alert.findFirst({
        where: openOutageAlert(cam.id),
        orderBy: { createdAt: 'desc' },
      });

      let downtimeMs = 0;
      if (openAlert) {
        downtimeMs = computeDowntimeMs(openAlert, cam.operationalSince);
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

      // Nobody was told about a drop shorter than its delay, so there is nothing to call off. Nor about one
      // camera when it went down with its recorder: the recorder's own "online" says that.
      if (openAlert || (cam.outageAlertedAt && !cam.outageViaDevice)) {
        await createAlert({
          alertType: 'camera_offline',
          severity: 'info',
          source: cam.id,
          title: `Camera online: ${cam.name}`,
          message: `Camera "${cam.name}" is back online${openAlert ? '. Downtime: ' + formatDuration(downtimeMs) : ''}${await liveLinkLine(cam.id)}`,
          details: { cameraId: cam.id, cameraName: cam.name, event: 'back_online' },
          skipDedup: true,
          closeOnCreate: true,
        });
      }

      if (autoResolveEnabled) {
        const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
        // A recorder's incident closes when the recorder answers, not when its first camera does.
        if (openIncident && !openIncident.deviceId && AUTO_DETECTED_INCIDENT_SOURCES.includes(openIncident.detectionSource || '')) {
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

    // Still offline: raise what has come due since the last check.
    if (prev === 'offline' && rawNext === 'offline') {
      await notifyOutage(cam, level, outageSettings, outageNotice, recorder);
    }

    // Still offline: escalate the auto-created incident's priority as downtime grows.
    if (prev === 'offline' && rawNext === 'offline' && autoIncidentEnabled) {
      const openIncident = await incidentService.getOpenIncidentForCamera(cam.id);
      if (openIncident && AUTO_DETECTED_INCIDENT_SOURCES.includes(openIncident.detectionSource || '')) {
        const offlineMs = Date.now() - new Date(openIncident.lastReopenedAt ?? openIncident.openedAt).getTime();
        const nextPriority = computeEscalatedPriority(offlineMs, escalateHighMin, escalateCriticalMin);
        const subject = openIncident.deviceId ? `Recorder "${cam.device?.name ?? ''}"` : `Camera "${cam.name}"`;
        if (nextPriority !== openIncident.priority) {
          await prisma.cameraIncident.update({ where: { id: openIncident.id }, data: { priority: nextPriority } });
          logger.info({ camera: cam.name, incident: openIncident.incidentNumber, priority: nextPriority }, 'Escalated auto-incident priority');

          if (nextPriority === 'high' && openIncident.workflowStage === 'unassigned') {
            await createAlert({
              alertType: 'incident_escalation',
              severity: 'warning',
              source: openIncident.id,
              title: `Incident still unassigned: ${openIncident.incidentNumber}`,
              message: `${subject} has been offline for over ${escalateHighMin} minute(s) and incident ${openIncident.incidentNumber} has not been assigned to anyone yet.`,
              details: { cameraId: cam.id, cameraName: cam.name, incidentId: openIncident.id, incidentNumber: openIncident.incidentNumber },
            });
          }

          if (nextPriority === 'critical') {
            await createAlert({
              alertType: 'incident_escalation',
              severity: 'critical',
              source: openIncident.id,
              title: `Incident escalated to Critical: ${openIncident.incidentNumber}`,
              message: `${subject} has been offline for over ${escalateCriticalMin} minute(s). Incident ${openIncident.incidentNumber} needs attention.`,
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

  await closeRecorderOutages(recorders.answering, autoResolveEnabled);
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
      select: { id: true, name: true, deviceId: true, channelNumber: true, streamPath: true, status: true, operationalStatus: true, operationalSince: true, rtspUrl: true, recordingMode: true, alertLevel: true, outageAlertedAt: true, outageIncidentAt: true, outageViaDevice: true, lastPolledAt: true },
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

  // Live-only main streams and every sub stream are pulled only while someone watches, so their
  // stream closing usually means the last viewer left. It is an outage only if the camera stopped
  // answering too. Unwatched cameras are covered by the 1-minute health check.
  const onDemand = cleanPath.endsWith('_sub') || (camera as any).recordingMode !== 'continuous';
  const wasUp = prev === 'online' || prev === 'recovering';
  if (status === 'not_ready' && onDemand && (!wasUp || camera.status === 'maintenance' || !(await cameraStoppedResponding(camera.id)))) {
    return { success: true, cameraId: camera.id, status: prev ?? 'unknown', message: 'On-demand stream closed (no viewers)' };
  }

  // Stream went down (not_ready)
  if (status === 'not_ready') {
    if (camera.status === 'maintenance') {
      return { success: true, cameraId: camera.id, status: 'maintenance', message: 'Camera is in maintenance mode' };
    }

    // Falling back while recovering is the same outage, so what it already raised still counts.
    const handled = prev === 'online' ? { outageAlertedAt: null, outageIncidentAt: null } : {};
    const offlineSince = new Date();
    await prisma.camera.update({
      where: { id: camera.id },
      data: { operationalStatus: 'offline', operationalSince: offlineSince, operationalReason: 'stream_dropped', ...handled },
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

    // Anything not due yet is raised by the health check once its delay is over.
    const deviceId = (camera as any).deviceId as string | null | undefined;
    const device = deviceId ? await prisma.device.findUnique({ where: { id: deviceId }, select: { alertLevel: true } }) : null;
    const level = resolveAlertLevel((camera as any).alertLevel, device?.alertLevel, await loadAlertLevels());
    // Every channel of a recorder that dies reports at once. Ask the recorder before raising anything for one camera.
    const recorder = deviceId ? await recorderIfDown(deviceId) : undefined;
    await notifyOutage(
      { ...(camera as any), operationalSince: offlineSince, ...handled },
      level,
      { autoIncidentEnabled, reopenMinutes: Number(configs.camera_incident_reopen_minutes?.value ?? 30) },
      {
        alert: {
        alertType: 'camera_offline',
        severity: 'critical',
        source: camera.id,
        title: `Camera offline: ${camera.name}`,
        message: `Camera "${camera.name}" stream disconnected. Stream: ${cleanPath}.${await liveLinkLine(camera.id)}`,
        details: { cameraId: camera.id, cameraName: camera.name, streamPath: cleanPath, detectionSource: 'realtime_webhook', lastPolledAt: new Date() },
        },
        incident: async () => ({
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
        }),
      },
      recorder,
    );

    return {
      success: true,
      cameraId: camera.id,
      status: 'offline',
      message: `Camera ${camera.name} marked offline in real-time`,
    };
  }

  // A recorder streams its NO VIDEO picture to whoever opens the channel: that is not the camera coming back.
  if (status === 'ready' && prev === 'offline' && isKnownNoSignal((camera as any).deviceId, (camera as any).channelNumber)) {
    return { success: true, cameraId: camera.id, status: 'offline', message: `Camera ${camera.name} has no video signal` };
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
        data: { operationalStatus: 'online', operationalSince: new Date(), lastPolledAt: new Date(), ...((camera as any).outageViaDevice ? { outageViaDevice: false } : {}) },
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
        where: openOutageAlert(camera.id),
        orderBy: { createdAt: 'desc' },
      });

      let downtimeMs = 0;
      if (openAlert) {
        downtimeMs = computeDowntimeMs(openAlert, camera.operationalSince);
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

      // Nobody was told about a drop shorter than its delay, so there is nothing to call off.
      if (openAlert || ((camera as any).outageAlertedAt && !(camera as any).outageViaDevice)) {
        await createAlert({
          alertType: 'camera_offline',
          severity: 'info',
          source: camera.id,
          title: `Camera online: ${camera.name}`,
          message: `Camera "${camera.name}" is back online via real-time webhook${openAlert ? '. Downtime: ' + formatDuration(downtimeMs) : ''}${await liveLinkLine(camera.id)}`,
          details: { cameraId: camera.id, cameraName: camera.name, event: 'back_online', detectionSource: 'realtime_webhook' },
          skipDedup: true,
          closeOnCreate: true,
        });
      }

      if (autoResolveEnabled) {
        const openIncident = await incidentService.getOpenIncidentForCamera(camera.id);
        if (openIncident && !openIncident.deviceId && ['health_monitor', 'realtime_webhook'].includes(openIncident.detectionSource || '')) {
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

