import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAlert } from './alerts.service.js';

const mockPrisma = {
  alert: { findFirst: vi.fn(), create: vi.fn() },
  alertRule: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));

describe('createAlert dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.alert.create.mockResolvedValue({ id: 'new' });
  });

  it('only treats an open alert of the same severity as a duplicate', async () => {
    mockPrisma.alert.findFirst.mockResolvedValue(null);
    await createAlert({ alertType: 'camera_offline', severity: 'critical', source: 'cam-1', title: 't', message: 'm' });
    expect(mockPrisma.alert.findFirst.mock.calls[0][0].where).toMatchObject({ source: 'cam-1', severity: 'critical', resolvedAt: null });
    expect(mockPrisma.alert.create).toHaveBeenCalledTimes(1);
  });

  it('returns the open alert instead of repeating it', async () => {
    mockPrisma.alert.findFirst.mockResolvedValue({ id: 'open' });
    const alert = await createAlert({ alertType: 'camera_offline', severity: 'critical', source: 'cam-1', title: 't', message: 'm' });
    expect(alert).toEqual({ id: 'open' });
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });
});
