import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingsService } from './recordings.service.js';
import { getPrisma } from '../../lib/prisma.js';

vi.mock('../../lib/prisma.js', () => {
  const mPrisma = {
    camera: {
      findUnique: vi.fn(),
    },
    cameraRecording: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    cameraIncident: {
      findMany: vi.fn(),
    },
  };
  return { getPrisma: () => mPrisma };
});

describe('Recordings Timeline Synthetic Data Guard [AUDIT-MED-04]', () => {
  const prisma = getPrisma() as any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SEED_SYNTHETIC_RECORDINGS;
  });

  it('returns an empty timeline and does NOT seed fake records when no recordings exist', async () => {
    prisma.camera.findUnique.mockResolvedValue({
      id: 'cam-real-001',
      name: 'Main Entrance Gate',
      timezone: 'Asia/Bangkok',
      streamPath: 'live/cam_real_001',
    });

    prisma.cameraRecording.findMany.mockResolvedValue([]);
    prisma.cameraIncident.findMany.mockResolvedValue([]);

    const timeline = await RecordingsService.getTimelineAvailability('cam-real-001', '2026-10-27');

    expect(timeline.segmentsCount).toBe(0);
    expect(timeline.segments).toEqual([]);
    expect(timeline.continuousBlocks).toEqual([]);
    expect(timeline.gaps).toEqual([]);
    expect(timeline.totalRecordedSeconds).toBe(0);
    expect(timeline.totalRecordedBytes).toBe(0);

    // Assert that createMany was never called (no fake records seeded)
    expect(prisma.cameraRecording.createMany).not.toHaveBeenCalled();
  });

  it('seeds dev records only when SEED_SYNTHETIC_RECORDINGS=true is explicitly set', async () => {
    process.env.SEED_SYNTHETIC_RECORDINGS = 'true';

    prisma.camera.findUnique.mockResolvedValue({
      id: 'cam-dev-001',
      name: 'Dev Camera',
      timezone: 'Asia/Bangkok',
      streamPath: 'live/cam_dev_001',
    });

    // First findMany returns empty, second findMany returns seeded segments
    prisma.cameraRecording.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'rec-1',
          startTime: new Date('2026-10-27T08:00:00.000Z'),
          endTime: new Date('2026-10-27T08:01:00.000Z'),
          durationSeconds: 60,
          hasIncident: false,
          legalHold: false,
          format: 'fmp4',
          fileSizeBytes: BigInt(15000000),
        },
      ]);
    prisma.cameraIncident.findMany.mockResolvedValue([]);
    prisma.cameraRecording.createMany.mockResolvedValue({ count: 1 });

    const timeline = await RecordingsService.getTimelineAvailability('cam-dev-001', '2026-10-27');

    expect(prisma.cameraRecording.createMany).toHaveBeenCalled();
    expect(timeline.segmentsCount).toBe(1);
  });
});
