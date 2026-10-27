import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mediaAuthRoutes } from './media-auth.controller.js';
import { cameraFlapHistory } from '../cameras/camera-health-monitor.js';

// Mock dependencies
const mockPrisma = {
  camera: {
    findFirst: vi.fn(),
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

vi.mock('../alerts/alerts.service.js', () => ({
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-123' }),
  dispatchAlertNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../cameras/camera-incident.service.js', () => ({
  getOpenIncidentForCamera: vi.fn().mockResolvedValue(null),
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

  describe('Real-time State Transitions & Flapping Suppression', () => {
    const mockCamera = {
      id: 'cam-uuid-001',
      name: 'Gate 1 Camera',
      streamPath: 'camera_gate1',
      status: 'active',
      operationalStatus: 'online',
      operationalSince: new Date(Date.now() - 3600000),
    };

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
