export interface DeviceDisk {
  id: string;
  type: string | null;
  state: string | null;
  capacityMB: number | null;
  freeMB: number | null;
  smart: string | null;
  temperature: number | null;
  powerOnDays: number | null;
}

export interface DeviceHealthInfo {
  checkedAt: string;
  reachable: boolean;
  loginFailed: boolean;
  reportedModel: string | null;
  disks: DeviceDisk[];
  clockDriftSeconds: number | null;
  clockMode?: string | null;
  oldestRecording: string | null;
  retentionDays: number | null;
  notRecording: Array<{ channel: number; name: string }>;
  channelsChecked: number;
  problems: string[];
}

/** A difference this small is the time the question took, not a wrong clock. */
const CLOCK_EVEN_SECONDS = 5;

export function summarizeDeviceHealth(health: DeviceHealthInfo | null | undefined): 'unknown' | 'ok' | 'problem' | 'stale' {
  if (!health) return 'unknown';
  if (!health.reachable) return 'stale';
  return health.problems.length > 0 ? 'problem' : 'ok';
}

export function clockDriftParts(driftSeconds: number | null | undefined) {
  if (driftSeconds === null || driftSeconds === undefined) return null;
  const size = Math.abs(driftSeconds);
  if (size <= CLOCK_EVEN_SECONDS) return { direction: 'even' as const, minutes: 0, seconds: 0 };
  return { direction: driftSeconds > 0 ? ('ahead' as const) : ('behind' as const), minutes: Math.floor(size / 60), seconds: size % 60 };
}

/** Recorders report mebibytes; a person reads the size printed on the disk. */
export function formatCapacity(megabytes: number | null | undefined): string {
  if (megabytes === null || megabytes === undefined) return '—';
  const terabytes = (megabytes * 1024 * 1024) / 1e12;
  return terabytes >= 1 ? `${Math.round(terabytes)} TB` : `${Math.round(terabytes * 1000)} GB`;
}

export type InfoField = 'model' | 'serialNumber' | 'macAddress' | 'firmwareVersion' | 'deviceType' | 'brand';

export interface DeviceInfoReading {
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  macAddress?: string | null;
  firmwareVersion?: string | null;
  deviceType?: string | null;
}

const FILLS_WHEN_EMPTY: InfoField[] = ['model', 'serialNumber', 'macAddress', 'firmwareVersion'];
const COMPARED: InfoField[] = ['brand', 'deviceType', 'model', 'serialNumber', 'macAddress', 'firmwareVersion'];

const same = (a: string, b: string, field: InfoField) =>
  field === 'brand' ? /hik|hilook/i.test(a) === /hik|hilook/i.test(b) : a.trim().toLowerCase() === b.trim().toLowerCase();

/** What the device said against what the form holds: empty boxes get filled, and a difference is left for the person to decide. */
export function compareDeviceInfo(form: Partial<Record<InfoField, string>>, reading: DeviceInfoReading) {
  const fill: Partial<Record<InfoField, string>> = {};
  const differs: Array<{ field: InfoField; saved: string; reported: string }> = [];
  for (const field of COMPARED) {
    const reported = reading[field];
    if (!reported) continue;
    const saved = form[field]?.trim() ?? '';
    if (!saved) {
      if (FILLS_WHEN_EMPTY.includes(field)) fill[field] = reported;
    } else if (!same(saved, reported, field)) {
      differs.push({ field, saved, reported });
    }
  }
  return { fill, differs };
}
