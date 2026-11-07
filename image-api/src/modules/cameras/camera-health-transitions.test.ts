import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cameraFlapHistory, checkCameraHealth, computeDowntimeMs } from './camera-health-monitor.js';
import { createAlert } from '../alerts/alerts.service.js';
import { createIncident, reopenRecentIncident } from './camera-incident.service.js';

const mockPrisma = {
  camera: { findMany: vi.fn(), update: vi.fn() },
  cameraEvent: { create: vi.fn() },
  alert: { findFirst: vi.fn(), update: vi.fn() },
  masterdata: { findMany: vi.fn() },
};
const level = (alertDelayMinutes: number | null, incidentDelayMinutes: number | null) => [{ code: 'test', isDefault: true, config: { alertDelayMinutes, incidentDelayMinutes } }];
const mockProbe = vi.fn();

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn().mockResolvedValue({
    camera_offline_threshold_minutes: { value: 2 },
    camera_recovery_grace_minutes: { value: 1 },
    camera_auto_incident_enabled: { value: true },
    camera_incident_reopen_minutes: { value: 30 },
  }),
}));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({ id: 'alert-1' }) }));
vi.mock('./camera-incident.service.js', () => ({
  getOpenIncidentForCamera: vi.fn().mockResolvedValue(null),
  reopenRecentIncident: vi.fn().mockResolvedValue(null),
  createIncident: vi.fn().mockResolvedValue({ id: 'inc-1', incidentNumber: 'INC-1' }),
}));
vi.mock('./camera-probe.service.js', () => ({
  NO_PROBE_TARGET: 'No probe target configured',
  probeCameraHealth: (...args: unknown[]) => mockProbe(...args),
}));
vi.mock('../media/mediamtx.service.js', () => ({ MediaMtxService: { getLivePaths: vi.fn().mockResolvedValue([]) } }));
vi.mock('./device-channel-signal.js', () => ({
  isKnownNoSignal: vi.fn().mockReturnValue(false),
  readChannelsWithoutSignal: vi.fn().mockResolvedValue(new Map()),
}));

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

function camera(over: Record<string, unknown>) {
  return {
    id: 'cam-1',
    name: 'Cam 1',
    status: 'active',
    streamPath: 'cam/one',
    channelNumber: null,
    operationalReason: null,
    device: null,
    ...over,
  };
}

const statusWrites = () => mockPrisma.camera.update.mock.calls
  .map(([arg]) => arg.data.operationalStatus)
  .filter(Boolean);

describe('Camera health transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cameraFlapHistory.clear();
    mockPrisma.alert.findFirst.mockResolvedValue(null);
    mockPrisma.masterdata.findMany.mockResolvedValue(level(2, 2));
    vi.mocked(reopenRecentIncident).mockResolvedValue(null);
  });

  it('keeps a camera the webhook marked offline down while it still does not answer', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'offline', operationalSince: secondsAgo(30), lastPolledAt: secondsAgo(45) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual([]);
    expect(mockPrisma.cameraEvent.create).not.toHaveBeenCalled();
  });

  it('sends a recovering camera back offline when it stops answering, even inside the threshold', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'recovering', operationalSince: secondsAgo(30), lastPolledAt: secondsAgo(30) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual(['offline']);
  });

  it('waits for the threshold before calling an online camera offline', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(60) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual([]);
  });

  it('calls it offline and raises a critical alert once the threshold has passed', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(121) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual(['offline']);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('confirms recovery on the next tick even if it arrives slightly under a minute later', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'recovering', operationalSince: secondsAgo(59.9), lastPolledAt: secondsAgo(1) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: true, latencyMs: 2 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual(['online']);
  });

  it('never treats an info alert as the open outage, so a later outage still alerts', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(121) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    await checkCameraHealth();
    expect(mockPrisma.alert.findFirst.mock.calls[0][0].where.severity).toEqual({ not: 'info' });
  });

  it('says nothing about coming back when nobody was told about the drop', async () => {
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'recovering', operationalSince: secondsAgo(70), lastPolledAt: secondsAgo(1), outageAlertedAt: null }),
    ]);
    mockProbe.mockResolvedValue({ reachable: true, latencyMs: 2 });
    await checkCameraHealth();
    expect(statusWrites()).toEqual(['online']);
    expect(createAlert).not.toHaveBeenCalled();
  });

  describe('alert levels', () => {
    const stillDown = (over: Record<string, unknown>) => {
      mockPrisma.camera.findMany.mockResolvedValue([camera({ operationalStatus: 'offline', outageAlertedAt: null, outageIncidentAt: null, ...over })]);
      mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
    };
    const handledWrites = () => mockPrisma.camera.update.mock.calls.map(([arg]) => arg.data).filter((d) => d.outageAlertedAt || d.outageIncidentAt);

    it('raises nothing before the delay is over', async () => {
      mockPrisma.masterdata.findMany.mockResolvedValue(level(5, 15));
      stillDown({ operationalSince: secondsAgo(120), lastPolledAt: secondsAgo(200) });
      await checkCameraHealth();
      expect(createAlert).not.toHaveBeenCalled();
      expect(createIncident).not.toHaveBeenCalled();
    });

    it('alerts when the alert delay ends and keeps the incident for its own delay', async () => {
      mockPrisma.masterdata.findMany.mockResolvedValue(level(5, 15));
      stillDown({ operationalSince: secondsAgo(200), lastPolledAt: secondsAgo(310) });
      await checkCameraHealth();
      expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
      expect(createIncident).not.toHaveBeenCalled();
      expect(handledWrites()[0]).toHaveProperty('outageAlertedAt');
    });

    it('opens the incident when its delay ends', async () => {
      mockPrisma.masterdata.findMany.mockResolvedValue(level(5, 15));
      stillDown({ operationalSince: secondsAgo(800), lastPolledAt: secondsAgo(910), outageAlertedAt: secondsAgo(600) });
      await checkCameraHealth();
      expect(createAlert).not.toHaveBeenCalled();
      expect(createIncident).toHaveBeenCalledTimes(1);
    });

    it('raises each thing once per outage, even after a person has cleared it', async () => {
      stillDown({ operationalSince: secondsAgo(4000), lastPolledAt: secondsAgo(4000), outageAlertedAt: secondsAgo(3000), outageIncidentAt: secondsAgo(3000) });
      await checkCameraHealth();
      expect(createAlert).not.toHaveBeenCalled();
      expect(createIncident).not.toHaveBeenCalled();
    });

    it('raises nothing at all on a no-alert level, while the status stays true', async () => {
      mockPrisma.masterdata.findMany.mockResolvedValue(level(null, null));
      mockPrisma.camera.findMany.mockResolvedValue([camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(121) })]);
      mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
      await checkCameraHealth();
      expect(statusWrites()).toEqual(['offline']);
      expect(createAlert).not.toHaveBeenCalled();
      expect(createIncident).not.toHaveBeenCalled();
    });

    it('calls a camera on a fast level offline sooner than the system threshold', async () => {
      mockPrisma.masterdata.findMany.mockResolvedValue(level(1, 0));
      mockPrisma.camera.findMany.mockResolvedValue([camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(65) })]);
      mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
      await checkCameraHealth();
      expect(statusWrites()).toEqual(['offline']);
      expect(createAlert).toHaveBeenCalledTimes(1);
      expect(createIncident).toHaveBeenCalledTimes(1);
    });

    it('carries on with the incident that just closed itself instead of opening another', async () => {
      vi.mocked(reopenRecentIncident).mockResolvedValue({ id: 'inc-0', incidentNumber: 'INC-0', reopenCount: 1 } as any);
      stillDown({ operationalSince: secondsAgo(200), lastPolledAt: secondsAgo(200) });
      await checkCameraHealth();
      expect(reopenRecentIncident).toHaveBeenCalledWith('cam-1', 30);
      expect(createIncident).not.toHaveBeenCalled();
      expect(mockPrisma.cameraEvent.create).toHaveBeenCalledTimes(1);
    });

    it('starts a new outage from online, but not from falling back while recovering', async () => {
      mockProbe.mockResolvedValue({ reachable: false, latencyMs: 3000 });
      mockPrisma.camera.findMany.mockResolvedValue([camera({ operationalStatus: 'online', operationalSince: secondsAgo(600), lastPolledAt: secondsAgo(30), status: 'error', outageAlertedAt: secondsAgo(900) })]);
      await checkCameraHealth();
      expect(mockPrisma.camera.update.mock.calls.map(([arg]) => arg.data).find((d) => d.operationalStatus === 'offline')).toMatchObject({ outageAlertedAt: null, outageIncidentAt: null });

      vi.clearAllMocks();
      mockPrisma.masterdata.findMany.mockResolvedValue(level(2, 2));
      mockPrisma.alert.findFirst.mockResolvedValue(null);
      mockPrisma.camera.findMany.mockResolvedValue([camera({ operationalStatus: 'recovering', operationalSince: secondsAgo(30), lastPolledAt: secondsAgo(30), outageAlertedAt: secondsAgo(900) })]);
      await checkCameraHealth();
      expect(mockPrisma.camera.update.mock.calls.map(([arg]) => arg.data).find((d) => d.operationalStatus === 'offline')).not.toHaveProperty('outageAlertedAt');
      expect(createAlert).not.toHaveBeenCalled();
    });
  });

  it('reports the back-online notice even when an earlier notice is still open', async () => {
    mockPrisma.alert.findFirst.mockResolvedValue({ id: 'alert-0', createdAt: secondsAgo(300), details: {} });
    mockPrisma.camera.findMany.mockResolvedValue([
      camera({ operationalStatus: 'recovering', operationalSince: secondsAgo(70), lastPolledAt: secondsAgo(1) }),
    ]);
    mockProbe.mockResolvedValue({ reachable: true, latencyMs: 2 });
    await checkCameraHealth();
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', skipDedup: true, closeOnCreate: true }));
  });
});

describe('computeDowntimeMs', () => {
  it('measures from the last answer to the first answer again', () => {
    const ms = computeDowntimeMs(
      { createdAt: '2026-11-07T01:05:03Z', details: { lastPolledAt: '2026-11-07T01:00:00Z' } },
      '2026-11-07T01:10:00Z',
    );
    expect(ms).toBe(10 * 60 * 1000);
  });

  it('falls back to when the alert was raised for older alerts', () => {
    const ms = computeDowntimeMs({ createdAt: '2026-11-07T01:05:00Z', details: {} }, '2026-11-07T01:10:00Z');
    expect(ms).toBe(5 * 60 * 1000);
  });
});
