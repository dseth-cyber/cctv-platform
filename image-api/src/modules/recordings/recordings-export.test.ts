import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingsService } from './recordings.service.js';
import { getPrisma } from '../../lib/prisma.js';
import path from 'node:path';

describe('Recordings Export & Download Service [AUDIT-CRIT-03]', () => {
  beforeEach(() => {
    vi.mocked(getPrisma).mockReturnValue({
      cameraRecording: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      recordingClip: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'test-clip-id-1234',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({
          id: where.id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
    } as any);
  });
  it('should validate clip filename and prevent path traversal', () => {
    // Malicious inputs should throw or return invalid
    expect(() => RecordingsService.getClipFilePath('../../../etc/passwd')).toThrow();
    expect(() => RecordingsService.getClipFilePath('..\\..\\windows\\win.ini')).toThrow();
    expect(() => RecordingsService.getClipFilePath('clip/sub/file.mp4')).toThrow();
  });

  it('should resolve safe filename within clips directory', () => {
    const safeName = 'clip_12345678_2026-10-27.mp4';
    const result = RecordingsService.getClipFilePath(safeName);
    expect(result.filename).toBe(safeName);
    expect(path.isAbsolute(result.fullPath)).toBe(true);
    expect(result.fullPath).toContain('clips');
  });

  it('should mark the clip FAILED instead of fabricating a file when no recording exists', async () => {
    const prisma = getPrisma() as any;
    const mockCameraId = '00000000-0000-0000-0000-000000000001';

    await expect(
      RecordingsService.exportClip({
        cameraId: mockCameraId,
        title: 'Audit Test Event Clip',
        startTime: new Date(Date.now() - 120000).toISOString(),
        endTime: new Date().toISOString(),
        preBufferSeconds: 15,
        postBufferSeconds: 15,
        exportedBy: 'auditor',
      }),
    ).rejects.toThrow('No recorded video found');

    expect(prisma.recordingClip.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(prisma.recordingClip.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });
});
