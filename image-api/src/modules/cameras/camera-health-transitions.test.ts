import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cameraFlapHistory, checkCameraHealth, computeDowntimeMs } from './camera-health-monitor.js';
import { createAlert } from '../alerts/alerts.service.js';

const mockPrisma = {
  camera: { findMany: vi.fn(), update: vi.fn() },
  cameraEvent: { create: vi.fn() },
  alert: { findFirst: vi.fn(), update: vi.fn() },
};
const mockProbe = vi.fn();

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn().mockResolvedValue({
    camera_offline_threshold_minutes: { value: 2 },
    camera_recovery_grace_minutes: { value: 1 },
  }),
}));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({ id: 'alert-1' }) }));
vi.mock('./camera-incident.service.js', () => ({ getOpenIncidentForCamera: vi.fn().mockResolvedValue(null) }));
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

  it('reports the back-online notice even when an earlier notice is still open', async () => {
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
