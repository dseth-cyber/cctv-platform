import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlert } from '../alerts/alerts.service.js';
import { readClock } from '../device-playback/hikvision-recorder.js';
import { checkDeviceHealthNow } from './device-health.service.js';

const mockPrisma = {
  device: { findUnique: vi.fn(), update: vi.fn() },
  alert: { findFirst: vi.fn(), update: vi.fn() },
};
const limit = { value: 60 };

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../../lib/encryption.js', () => ({ decrypt: () => 'pw' }));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({ id: 'a-1' }) }));
vi.mock('../cameras/camera-analytics.service.js', () => ({ getCameraDowntimeReport: vi.fn() }));
vi.mock('../cameras/alert-levels.js', () => ({ loadAlertLevels: vi.fn().mockResolvedValue([]), resolveAlertLevel: vi.fn() }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn(async () => ({ device_clock_drift_alert_seconds: limit })),
}));
vi.mock('../device-playback/hikvision-recorder.js', () => ({
  addSeconds: vi.fn(),
  earliestRecording: vi.fn(),
  readClock: vi.fn(),
  readContinuousChannels: vi.fn().mockResolvedValue(null),
  readDeviceInfo: vi.fn().mockResolvedValue(null),
  readDisks: vi.fn().mockResolvedValue([{ id: '1', type: 'SATA', state: 'ok', capacityMB: 1, freeMB: 0, smart: 'ok', temperature: 40, powerOnDays: 1 }]),
  RecorderError: class RecorderError extends Error {},
  searchRecordings: vi.fn(),
  secondsBetween: vi.fn(),
}));

const DEVICE = { id: 'dev-1', name: 'NVR Office', brand: 'Hikvision', ipAddress: '10.0.0.5', httpPort: 80, rtspPort: 554, username: 'u', passwordEncrypted: 'enc', alertLevel: null, healthInfo: null, cameras: [] };
const clockAt = (driftSeconds: number | null) => vi.mocked(readClock).mockResolvedValue(driftSeconds === null ? null : { deviceTime: '2026-11-09T10:00:00', driftSeconds, mode: 'manual' });
const clockAlerts = () => vi.mocked(createAlert).mock.calls.map(([a]) => a).filter((a) => a.alertType === 'clock_drift');

describe('an alert for a recorder clock that is off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.value = 60;
    mockPrisma.device.findUnique.mockResolvedValue(DEVICE);
    mockPrisma.alert.findFirst.mockResolvedValue(null);
  });

  it('warns once when the clock is off by more than the limit, and lists it as a problem', async () => {
    clockAt(461);
    const health = await checkDeviceHealthNow('dev-1');
    expect(health?.problems).toContain('clock_drift');
    expect(clockAlerts()).toHaveLength(1);
    expect(clockAlerts()[0]).toMatchObject({ severity: 'warning', source: 'dev-1', title: 'Clock off: NVR Office' });
    expect(clockAlerts()[0].message).toContain('ahead of the server by 7 min 41 s');
  });

  it('does not warn again while one is open', async () => {
    clockAt(461);
    mockPrisma.alert.findFirst.mockImplementation(async ({ where }: any) => (where.alertType === 'clock_drift' ? { id: 'open-1' } : null));
    await checkDeviceHealthNow('dev-1');
    expect(clockAlerts()).toHaveLength(0);
    expect(mockPrisma.alert.update).not.toHaveBeenCalled();
  });

  it('closes the open alert once the clock is right', async () => {
    clockAt(2);
    mockPrisma.alert.findFirst.mockImplementation(async ({ where }: any) => (where.alertType === 'clock_drift' ? { id: 'open-1' } : null));
    const health = await checkDeviceHealthNow('dev-1');
    expect(health?.problems).not.toContain('clock_drift');
    expect(mockPrisma.alert.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'open-1' } }));
  });

  it('leaves the alert alone when the clock could not be read', async () => {
    clockAt(null);
    mockPrisma.alert.findFirst.mockImplementation(async ({ where }: any) => (where.alertType === 'clock_drift' ? { id: 'open-1' } : null));
    await checkDeviceHealthNow('dev-1');
    expect(clockAlerts()).toHaveLength(0);
    expect(mockPrisma.alert.update).not.toHaveBeenCalled();
  });

  it('stays quiet with the check turned off', async () => {
    limit.value = 0;
    clockAt(461);
    const health = await checkDeviceHealthNow('dev-1');
    expect(health?.problems).not.toContain('clock_drift');
    expect(clockAlerts()).toHaveLength(0);
  });
});
