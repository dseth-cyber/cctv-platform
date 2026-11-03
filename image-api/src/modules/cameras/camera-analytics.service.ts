import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calculateHealthScore(
  availability: number,
  mtbfHours: number | null,
  mttrMinutes: number | null,
  offlineCount: number,
): number {
  // Availability: 40% weight (100% = 40pts, 90% = 36pts, etc)
  const availScore = Math.min(100, availability) * 0.4;

  // MTBF: 20% weight (>30d=20, >7d=15, >1d=10, <1d=5)
  let mtbfScore = 20;
  if (mtbfHours !== null) {
    if (mtbfHours >= 720) mtbfScore = 20;
    else if (mtbfHours >= 168) mtbfScore = 15;
    else if (mtbfHours >= 24) mtbfScore = 10;
    else mtbfScore = 5;
  }

  // MTTR: 20% weight (<5min=20, <15min=15, <60min=10, >60min=5)
  let mttrScore = 20;
  if (mttrMinutes !== null) {
    if (mttrMinutes <= 5) mttrScore = 20;
    else if (mttrMinutes <= 15) mttrScore = 15;
    else if (mttrMinutes <= 60) mttrScore = 10;
    else mttrScore = 5;
  }

  // Offline count: 20% weight (0=20, 1-2=15, 3-5=10, >5=5)
  let offScore = 20;
  if (offlineCount === 0) offScore = 20;
  else if (offlineCount <= 2) offScore = 15;
  else if (offlineCount <= 5) offScore = 10;
  else offScore = 5;

  return Math.round(availScore + mtbfScore + mttrScore + offScore);
}

function buildTimeline(
  events: Array<{ createdAt: Date; eventType: string; metadata: any }>,
  start: Date,
  end: Date,
) {
  const segments: Array<{
    start: string;
    end: string;
    status: string;
    durationMs: number;
  }> = [];

  // Map event types to status
  const eventToStatus = (eventType: string): string => {
    switch (eventType) {
      case 'online':
        return 'active';
      case 'offline':
      case 'error':
        return 'offline';
      case 'maintenance_start':
        return 'maintenance';
      case 'maintenance_end':
        return 'active';
      default:
        return 'active';
    }
  };

  // Determine initial status from first event's metadata (previousStatus) or default
  let currentStatus =
    events.length > 0 && events[0].metadata?.previousStatus
      ? events[0].metadata.previousStatus
      : 'active';
  let segStart = start;

  for (const e of events) {
    if (e.createdAt > segStart) {
      segments.push({
        start: segStart.toISOString(),
        end: e.createdAt.toISOString(),
        status: currentStatus,
        durationMs: e.createdAt.getTime() - segStart.getTime(),
      });
    }
    currentStatus = eventToStatus(e.eventType);
    segStart = e.createdAt;
  }

  // Final segment to now
  if (end.getTime() > segStart.getTime()) {
    segments.push({
      start: segStart.toISOString(),
      end: end.toISOString(),
      status: currentStatus,
      durationMs: end.getTime() - segStart.getTime(),
    });
  }

  const merged: typeof segments = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.status === seg.status) {
      last.end = seg.end;
      last.durationMs += seg.durationMs;
    } else {
      merged.push({ ...seg });
    }
  }

  const totalMs = merged.reduce((sum, s) => sum + s.durationMs, 0);
  const minMs = totalMs * 0.001;
  const filtered: typeof merged = [];
  for (const seg of merged) {
    const last = filtered[filtered.length - 1];
    if (seg.durationMs < minMs && last) {
      last.end = seg.end;
      last.durationMs += seg.durationMs;
    } else {
      filtered.push({ ...seg });
    }
  }

  const final: typeof filtered = [];
  for (const seg of filtered) {
    const last = final[final.length - 1];
    if (last && last.status === seg.status) {
      last.end = seg.end;
      last.durationMs += seg.durationMs;
    } else {
      final.push({ ...seg });
    }
  }

  return final;
}

async function getConfigValue(key: string, defaultValue: number): Promise<number> {
  const prisma = getPrisma();
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    if (config) {
      const parsed = Number(config.value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

export async function getCameraDowntimeReport(cameraId: string, period: string) {
  const prisma = getPrisma();
  const days = parseInt(period) || 7;
  const periodStart = new Date(Date.now() - days * 86400000);

  // Clamp the analysis window to the camera's creation time — a camera added
  // today must not count the days before it existed as downtime.
  const camera = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { createdAt: true, slaTargetPercent: true },
  });
  const since = camera && camera.createdAt > periodStart ? camera.createdAt : periodStart;

  // 1. Get camera events in period
  // Safety net, not an expected limit: genuine operational events (online/offline/
  // maintenance) for one camera over any realistic period should never come close to
  // this. It only exists so a future bug that floods camera_events (like retention-
  // sweeper writing one row per deleted file did — see incident_2026-08-07) degrades
  // this report's accuracy instead of making every page load fetch/process/return an
  // unbounded, ever-growing row count.
  const EVENT_CAP = 5000;
  const events = await prisma.cameraEvent.findMany({
    where: { cameraId, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    take: EVENT_CAP,
  });
  if (events.length === EVENT_CAP) {
    logger.warn({ cameraId, since }, 'Camera event count hit the analytics safety cap — downtime report may be incomplete for this period');
  }

  // 2. Calculate time in each status
  let uptimeMs = 0;
  let downtimeMs = 0;
  let maintenanceMs = 0;
  let offlineCount = 0;
  const repairTimes: number[] = []; // for MTTR
  const failureIntervals: number[] = []; // for MTBF

  let lastOnlineTime: Date | null = null;
  let lastOfflineTime: Date | null = null;

  // Determine initial status from the first event's previousStatus
  let currentStatus =
    events.length > 0 && (events[0].metadata as any)?.previousStatus
      ? (events[0].metadata as any).previousStatus
      : 'active';
  let segStart = since;

  for (const event of events) {
    const segDuration = event.createdAt.getTime() - segStart.getTime();

    // Accumulate duration by status
    if (currentStatus === 'active') {
      uptimeMs += segDuration;
    } else if (currentStatus === 'maintenance') {
      maintenanceMs += segDuration;
    } else {
      downtimeMs += segDuration;
    }

    // Determine new status from event type
    let newStatus: string;
    switch (event.eventType) {
      case 'online':
      case 'maintenance_end':
        newStatus = 'active';
        break;
      case 'maintenance_start':
        newStatus = 'maintenance';
        break;
      case 'offline':
      case 'error':
        newStatus = 'offline';
        break;
      default:
        newStatus = currentStatus;
    }

    // Track offline events
    if (
      newStatus === 'offline' &&
      currentStatus !== 'offline'
    ) {
      offlineCount++;
      lastOfflineTime = event.createdAt;

      // If there was a previous online time, track MTBF
      if (lastOnlineTime) {
        failureIntervals.push(
          event.createdAt.getTime() - lastOnlineTime.getTime(),
        );
      }
    }

    // Track coming back online (repair time)
    if (
      newStatus === 'active' &&
      (currentStatus === 'offline' || currentStatus === 'error') &&
      lastOfflineTime
    ) {
      repairTimes.push(
        event.createdAt.getTime() - lastOfflineTime.getTime(),
      );
      lastOnlineTime = event.createdAt;
      lastOfflineTime = null;
    }

    if (newStatus === 'active' && currentStatus !== 'active') {
      lastOnlineTime = event.createdAt;
    }

    currentStatus = newStatus;
    segStart = event.createdAt;
  }

  // Final segment to now
  const now = new Date();
  const finalDuration = now.getTime() - segStart.getTime();
  if (currentStatus === 'active') {
    uptimeMs += finalDuration;
  } else if (currentStatus === 'maintenance') {
    maintenanceMs += finalDuration;
  } else {
    downtimeMs += finalDuration;
  }

  const totalMs = uptimeMs + downtimeMs + maintenanceMs || 1;
  // SLA availability excludes planned Maintenance entirely (neither uptime nor downtime) —
  // a camera taken down for scheduled maintenance shouldn't be penalized against its SLA target.
  const slaEligibleMs = uptimeMs + downtimeMs || 1;
  const availability = (uptimeMs / slaEligibleMs) * 100;
  const mtbf =
    failureIntervals.length > 0
      ? failureIntervals.reduce((a, b) => a + b, 0) /
        failureIntervals.length /
        3600000
      : null; // hours
  const mttr =
    repairTimes.length > 0
      ? repairTimes.reduce((a, b) => a + b, 0) /
        repairTimes.length /
        60000
      : null; // minutes

  // Build timeline early to inspect offline periods
  const timeline = buildTimeline(
    events.map((e) => ({
      createdAt: e.createdAt,
      eventType: e.eventType,
      metadata: e.metadata,
    })),
    since,
    now,
  );

  // 5. Downtime by reason
  const reasonCounts: Record<string, { count: number; totalMs: number }> = {};
  for (const event of events) {
    if (
      (event.eventType === 'offline' || event.eventType === 'error') &&
      event.downtimeReason
    ) {
      if (!reasonCounts[event.downtimeReason]) {
        reasonCounts[event.downtimeReason] = { count: 0, totalMs: 0 };
      }
      reasonCounts[event.downtimeReason].count++;
    }
  }

  // 6. Health Score
  const healthScore = calculateHealthScore(
    availability,
    mtbf,
    mttr,
    offlineCount,
  );

  // 7. SLA target — per-camera override (Availability Contract) takes priority over the global default.
  const globalSlaTarget = await getConfigValue('camera_sla_target', 99.5);
  const slaTarget = camera?.slaTargetPercent ?? globalSlaTarget;
  const hasCustomSla = camera?.slaTargetPercent != null;

  return {
    cameraId,
    period: `${days}d`,
    availability: round2(availability),
    slaTarget,
    slaMet: availability >= slaTarget,
    hasCustomSla,
    uptime: {
      seconds: Math.round(uptimeMs / 1000),
      percent: round2((uptimeMs / totalMs) * 100),
    },
    downtime: {
      seconds: Math.round(downtimeMs / 1000),
      percent: round2((downtimeMs / totalMs) * 100),
    },
    maintenance: {
      seconds: Math.round(maintenanceMs / 1000),
      percent: round2((maintenanceMs / totalMs) * 100),
      excludedFromSla: true,
    },
    mtbf,
    mttr,
    offlineCount,
    healthScore,
    healthGrade:
      healthScore >= 90
        ? 'excellent'
        : healthScore >= 70
          ? 'good'
          : healthScore >= 50
            ? 'warning'
            : 'critical',
    downtimeByReason: reasonCounts,
    events: events.map((e) => ({
      id: String(e.id),
      eventType: e.eventType,
      downtimeReason: e.downtimeReason,
      message: e.message,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    timeline,
  };
}

export async function getCameraComparisonReport(period: string) {
  const prisma = getPrisma();
  const cameras = await prisma.camera.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  const reports = await Promise.all(
    cameras.map((c) => getCameraDowntimeReport(c.id, period)),
  );

  return reports.map((r, i) => ({
    cameraId: cameras[i].id,
    cameraName: cameras[i].name,
    availability: r.availability,
    slaTarget: r.slaTarget,
    slaMet: r.slaMet,
    hasCustomSla: r.hasCustomSla,
    mtbf: r.mtbf,
    mttr: r.mttr,
    healthScore: r.healthScore,
    healthGrade: r.healthGrade,
    offlineCount: r.offlineCount,
  }));
}
