import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCameraDowntimeReport, statusWithoutEvents } from './camera-analytics.service.js';

const mockPrisma = {
  camera: { findUnique: vi.fn() },
  cameraEvent: { findMany: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../system-config/system-config.service.js', () => ({ getAllConfigs: vi.fn().mockResolvedValue({ camera_sla_target: { value: 99.5 } }) }));

describe('statusWithoutEvents', () => {
  it('takes the camera as it is now', () => {
    expect(statusWithoutEvents({ status: 'active', operationalStatus: 'offline' })).toBe('offline');
    expect(statusWithoutEvents({ status: 'maintenance', operationalStatus: 'offline' })).toBe('maintenance');
    expect(statusWithoutEvents({ status: 'active', operationalStatus: 'online' })).toBe('active');
    expect(statusWithoutEvents({ status: 'active', operationalStatus: 'unknown' })).toBe('active');
    expect(statusWithoutEvents(null)).toBe('active');
  });
});

describe('availability of a camera with no event in the period', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.cameraEvent.findMany.mockResolvedValue([]);
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
  });

  it('is 0% for one offline since it was added (it was reported as 100%)', async () => {
    mockPrisma.camera.findUnique.mockResolvedValue({ createdAt: new Date(Date.now() - 3 * 3600_000), slaTargetPercent: null, status: 'active', operationalStatus: 'offline' });
    const r = await getCameraDowntimeReport('cam-1', '30d');
    expect(r.availability).toBe(0);
    expect(r.slaMet).toBe(false);
  });

  it('is still 100% for one online throughout', async () => {
    mockPrisma.camera.findUnique.mockResolvedValue({ createdAt: new Date(Date.now() - 3 * 3600_000), slaTargetPercent: null, status: 'active', operationalStatus: 'online' });
    expect((await getCameraDowntimeReport('cam-2', '30d')).availability).toBe(100);
  });
});
