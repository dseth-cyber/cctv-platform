import type { Prisma } from '@prisma/client';
import { sortByName } from '../../lib/natural-sort.js';
import { decrypt } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';
import { createAlert } from '../alerts/alerts.service.js';
import { getCameraDowntimeReport } from '../cameras/camera-analytics.service.js';
import { loadAlertLevels, resolveAlertLevel } from '../cameras/alert-levels.js';
import {
  addSeconds,
  earliestRecording,
  readClock,
  readContinuousChannels,
  readDeviceInfo,
  readDisks,
  RecorderError,
  searchRecordings,
  secondsBetween,
  type RecorderDisk,
  type RecorderLogin,
} from '../device-playback/hikvision-recorder.js';
import { getAllConfigs } from '../system-config/system-config.service.js';

// Only reads from the recorder, and one recorder at a time so a check never competes with someone watching.
const TICK_MS = 60_000;
const FIRST_CHECK_AFTER_MS = 60_000;
const PAUSE_BETWEEN_CHANNELS_MS = 300;
/** A channel with no footage in this long has stopped recording. */
const RECORDING_WINDOW_SECONDS = 30 * 60;
const HOT_DISK_CELSIUS = 60;
const RETENTION_LOOKBACK_SECONDS = 400 * 86400;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRecorderBrand = (brand: string | null | undefined) => /hik|hilook/i.test(brand ?? '');

export type HealthProblem = 'no_disk' | 'disk_fault' | 'disk_smart' | 'disk_hot' | 'not_recording' | 'clock_drift';

/**
 * Whether the recorder's clock is out by more than the limit. Footage, playback and clips carry the recorder's time,
 * so a wrong clock puts evidence at the wrong time. null means not known (no reading, or the check is off): leave as is.
 */
export function clockIsOff(driftSeconds: number | null | undefined, limitSeconds: number): boolean | null {
  if (driftSeconds === null || driftSeconds === undefined || !(limitSeconds > 0)) return null;
  return Math.abs(driftSeconds) > limitSeconds;
}

/** "ahead 7 min 41 s" — for the alert text. */
export function describeDrift(driftSeconds: number): string {
  const size = Math.abs(driftSeconds);
  return `${driftSeconds > 0 ? 'ahead of' : 'behind'} the server by ${Math.floor(size / 60)} min ${size % 60} s`;
}

/** What is wrong with these disks. "idle" is a disk asleep and "ok" a disk at work: both are healthy. */
export function diskProblems(disks: RecorderDisk[]): HealthProblem[] {
  const problems = new Set<HealthProblem>();
  if (disks.length === 0) problems.add('no_disk');
  for (const disk of disks) {
    if (disk.state && !['ok', 'idle'].includes(disk.state.toLowerCase())) problems.add('disk_fault');
    if (disk.smart && disk.smart.toLowerCase() !== 'ok') problems.add('disk_smart');
    if (disk.temperature !== null && disk.temperature >= HOT_DISK_CELSIUS) problems.add('disk_hot');
  }
  return [...problems];
}

export interface DeviceHealth {
  checkedAt: string;
  reachable: boolean;
  loginFailed: boolean;
  reportedModel: string | null;
  disks: RecorderDisk[];
  clockDriftSeconds: number | null;
  /** Where the recorder takes its time from: "NTP" or "manual". */
  clockMode?: string | null;
  oldestRecording: string | null;
  retentionDays: number | null;
  notRecording: Array<{ channel: number; name: string }>;
  channelsChecked: number;
  problems: HealthProblem[];
}

interface HealthDevice {
  id: string;
  name: string;
  brand: string | null;
  ipAddress: string;
  httpPort: number | null;
  rtspPort: number;
  username: string | null;
  passwordEncrypted: string | null;
  alertLevel: string | null;
  healthInfo?: unknown;
  cameras: Array<{ id: string; name: string; channelNumber: number | null; status: string; operationalStatus: string | null; alertLevel: string | null }>;
}

const SELECT_DEVICE = {
  id: true,
  name: true,
  brand: true,
  ipAddress: true,
  httpPort: true,
  rtspPort: true,
  username: true,
  passwordEncrypted: true,
  alertLevel: true,
  healthInfo: true,
  cameras: {
    where: { deletedAt: null, enabled: true },
    select: { id: true, name: true, channelNumber: true, status: true, operationalStatus: true, alertLevel: true },
    orderBy: { channelNumber: 'asc' as const },
  },
};

// A wrong login is not repeated: a recorder locks its account after a few. It is tried again once the password changes.
const loginFailedFor = new Map<string, string>();

async function channelsNotRecording(device: HealthDevice, login: RecorderLogin, deviceNow: string) {
  const [levels, continuous] = await Promise.all([loadAlertLevels(), readContinuousChannels(login)]);
  const from = addSeconds(deviceNow, -RECORDING_WINDOW_SECONDS);
  const stopped: Array<{ channel: number; name: string }> = [];
  let checked = 0;
  for (const camera of device.cameras) {
    if (camera.channelNumber === null || camera.status !== 'active' || camera.operationalStatus !== 'online') continue;
    // Set to record only on motion, an empty half hour is normal. On a no-alert level, nobody wants to hear about it.
    if (continuous && !continuous.has(camera.channelNumber)) continue;
    if (resolveAlertLevel(camera.alertLevel, device.alertLevel, levels).alertDelayMinutes === null) continue;
    checked += 1;
    const { ranges } = await searchRecordings(login, camera.channelNumber, from, deviceNow);
    if (ranges.length === 0) stopped.push({ channel: camera.channelNumber, name: camera.name });
    await sleep(PAUSE_BETWEEN_CHANNELS_MS);
  }
  return { stopped, checked };
}

async function readHealth(device: HealthDevice, login: RecorderLogin, clockLimitSeconds: number): Promise<{ health: DeviceHealth; facts: { macAddress: string | null; firmwareVersion: string | null; serialNumber: string | null } }> {
  const info = await readDeviceInfo(login);
  const disks = await readDisks(login);
  const clock = await readClock(login);
  const firstChannel = device.cameras.find((c) => c.channelNumber !== null && c.operationalStatus === 'online')?.channelNumber;
  const now = clock?.deviceTime ?? null;
  const oldest = now && firstChannel ? await earliestRecording(login, firstChannel, addSeconds(now, -RETENTION_LOOKBACK_SECONDS), now) : null;
  const { stopped, checked } = now ? await channelsNotRecording(device, login, now) : { stopped: [], checked: 0 };
  const problems = diskProblems(disks);
  if (stopped.length > 0) problems.push('not_recording');
  if (clockIsOff(clock?.driftSeconds, clockLimitSeconds)) problems.push('clock_drift');
  return {
    facts: { macAddress: info?.macAddress ?? null, firmwareVersion: info?.firmwareVersion ?? null, serialNumber: info?.serialNumber ?? null },
    health: {
      checkedAt: new Date().toISOString(),
      reachable: true,
      loginFailed: false,
      reportedModel: info?.model ?? null,
      disks,
      clockDriftSeconds: clock?.driftSeconds ?? null,
      clockMode: clock?.mode ?? null,
      oldestRecording: oldest,
      retentionDays: oldest && now ? Math.floor(secondsBetween(oldest, now) / 86400) : null,
      notRecording: stopped,
      channelsChecked: checked,
      problems,
    },
  };
}

/** One alert while the problem lasts, closed by itself when it clears. */
async function syncAlert(
  device: HealthDevice,
  alertType: 'hdd_problem' | 'recording_stopped' | 'clock_drift',
  active: boolean,
  title: string,
  message: string,
  details: Record<string, unknown>,
  severity: 'critical' | 'warning' = 'critical',
) {
  const prisma = getPrisma();
  const open = await prisma.alert.findFirst({ where: { alertType, source: device.id, resolvedAt: null, deletedAt: null } });
  if (active && !open) {
    await createAlert({ alertType, severity, source: device.id, title, message, details: { deviceId: device.id, deviceName: device.name, ...details }, skipDedup: true });
  } else if (!active && open) {
    await prisma.alert.update({ where: { id: open.id }, data: { resolvedAt: new Date(), resolvedBy: 'system' } });
  }
}

async function checkDevice(device: HealthDevice): Promise<DeviceHealth | null> {
  if (!isRecorderBrand(device.brand) || !device.passwordEncrypted) return null;
  const prisma = getPrisma();
  const failedFor = loginFailedFor.get(device.id);
  const previous = (device.healthInfo ?? null) as DeviceHealth | null;
  if (failedFor === device.passwordEncrypted) return previous;
  const login: RecorderLogin = {
    host: device.ipAddress,
    httpPort: device.httpPort ?? 80,
    rtspPort: device.rtspPort,
    username: device.username ?? '',
    password: decrypt(device.passwordEncrypted),
  };

  const configs = await getAllConfigs();
  const clockLimitSeconds = Number(configs.device_clock_drift_alert_seconds?.value ?? 60);
  let health: DeviceHealth;
  let facts: Record<string, string> = {};
  try {
    const read = await readHealth(device, login, clockLimitSeconds);
    health = read.health;
    facts = Object.fromEntries(Object.entries(read.facts).filter(([, v]) => v)) as Record<string, string>;
    loginFailedFor.delete(device.id);
  } catch (err) {
    const loginFailed = err instanceof RecorderError && err.kind === 'login';
    if (loginFailed) {
      loginFailedFor.set(device.id, device.passwordEncrypted);
    } else if (!(err instanceof RecorderError)) {
      logger.warn({ deviceId: device.id, reason: err instanceof Error ? err.message : 'failed' }, 'Device health check failed');
    }
    // What was last known stays on show, marked as out of date. A recorder not answering is the camera health check's job.
    health = { ...(previous ?? { reportedModel: null, disks: [], clockDriftSeconds: null, oldestRecording: null, retentionDays: null, notRecording: [], channelsChecked: 0, problems: [] }), checkedAt: previous?.checkedAt ?? new Date().toISOString(), reachable: false, loginFailed };
    await prisma.device.update({ where: { id: device.id }, data: { healthInfo: health as object } });
    return health;
  }

  await prisma.device.update({ where: { id: device.id }, data: { healthInfo: health as object, healthCheckedAt: new Date(), ...facts } });
  const diskList = diskProblems(health.disks);
  await syncAlert(device, 'hdd_problem', diskList.length > 0, `HDD problem: ${device.name}`, `${device.name}: ${diskList.join(', ')}`, { problems: diskList, disks: health.disks });
  const channels = health.notRecording.map((c) => c.channel);
  await syncAlert(device, 'recording_stopped', channels.length > 0, `Recording stopped: ${device.name}`, `${device.name}: no recording in the last 30 minutes on channel ${channels.join(', ')}`, { channels: health.notRecording });
  // Not critical: the cameras still record, only at the wrong time. No reading leaves the alert as it was.
  const clockOff = clockIsOff(health.clockDriftSeconds, clockLimitSeconds);
  if (clockOff !== null) {
    await syncAlert(device, 'clock_drift', clockOff, `Clock off: ${device.name}`, `${device.name}: clock is ${describeDrift(health.clockDriftSeconds ?? 0)} (limit ${clockLimitSeconds} s). Footage and clips carry the recorder's time; set NTP on the recorder.`, { driftSeconds: health.clockDriftSeconds, limitSeconds: clockLimitSeconds }, 'warning');
  }
  return health;
}

export async function checkDeviceHealthNow(deviceId: string) {
  const device = await getPrisma().device.findUnique({ where: { id: deviceId }, select: SELECT_DEVICE });
  if (!device) return null;
  // Asking by hand means the password may have been fixed on the recorder, so try it once more.
  loginFailedFor.delete(deviceId);
  return checkDevice(device as HealthDevice);
}

let timer: NodeJS.Timeout | null = null;
let lastRunAt = 0;
let running = false;

async function checkAllDevices() {
  if (running) return;
  running = true;
  try {
    const devices = await getPrisma().device.findMany({ where: { enabled: true }, select: SELECT_DEVICE });
    for (const device of devices) {
      await checkDevice(device as HealthDevice).catch((err) => logger.warn({ deviceId: device.id, reason: err instanceof Error ? err.message : 'failed' }, 'Device health check failed'));
    }
  } finally {
    running = false;
  }
}

export function startDeviceHealthChecks() {
  if (timer) return;
  const startedAt = Date.now();
  timer = setInterval(() => {
    void (async () => {
      const configs = await getAllConfigs();
      const everyMs = Number(configs.device_health_check_minutes?.value ?? 60) * 60_000;
      const firstDue = lastRunAt === 0 && Date.now() - startedAt >= FIRST_CHECK_AFTER_MS;
      if (firstDue || (lastRunAt > 0 && Date.now() - lastRunAt >= everyMs)) {
        lastRunAt = Date.now();
        await checkAllDevices();
      }
    })().catch((err) => logger.warn({ reason: err instanceof Error ? err.message : 'failed' }, 'Device health round failed'));
  }, TICK_MS);
  timer.unref();
}

export function stopDeviceHealthChecks() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** One row per device for the report: what it is, how it is, and how its cameras did over the period. */
export async function buildDeviceReport(days: number, scope?: Prisma.CameraWhereInput) {
  const prisma = getPrisma();
  const since = new Date(Date.now() - days * 86400000);
  const reachable: Prisma.CameraWhereInput = { deletedAt: null, ...(scope ? { AND: [scope] } : {}) };
  const devices = await prisma.device.findMany({
    where: scope ? { cameras: { some: reachable } } : {},
    include: {
      site: { select: { name: true } },
      zone: { select: { name: true } },
      cameras: { where: reachable, select: { id: true, enabled: true, operationalStatus: true, operationalReason: true } },
    },
    orderBy: { name: 'asc' },
  });
  return Promise.all(sortByName(devices).map(async (device) => {
    const inUse = device.cameras.filter((c) => c.enabled);
    const downtimes = await Promise.all(inUse.map((c) => getCameraDowntimeReport(c.id, `${days}d`).catch(() => null)));
    const known = downtimes.filter((r): r is NonNullable<typeof r> => r !== null);
    const [incidents, openIncidents] = await Promise.all([
      prisma.cameraIncident.count({ where: { openedAt: { gte: since }, cameraId: { in: device.cameras.map((c) => c.id) } } }),
      prisma.cameraIncident.count({ where: { status: 'open', cameraId: { in: device.cameras.map((c) => c.id) } } }),
    ]);
    const health = (device.healthInfo ?? null) as DeviceHealth | null;
    return {
      id: device.id,
      name: device.name,
      deviceType: device.deviceType,
      brand: device.brand,
      model: device.model,
      reportedModel: health?.reportedModel ?? null,
      serialNumber: device.serialNumber,
      macAddress: device.macAddress,
      firmwareVersion: device.firmwareVersion,
      ipAddress: device.ipAddress,
      siteName: device.site?.name ?? null,
      zoneName: device.zone?.name ?? null,
      totalChannels: device.totalChannels,
      channelsInUse: inUse.length,
      online: inUse.filter((c) => c.operationalStatus === 'online').length,
      offline: inUse.filter((c) => c.operationalStatus === 'offline').length,
      noSignal: inUse.filter((c) => c.operationalReason === 'no_signal').length,
      incidents,
      openIncidents,
      offlineEvents: known.reduce((sum, r) => sum + (r.offlineCount ?? 0), 0),
      availability: known.length > 0 ? Math.round((known.reduce((sum, r) => sum + (r.availability ?? 0), 0) / known.length) * 100) / 100 : null,
      healthCheckedAt: device.healthCheckedAt,
      reachable: health?.reachable ?? null,
      disks: health?.disks ?? [],
      diskProblems: health ? diskProblems(health.disks) : [],
      clockDriftSeconds: health?.clockDriftSeconds ?? null,
      retentionDays: health?.retentionDays ?? null,
      notRecording: health?.notRecording ?? [],
    };
  }));
}
