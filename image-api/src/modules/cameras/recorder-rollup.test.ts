import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraFlapHistory, checkCameraHealth } from './camera-health-monitor.js';
import { createAlert } from '../alerts/alerts.service.js';
import { addCameraToRecorderIncident, createIncident, resolveIncident } from './camera-incident.service.js';
import { checkRecorders, withRecorderLock } from './recorder-outage.js';

const mockPrisma = {
  camera: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  cameraEvent: { create: vi.fn() },
  cameraIncident: { findMany: vi.fn() },
  alert: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  masterdata: { findMany: vi.fn() },
};
const mockProbe = vi.fn();
const mockTcp = vi.fn();

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn().mockResolvedValue({
    camera_offline_threshold_minutes: { value: 2 },
    camera_recovery_grace_minutes: { value: 1 },
    camera_auto_incident_enabled: { value: true },
    camera_auto_resolve_enabled: { value: true },
    camera_incident_reopen_minutes: { value: 30 },
  }),
}));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({ id: 'alert-1' }) }));
vi.mock('./camera-incident.service.js', () => ({
  getOpenIncidentForCamera: vi.fn().mockResolvedValue(null),
  reopenRecentIncident: vi.fn().mockResolvedValue(null),
  createIncident: vi.fn().mockResolvedValue({ id: 'inc-1', incidentNumber: 'INC-1' }),
  addCameraToRecorderIncident: vi.fn().mockResolvedValue({ incident: { id: 'inc-r', incidentNumber: 'INC-R' }, created: true }),
  resolveIncident: vi.fn().mockResolvedValue({}),
}));
vi.mock('./camera-probe.service.js', () => ({
  NO_PROBE_TARGET: 'No probe target configured',
  probeCameraHealth: (...args: unknown[]) => mockProbe(...args),
  probeTcpEndpoint: (...args: unknown[]) => mockTcp(...args),
}));
vi.mock('../media/mediamtx.service.js', () => ({ MediaMtxService: { getLivePaths: vi.fn().mockResolvedValue([]) } }));
vi.mock('./device-channel-signal.js', () => ({
  isKnownNoSignal: vi.fn().mockReturnValue(false),
  readChannelsWithoutSignal: vi.fn().mockResolvedValue(new Map()),
}));

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);
const DEVICE = { id: 'dev-1', name: 'DVR Store', ipAddress: '10.0.0.5', httpPort: 80, rtspPort: 554, alertLevel: null, brand: 'other' };
const onRecorder = (n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({
  id: `cam-${i + 1}`, name: `Ch ${i + 1}`, status: 'active', streamPath: `cam/${i + 1}`, channelNumber: n - i,
  operationalReason: null, alertLevel: null, outageAlertedAt: null, outageIncidentAt: null, outageViaDevice: false,
  operationalStatus: 'offline', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(600), device: DEVICE, ...over,
}));
const level = [{ code: 'test', isDefault: true, config: { alertDelayMinutes: 1, incidentDelayMinutes: 1 } }];

describe('a recorder that stops answering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cameraFlapHistory.clear();
    mockPrisma.alert.findFirst.mockResolvedValue(null);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.cameraIncident.findMany.mockResolvedValue([]);
    mockPrisma.masterdata.findMany.mockResolvedValue(level);
  });

  it('raises one alert and one incident for the recorder, not one per camera', async () => {
    mockPrisma.camera.findMany.mockResolvedValueOnce(onRecorder(4));
    mockProbe.mockResolvedValue({ reachable: false });
    mockTcp.mockResolvedValue({ reachable: false });
    mockPrisma.alert.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'alert-r' });
    await checkCameraHealth();

    const critical = vi.mocked(createAlert).mock.calls.filter(([a]) => a.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0][0]).toMatchObject({ source: 'dev-1', title: 'Recorder offline: DVR Store' });
    expect(createIncident).not.toHaveBeenCalled();
    expect(addCameraToRecorderIncident).toHaveBeenCalledTimes(4);
    // The lowest channel opens it, so it stands for the recorder.
    expect(vi.mocked(addCameraToRecorderIncident).mock.calls[0][1]).toMatchObject({ channelNumber: 1 });
    const marked = mockPrisma.camera.update.mock.calls.map(([a]) => a.data).filter((d) => d.outageViaDevice);
    expect(marked).toHaveLength(4);
    expect(mockPrisma.camera.update.mock.calls.map(([a]) => a.data.operationalReason).filter(Boolean)).toContain('recorder_offline');
  });

  it('keeps raising per camera when the recorder answers and only a channel is down', async () => {
    mockPrisma.camera.findMany.mockResolvedValueOnce(onRecorder(3)).mockResolvedValueOnce([]);
    mockProbe.mockResolvedValue({ reachable: false });
    mockTcp.mockResolvedValue({ reachable: true });
    await checkCameraHealth();
    expect(addCameraToRecorderIncident).not.toHaveBeenCalled();
    expect(createIncident).toHaveBeenCalledTimes(3);
  });

  it('ends what it raised when the recorder answers, and leaves cameras still down to be raised on their own', async () => {
    const cams = onRecorder(3, { outageAlertedAt: secondsAgo(300), outageIncidentAt: secondsAgo(300), outageViaDevice: true });
    mockPrisma.camera.findMany.mockResolvedValueOnce(cams).mockResolvedValueOnce([{ id: 'cam-3', deviceId: 'dev-1' }]);
    mockProbe.mockImplementation(async (cam: { id: string }) => ({ reachable: cam.id !== 'cam-3' }));
    mockTcp.mockResolvedValue({ reachable: true });
    mockPrisma.alert.findMany.mockResolvedValue([{ id: 'alert-r', source: 'dev-1', createdAt: secondsAgo(600), details: { deviceName: 'DVR Store' } }]);
    mockPrisma.cameraIncident.findMany.mockResolvedValue([{ id: 'inc-r', openedAt: secondsAgo(600), lastReopenedAt: null }]);
    await checkCameraHealth();

    expect(mockPrisma.alert.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'alert-r' } }));
    const sent = vi.mocked(createAlert).mock.calls.map(([a]) => a);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ severity: 'info', source: 'dev-1', title: 'Recorder online: DVR Store' });
    expect(sent[0].message).toContain('1 camera(s) on it are still down');
    expect(resolveIncident).toHaveBeenCalledWith('inc-r', expect.objectContaining({ autoResolved: true }));
    expect(mockPrisma.camera.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['cam-3'] } },
      data: { outageViaDevice: false, outageAlertedAt: null, outageIncidentAt: null },
    });
  });

  it('says nothing per camera when one that went down with its recorder comes back', async () => {
    mockPrisma.camera.findMany
      .mockResolvedValueOnce(onRecorder(2, { operationalStatus: 'recovering', operationalSince: secondsAgo(70), lastPolledAt: secondsAgo(1), outageAlertedAt: secondsAgo(300), outageViaDevice: true }))
      .mockResolvedValueOnce([]);
    mockProbe.mockResolvedValue({ reachable: true });
    mockTcp.mockResolvedValue({ reachable: true });
    await checkCameraHealth();
    expect(createAlert).not.toHaveBeenCalled();
    expect(mockPrisma.camera.update.mock.calls.map(([a]) => a.data).filter((d) => d.outageViaDevice === false)).toHaveLength(2);
  });
});

describe('checkRecorders', () => {
  const cam = (id: string, device: string, over: Record<string, unknown> = {}) => ({
    id, status: 'active', streamPath: id, device: { id: device, name: device, ipAddress: '10.0.0.9', rtspPort: 554, httpPort: 80 }, ...over,
  });

  it('leaves alone a recorder with one camera, and calls one sending pictures answering', async () => {
    const probe = vi.fn().mockResolvedValue({ reachable: false });
    const result = await checkRecorders([cam('a', 'solo'), cam('b', 'live'), cam('c', 'live')], new Set(['b']), probe);
    expect(result.down.size).toBe(0);
    expect([...result.answering]).toEqual(['live']);
    expect(probe).not.toHaveBeenCalled();
  });

  it('calls it down only when neither port answers', async () => {
    const neither = vi.fn().mockResolvedValue({ reachable: false });
    expect((await checkRecorders([cam('a', 'r'), cam('b', 'r')], new Set(), neither)).down.get('r')).toMatchObject({ cameraCount: 2 });
    const httpOnly = vi.fn(async (_host: string, port: number) => ({ reachable: port === 80 }));
    expect((await checkRecorders([cam('a', 'r'), cam('b', 'r')], new Set(), httpOnly)).answering.has('r')).toBe(true);
  });

  it('does not count cameras in maintenance', async () => {
    const probe = vi.fn().mockResolvedValue({ reachable: false });
    const result = await checkRecorders([cam('a', 'r'), cam('b', 'r', { status: 'maintenance' })], new Set(), probe);
    expect(result.down.size + result.answering.size).toBe(0);
  });
});

describe('withRecorderLock', () => {
  it('runs one at a time per recorder, and carries on after a failure', async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) => () => new Promise<string>((resolve, reject) => setTimeout(() => {
      order.push(name);
      if (fail) reject(new Error(name));
      else resolve(name);
    }, ms));
    const first = withRecorderLock('r', slow('first', 30, true));
    const second = withRecorderLock('r', slow('second', 1));
    const other = withRecorderLock('x', slow('other', 1));
    await expect(first).rejects.toThrow('first');
    await expect(second).resolves.toBe('second');
    await other;
    expect(order).toEqual(['other', 'first', 'second']);
  });
});
