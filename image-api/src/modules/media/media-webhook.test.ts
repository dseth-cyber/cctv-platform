import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mediaAuthRoutes } from './media-auth.controller.js';
import { cameraFlapHistory } from '../cameras/camera-health-monitor.js';
import { config } from '../../config/index.js';

// Mock dependencies
const mockPrisma = {
  camera: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  cameraEvent: {
    create: vi.fn(),
  },
  alert: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  cameraIncident: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  // Delays of zero: these tests are about the stream event, not about waiting.
  masterdata: { findMany: vi.fn().mockResolvedValue([{ code: 'test', isDefault: true, config: { alertDelayMinutes: 0, incidentDelayMinutes: 0 } }]) },
  device: { findUnique: vi.fn().mockResolvedValue(null) },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: () => mockPrisma,
}));

vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn().mockResolvedValue({
    camera_auto_incident_enabled: { value: true },
    camera_auto_resolve_enabled: { value: true },
    camera_recovery_grace_minutes: { value: 1 },
  }),
}));

const mockNoSignal = vi.hoisted(() => vi.fn().mockReturnValue(false));
vi.mock('../cameras/device-channel-signal.js', () => ({
  isKnownNoSignal: mockNoSignal,
  readChannelsWithoutSignal: vi.fn().mockResolvedValue(new Map()),
}));

const mockProbe = vi.fn();
vi.mock('../cameras/camera-probe.service.js', () => ({
  NO_PROBE_TARGET: 'No probe target configured',
  probeCameraHealth: (...args: unknown[]) => mockProbe(...args),
}));

vi.mock('../alerts/alerts.service.js', () => ({
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-123' }),
  dispatchAlertNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../cameras/camera-incident.service.js', () => ({
  getOpenIncidentForCamera: vi.fn().mockResolvedValue(null),
  reopenRecentIncident: vi.fn().mockResolvedValue(null),
  createIncident: vi.fn().mockResolvedValue({ id: 'inc-123', incidentNumber: 'INC-TEST-01' }),
  resolveIncident: vi.fn().mockResolvedValue({ id: 'inc-123', status: 'resolved' }),
}));

describe('Real-time Camera Health Webhook [ENH-01]', () => {
  let app: any;
  const SECRET = 'cctv-media-webhook-secret-dev';

  beforeEach(async () => {
    vi.clearAllMocks();
    cameraFlapHistory.clear();
    app = Fastify();
    await app.register(mediaAuthRoutes, { prefix: '/api/v1/media' });
  });

  describe('Security & Header Verification', () => {
    it('returns 401 when x-media-webhook-secret header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        payload: { path: 'camera_123', status: 'ready' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual(
        expect.objectContaining({ error: expect.stringContaining('Unauthorized') })
      );
    });

    it('returns 401 when x-media-webhook-secret header is incorrect', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': 'wrong-secret' },
        payload: { path: 'camera_123', status: 'ready' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when payload is missing path or status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_123' }, // missing status
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('Publish authorization [R1.3]', () => {
    const publish = (ip: string, path = 'camera_gate1') =>
      app.inject({ method: 'POST', url: '/api/v1/media/auth', payload: { action: 'publish', path, ip } });

    it('allows publishing from inside the MediaMTX container (loopback)', async () => {
      expect((await publish('127.0.0.1')).statusCode).toBe(200);
      expect((await publish('::1', 'sim/ch1')).statusCode).toBe(200);
    });

    it('rejects publishing from any other address, including sim/ paths', async () => {
      expect((await publish('172.18.0.5')).statusCode).toBe(401);
      expect((await publish('192.168.1.50', 'sim/ch1')).statusCode).toBe(401);
      expect((await publish('')).statusCode).toBe(401);
    });
  });

  describe('Segment complete webhook [R3.1]', () => {
    const post = (payload: object, secret?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/media/events/segment-complete',
        headers: secret ? { 'x-media-webhook-secret': secret } : {},
        payload,
      });

    it('rejects calls without the webhook secret', async () => {
      expect((await post({ path: 'cam1', segmentPath: './recordings/cam1/2026-10-31_01-00-00.mp4' })).statusCode).toBe(401);
    });

    it('rejects segment paths outside the recordings directory', async () => {
      const res = await post({ path: 'cam1', segmentPath: './recordings/../../etc/2026-10-31_01-00-00.mp4' }, config.mediamtx.webhookSecret);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Control API authorization', () => {
    const api = (user?: string, password?: string, action = 'api') =>
      app.inject({ method: 'POST', url: '/api/v1/media/auth', payload: { action, user, password, ip: '172.18.0.9' } });

    it('allows image-api with the shared secret', async () => {
      expect((await api('image-api', config.mediamtx.webhookSecret)).statusCode).toBe(200);
    });

    it('rejects the control API without the right credentials', async () => {
      expect((await api()).statusCode).toBe(401);
      expect((await api('image-api', 'wrong')).statusCode).toBe(401);
      expect((await api('someone', config.mediamtx.webhookSecret)).statusCode).toBe(401);
      expect((await api(undefined, undefined, 'metrics')).statusCode).toBe(401);
    });
  });

  describe('Real-time State Transitions & Flapping Suppression', () => {
    const mockCamera = {
      id: 'cam-uuid-001',
      name: 'Gate 1 Camera',
      streamPath: 'camera_gate1',
      status: 'active',
      operationalStatus: 'online',
      operationalSince: new Date(Date.now() - 3600000),
      recordingMode: 'continuous',
    };

    it('updates a camera mapped to a sim/ test stream instead of only acknowledging it', async () => {
      mockPrisma.camera.findFirst.mockResolvedValueOnce({ ...mockCamera, streamPath: 'sim/ch1' });
      mockPrisma.camera.update.mockResolvedValueOnce({ ...mockCamera, operationalStatus: 'offline' });
      mockPrisma.cameraEvent.create.mockResolvedValueOnce({ id: 2 });
      mockPrisma.alert.findFirst.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'sim/ch1', status: 'not_ready' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).not.toMatch(/Simulated/);
      // The non-uuid path must not be used as an id (the uuid column would make Prisma throw).
      const calls = mockPrisma.camera.findFirst.mock.calls;
      const where = calls[calls.length - 1][0].where;
      expect(where.OR).toEqual([{ streamPath: 'sim/ch1' }, { streamPath: 'sim/ch1' }]);
    });

    it('marks an on-demand camera offline when its stream closes and it stopped answering', async () => {
      mockPrisma.camera.findFirst.mockResolvedValueOnce({ ...mockCamera, lastPolledAt: new Date('2026-11-07T01:00:00Z') });
      mockPrisma.camera.findUnique.mockResolvedValueOnce({ id: mockCamera.id, name: mockCamera.name });
      mockPrisma.alert.findFirst.mockResolvedValueOnce(null);
      mockProbe.mockResolvedValueOnce({ reachable: false, latencyMs: 3000, reason: 'Connection timed out' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1_sub', status: 'not_ready' },
      });
      expect(res.json()).toMatchObject({ success: true, status: 'offline' });
      expect(mockPrisma.camera.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ operationalStatus: 'offline' }),
      }));
      const { createAlert } = await import('../alerts/alerts.service.js');
      expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'critical',
        details: expect.objectContaining({ lastPolledAt: expect.any(Date) }),
      }));
    });

    it('does not call a camera with nothing to probe offline when its stream closes', async () => {
      mockPrisma.camera.findFirst.mockResolvedValueOnce(mockCamera);
      mockPrisma.camera.findUnique.mockResolvedValueOnce({ id: mockCamera.id, name: mockCamera.name });
      mockProbe.mockResolvedValueOnce({ reachable: false, latencyMs: 0, reason: 'No probe target configured' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1_sub', status: 'not_ready' },
      });
      expect(res.json()).toMatchObject({ message: expect.stringMatching(/no viewers/) });
      expect(mockPrisma.camera.update).not.toHaveBeenCalled();
    });

    it('does not probe or repeat the outage for a camera already offline', async () => {
      mockPrisma.camera.findFirst.mockResolvedValueOnce({ ...mockCamera, operationalStatus: 'offline' });
      await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1_sub', status: 'not_ready' },
      });
      expect(mockProbe).not.toHaveBeenCalled();
      expect(mockPrisma.camera.update).not.toHaveBeenCalled();
    });

    it('ignores not_ready from on-demand streams while the camera still answers (the last viewer left)', async () => {
      for (const [cam, path] of [[{ ...mockCamera, recordingMode: 'live_only' }, 'camera_gate1'], [mockCamera, 'camera_gate1_sub']] as const) {
        mockPrisma.camera.findFirst.mockResolvedValueOnce(cam);
        mockPrisma.camera.findUnique.mockResolvedValueOnce({ id: cam.id, name: cam.name });
        mockProbe.mockResolvedValueOnce({ reachable: true, latencyMs: 2 });
        mockPrisma.camera.update.mockClear();
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/media/events/stream-status',
          headers: { 'x-media-webhook-secret': SECRET },
          payload: { path, status: 'not_ready' },
        });
        expect(res.json()).toMatchObject({ success: true, status: 'online', message: expect.stringMatching(/no viewers/) });
        expect(mockPrisma.camera.update).not.toHaveBeenCalled();
      }
    });

    it('transitions camera to OFFLINE instantly when status is not_ready', async () => {
      mockPrisma.camera.findFirst.mockResolvedValueOnce(mockCamera);
      mockPrisma.camera.update.mockResolvedValueOnce({
        ...mockCamera,
        operationalStatus: 'offline',
      });
      mockPrisma.cameraEvent.create.mockResolvedValueOnce({ id: 1 });
      mockPrisma.alert.findFirst.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1', status: 'not_ready' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.status).toBe('offline');
      expect(data.cameraId).toBe(mockCamera.id);

      // Verify immediate database state mutation
      expect(mockPrisma.camera.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCamera.id },
          data: expect.objectContaining({ operationalStatus: 'offline' }),
        })
      );
      expect(mockPrisma.cameraEvent.create).toHaveBeenCalled();
    });

    it('enforces anti-flapping suppression when camera drops repeatedly within window', async () => {
      // Simulate 2 previous flaps for this camera
      cameraFlapHistory.set(mockCamera.id, [Date.now() - 60000, Date.now() - 30000]);

      mockPrisma.camera.findFirst.mockResolvedValueOnce(mockCamera);
      mockPrisma.camera.update.mockResolvedValueOnce({
        ...mockCamera,
        operationalStatus: 'offline',
      });
      mockPrisma.cameraEvent.create.mockResolvedValueOnce({ id: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1', status: 'not_ready' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.status).toBe('flapping_throttled');
    });

    it('keeps a no-signal channel offline when someone opens its NO VIDEO stream', async () => {
      mockNoSignal.mockReturnValueOnce(true);
      mockPrisma.camera.findFirst.mockResolvedValueOnce({ ...mockCamera, operationalStatus: 'offline', deviceId: 'dev-1', channelNumber: 2 });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1_sub', status: 'ready' },
      });
      expect(res.json()).toMatchObject({ success: true, status: 'offline' });
      expect(mockPrisma.camera.update).not.toHaveBeenCalled();
    });

    it('moves offline camera to RECOVERING state when stream is restored', async () => {
      const offlineCam = {
        ...mockCamera,
        operationalStatus: 'offline',
      };
      mockPrisma.camera.findFirst.mockResolvedValueOnce(offlineCam);
      mockPrisma.camera.update.mockResolvedValueOnce({
        ...offlineCam,
        operationalStatus: 'recovering',
      });
      mockPrisma.cameraEvent.create.mockResolvedValueOnce({ id: 3 });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/media/events/stream-status',
        headers: { 'x-media-webhook-secret': SECRET },
        payload: { path: 'camera_gate1', status: 'ready' },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.success).toBe(true);
      expect(data.status).toBe('recovering');
      expect(mockPrisma.camera.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ operationalStatus: 'recovering' }),
        })
      );
    });
  });
});
