import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlert, dispatchAlertNotifications } from '../alerts/alerts.service.js';
import { readClock } from '../device-playback/hikvision-recorder.js';
import { checkAllDevices, checkDeviceHealthNow, clockRoundNotice } from './device-health.service.js';

const mockPrisma = {
  device: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  camera: { update: vi.fn() },
  alert: { findFirst: vi.fn(), update: vi.fn() },
};
const limit = { value: 60 };

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../../lib/encryption.js', () => ({ decrypt: () => 'pw' }));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({ id: 'a-1' }), dispatchAlertNotifications: vi.fn() }));
vi.mock('../cameras/camera-analytics.service.js', () => ({ getCameraDowntimeReport: vi.fn() }));
vi.mock('../cameras/alert-levels.js', () => ({ loadAlertLevels: vi.fn().mockResolvedValue([]), resolveAlertLevel: vi.fn() }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn(async () => ({ device_clock_drift_alert_seconds: limit })),
}));
vi.mock('../device-playback/hikvision-recorder.js', () => ({
  addSeconds: vi.fn(),
  checkLogin: vi.fn().mockResolvedValue(undefined),
  earliestRecording: vi.fn(),
  readClock: vi.fn(),
  readContinuousChannels: vi.fn().mockResolvedValue(null),
  readDeviceInfo: vi.fn().mockResolvedValue(null),
  readCameraSpecs: vi.fn().mockResolvedValue({ specs: new Map(), smartCodecChannels: [] }),
  recordsSubStream: vi.fn().mockResolvedValue(false),
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

describe('one notice per round for clock warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.value = 60;
    mockPrisma.alert.findFirst.mockResolvedValue(null);
  });

  it('raises an alert per recorder but sends one notice naming them all', async () => {
    mockPrisma.device.findMany.mockResolvedValue([DEVICE, { ...DEVICE, id: 'dev-2', name: 'DVR Gate' }, { ...DEVICE, id: 'dev-3', name: 'NVR Yard' }]);
    clockAt(-683);
    await checkAllDevices();
    expect(clockAlerts()).toHaveLength(3);
    expect(clockAlerts().every((a: any) => a.skipNotify === true)).toBe(true);
    expect(dispatchAlertNotifications).toHaveBeenCalledTimes(1);
    const notice = vi.mocked(dispatchAlertNotifications).mock.calls[0][0];
    expect(notice).toMatchObject({ alertType: 'clock_drift', severity: 'warning', title: 'Clock off: 3 recorders' });
    expect(notice.message).toContain('- DVR Gate: behind the server by 11 min 23 s');
  });

  it('sends nothing when the round raised nothing new', async () => {
    mockPrisma.device.findMany.mockResolvedValue([DEVICE]);
    clockAt(1);
    await checkAllDevices();
    expect(dispatchAlertNotifications).not.toHaveBeenCalled();
  });

  it('a check by hand still tells about its own alert straight away', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(DEVICE);
    clockAt(461);
    await checkDeviceHealthNow('dev-1');
    expect(clockAlerts()[0].skipNotify).toBe(false);
  });
});

describe('clockRoundNotice', () => {
  const raised = (n: number) => Array.from({ length: n }, (_, i) => ({ source: `d${i}`, name: `R${i}`, title: `Clock off: R${i}`, message: `R${i} off`, driftSeconds: 90 }));

  it('is the recorder\'s own alert when only one was raised', () => {
    expect(clockRoundNotice(raised(1))).toEqual({ title: 'Clock off: R0', message: 'R0 off', source: 'd0' });
    expect(clockRoundNotice([])).toBeNull();
  });

  it('names at most twenty and counts the rest', () => {
    const notice = clockRoundNotice(raised(25))!;
    expect(notice.title).toBe('Clock off: 25 recorders');
    expect(notice.message).toContain('- R19: ahead of the server by 1 min 30 s');
    expect(notice.message).not.toContain('- R20:');
    expect(notice.message).toContain('...and 5 more');
  });
});

describe('a recorder that locked its account', () => {
  it('shows until when, and a check by hand during the lock sends nothing', async () => {
    vi.clearAllMocks();
    const { checkLogin, RecorderError } = await import('../device-playback/hikvision-recorder.js');
    const locked = Object.assign(new (RecorderError as any)('login'), { kind: 'login', unlockSeconds: 600 });
    vi.mocked(checkLogin).mockRejectedValueOnce(locked);
    mockPrisma.device.findUnique.mockResolvedValue({ ...DEVICE, id: 'dev-lock' });
    const first = await checkDeviceHealthNow('dev-lock');
    expect(first?.loginFailed).toBe(true);
    const until = new Date(first?.loginLockedUntil ?? 0).getTime() - Date.now();
    expect(until).toBeGreaterThan(590_000);
    expect(until).toBeLessThanOrEqual(600_000);
    mockPrisma.device.findUnique.mockResolvedValue({ ...DEVICE, id: 'dev-lock', healthInfo: first });
    await checkDeviceHealthNow('dev-lock');
    expect(checkLogin).toHaveBeenCalledTimes(1);
  });
});

describe('trying again after a lock', () => {
  it('tries once when the lock is over, even if the timer fires a little early', async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    try {
      const { checkLogin, RecorderError } = await import('../device-playback/hikvision-recorder.js');
      const locked = Object.assign(new (RecorderError as any)('login'), { kind: 'login', unlockSeconds: 1 });
      vi.mocked(checkLogin).mockRejectedValueOnce(locked);
      mockPrisma.device.findUnique.mockResolvedValue({ ...DEVICE, id: 'dev-early' });
      await checkDeviceHealthNow('dev-early');
      expect(checkLogin).toHaveBeenCalledTimes(1);
      // Fire the retry 5 ms before its time, as a real timer sometimes does.
      vi.setSystemTime(Date.now() - 5);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(checkLogin).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('how a recorder is set up', () => {
  it('notes Smart Codec channels and a recorded sub stream, looking at two channels that are up', async () => {
    vi.clearAllMocks();
    const rec = await import('../device-playback/hikvision-recorder.js');
    const main = { codec: 'H.265', width: 1920, height: 1080, fps: 15, bitrateKbps: 1536, rateControl: 'VBR', smartCodec: false };
    vi.mocked(rec.readCameraSpecs).mockResolvedValueOnce({ specs: new Map([[1, { main, signal: '1920*1080(1080P)P25' }], [3, { main }]]), smartCodecChannels: [1, 2] });
    vi.mocked(rec.recordsSubStream).mockImplementation(async (_l: any, ch: number) => ch === 1);
    vi.mocked(rec.readContinuousChannels).mockResolvedValue(new Set());
    clockAt(1);
    const cam = (n: number, status = 'online') => ({ id: `c${n}`, name: `Ch ${n}`, channelNumber: n, status: 'active', operationalStatus: status, alertLevel: null });
    mockPrisma.device.findUnique.mockResolvedValue({ ...DEVICE, id: 'dev-setup', cameras: [cam(1), cam(2, 'offline'), cam(3), cam(4)] });
    const health = await checkDeviceHealthNow('dev-setup');
    expect(health?.smartCodecChannels).toEqual([1, 2]);
    expect(health?.subRecordingChecked).toEqual([1, 3]);
    expect(health?.subRecordingChannels).toEqual([1]);
    expect(rec.recordsSubStream).toHaveBeenCalledTimes(2);
    // Each camera keeps what its recorder said about its channel; one with no reading is left alone.
    const saved = mockPrisma.camera.update.mock.calls.map(([a]: any) => [a.where.id, a.data.spec]);
    expect(saved).toEqual([['c1', { main, signal: '1920*1080(1080P)P25' }], ['c3', { main }]]);
  });
});

describe('camera spec is written only when it changed', () => {
  it('leaves a camera whose spec is the same alone', async () => {
    vi.clearAllMocks();
    const rec = await import('../device-playback/hikvision-recorder.js');
    const spec = { signal: 'PAL' };
    vi.mocked(rec.readCameraSpecs).mockResolvedValueOnce({ specs: new Map([[1, spec], [2, { signal: '1080P' }]]), smartCodecChannels: [] });
    clockAt(1);
    const cam = (n: number, s: unknown) => ({ id: `c${n}`, name: `Ch ${n}`, channelNumber: n, status: 'active', operationalStatus: 'online', alertLevel: null, spec: s });
    mockPrisma.device.findUnique.mockResolvedValue({ ...DEVICE, id: 'dev-spec', cameras: [cam(1, { signal: 'PAL' }), cam(2, null)] });
    await checkDeviceHealthNow('dev-spec');
    expect(mockPrisma.camera.update.mock.calls.map(([a]: any) => a.where.id)).toEqual(['c2']);
  });
});
