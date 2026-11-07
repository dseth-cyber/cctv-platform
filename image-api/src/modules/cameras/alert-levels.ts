import { getPrisma } from '../../lib/prisma.js';

export interface AlertLevel {
  code: string;
  /** Minutes down before an alert. Null means never. */
  alertDelayMinutes: number | null;
  /** Minutes down before an incident. Null means never. */
  incidentDelayMinutes: number | null;
  isDefault?: boolean;
}

// Used only if the whole list has been deleted or switched off.
const FALLBACK_LEVEL: AlertLevel = { code: 'normal', alertDelayMinutes: 5, incidentDelayMinutes: 15 };
// The check runs once a minute but never exactly 60 s apart: a delay must not wait a whole extra round for that.
const TICK_JITTER_MS = 5000;

const delayOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

export async function loadAlertLevels(): Promise<AlertLevel[]> {
  const rows = await getPrisma().masterdata.findMany({ where: { type: 'alert_level', isActive: true } });
  return rows.map((row: any) => ({
    code: row.code,
    alertDelayMinutes: delayOf(row.config?.alertDelayMinutes),
    incidentDelayMinutes: delayOf(row.config?.incidentDelayMinutes),
    isDefault: row.isDefault,
  }));
}

/** The camera's own level, else its device's, else the default. A value no longer in the list counts as not set. */
export function resolveAlertLevel(cameraLevel: string | null | undefined, deviceLevel: string | null | undefined, levels: AlertLevel[]): AlertLevel {
  const find = (code: string | null | undefined) => (code ? levels.find((level) => level.code === code) : undefined);
  return find(cameraLevel) ?? find(deviceLevel) ?? levels.find((level) => level.isDefault) ?? FALLBACK_LEVEL;
}

/** A level that alerts sooner than the system-wide threshold also has to be called offline that soon. */
export function offlineThresholdMs(systemThresholdMs: number, level: AlertLevel): number {
  return level.alertDelayMinutes === null ? systemThresholdMs : Math.min(systemThresholdMs, level.alertDelayMinutes * 60_000);
}

/** The outage began when the camera last answered, which is before the system called it offline. */
export function outageElapsedMs(camera: { lastPolledAt?: Date | string | null; operationalSince?: Date | string | null }, now = Date.now()): number {
  const times = [camera.lastPolledAt, camera.operationalSince].filter(Boolean).map((t) => new Date(t as Date | string).getTime());
  return times.length > 0 ? Math.max(0, now - Math.min(...times)) : 0;
}

export function isDelayOver(delayMinutes: number | null, elapsedMs: number): boolean {
  return delayMinutes !== null && elapsedMs >= delayMinutes * 60_000 - TICK_JITTER_MS;
}
