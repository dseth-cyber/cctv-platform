import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDiskHighWatermarkAndEvict } from './retention-sweeper.service.js';
import { createAlert } from '../alerts/alerts.service.js';

// Mock dependencies
const mockPrisma = {
  cameraRecording: {
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: () => mockPrisma,
}));

vi.mock('../alerts/alerts.service.js', () => ({
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-disk-1' }),
}));

describe('Disk High-Watermark Monitor & Emergency FIFO Eviction [ENH-03]', () => {
  const TOTAL_BYTES = 1000 * 1024 * 1024 * 1024; // 1,000 GB

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('level 70% (Normal): takes no action and generates no alerts', async () => {
    const mockStatfs = () => ({
      totalBytes: TOTAL_BYTES,
      freeBytes: TOTAL_BYTES * 0.30, // 30% free -> 70% used
      usedPercent: 70.0,
    });

    const result = await checkDiskHighWatermarkAndEvict({
      statfsProvider: mockStatfs,
    });

    expect(result.status).toBe('normal');
    expect(result.usedPercent).toBe(70.0);
    expect(result.evictedCount).toBe(0);
    expect(createAlert).not.toHaveBeenCalled();
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 86% (Warning): records warning alert and does not evict recordings', async () => {
    const mockStatfs = () => ({
      totalBytes: TOTAL_BYTES,
      freeBytes: TOTAL_BYTES * 0.14, // 14% free -> 86% used
      usedPercent: 86.0,
    });

    const result = await checkDiskHighWatermarkAndEvict({
      statfsProvider: mockStatfs,
    });

    expect(result.status).toBe('warning');
    expect(result.usedPercent).toBe(86.0);
    expect(result.evictedCount).toBe(0);

    // Verify warning alert was dispatched
    expect(createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: 'disk_space',
        severity: 'warning',
        title: expect.stringContaining('High-Watermark Warning'),
      })
    );
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 95% (Critical): triggers Emergency FIFO eviction, strictly skips legalHold: true, and stops when usage < 85%', async () => {
    const mockStatfs = () => ({
      totalBytes: TOTAL_BYTES,
      freeBytes: TOTAL_BYTES * 0.05, // 5% free -> 95% used (Target: recover 10.1% = 101 GB to drop < 85%)
      usedPercent: 95.0,
    });

    // 6 unarchived recording segments: 25GB each
    // Evicting 5 segments (125GB) will bring free space from 50GB to 175GB (17.5% free -> 82.5% used, below 85%)
    const dummyRecordings = [
      { id: 'rec-01', startTime: new Date('2026-10-01T08:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
      { id: 'rec-02', startTime: new Date('2026-10-01T09:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
      { id: 'rec-03', startTime: new Date('2026-10-01T10:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
      { id: 'rec-04', startTime: new Date('2026-10-01T11:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
      { id: 'rec-05', startTime: new Date('2026-10-01T12:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
      { id: 'rec-06', startTime: new Date('2026-10-01T13:00:00Z'), fileSizeBytes: BigInt(25 * 1024 * 1024 * 1024), filePath: null, legalHold: false, isArchived: false },
    ];

    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce(dummyRecordings);
    mockPrisma.cameraRecording.update.mockResolvedValue({});
    mockPrisma.cameraRecording.count.mockResolvedValueOnce(3); // 3 recordings preserved under legal hold

    const result = await checkDiskHighWatermarkAndEvict({
      statfsProvider: mockStatfs,
    });

    expect(result.status).toBe('emergency_eviction_completed');
    expect(createAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertType: 'disk_space',
        severity: 'critical',
        title: expect.stringContaining('Emergency FIFO Eviction'),
      })
    );

    // Verify candidate query strictly queried legalHold: false in FIFO order (startTime: asc)
    expect(mockPrisma.cameraRecording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ legalHold: false, isArchived: false }),
        orderBy: { startTime: 'asc' },
      })
    );

    // 5 segments (125 GB) evicted brought usage from 95% down to 82.5% (< 85%), rec-06 was not needed
    expect(result.evictedCount).toBe(5);
    expect(result.usedPercent).toBeLessThan(85.0);
    expect(result.skippedLegalHold).toBe(3);
    expect(mockPrisma.cameraRecording.update).toHaveBeenCalledTimes(5);
  });
});
