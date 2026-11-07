import { defaultExportQueue } from './export-queue.js';
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

  it('should refuse the export (no clip, no file) when no recording exists in the window', async () => {
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
    ).rejects.toThrow('No recorded video exists');

    expect(prisma.recordingClip.create).not.toHaveBeenCalled();
    expect(prisma.recordingClip.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });

  it('gives two clips of the same moment separate files', async () => {
    const prisma = getPrisma() as any;
    const start = new Date(Date.now() - 120000);
    const end = new Date();
    prisma.cameraRecording.findMany.mockResolvedValue([{ id: 'seg', startTime: new Date(start.getTime() - 60000), endTime: new Date(end.getTime() + 60000), fileSizeBytes: BigInt(1000), filePath: '/tmp/seg.mp4' }]);
    const enqueue = vi.spyOn(defaultExportQueue, 'enqueue').mockResolvedValue({});
    const dto = { cameraId: '00000000-0000-0000-0000-000000000001', title: 'same', startTime: start.toISOString(), endTime: end.toISOString(), preBufferSeconds: 0, postBufferSeconds: 0, exportedBy: 'auditor' };

    await RecordingsService.exportClip(dto, { asyncProcess: true });
    await RecordingsService.exportClip(dto, { asyncProcess: true });

    const [first, second] = prisma.recordingClip.create.mock.calls.map(([arg]: any) => arg.data.filePath);
    expect(first).not.toBe(second);
    expect(enqueue.mock.calls[0][0].fullDiskPath).not.toBe(enqueue.mock.calls[1][0].fullDiskPath);
    enqueue.mockRestore();
  });

  it('should reject an end before the start and windows longer than the limit', async () => {
    const t0 = Date.parse('2026-10-31T00:00:00Z');
    const base = { cameraId: 'cam', title: 'x', preBufferSeconds: 0, postBufferSeconds: 0 };
    await expect(
      RecordingsService.exportClip({ ...base, startTime: new Date(t0).toISOString(), endTime: new Date(t0 - 1000).toISOString() }),
    ).rejects.toThrow('must be after its start');
    await expect(
      RecordingsService.exportClip({ ...base, startTime: new Date(t0).toISOString(), endTime: new Date(t0 + 25 * 3600_000).toISOString() }),
    ).rejects.toThrow('at most 24 hours');
  });

  it('should report recorded time, gaps and size for a window', async () => {
    const prisma = getPrisma() as any;
    const t0 = Date.parse('2026-10-31T01:00:00Z');
    const seg = (startMin: number) => ({
      startTime: new Date(t0 + startMin * 60_000),
      endTime: new Date(t0 + (startMin + 1) * 60_000),
      durationSeconds: 60,
      fileSizeBytes: BigInt(6_000_000),
    });
    prisma.cameraRecording.findMany.mockResolvedValueOnce([seg(0), seg(1), seg(5)]);

    const cov = await RecordingsService.getCoverage('cam', new Date(t0 + 30_000), new Date(t0 + 6 * 60_000));

    expect(cov.windowSeconds).toBe(330);
    expect(cov.recordedSeconds).toBe(150); // 30 + 60 + 60
    expect(cov.estimatedBytes).toBe(15_000_000);
    expect(cov.gaps).toEqual([{ start: '2026-10-31T01:02:00.000Z', end: '2026-10-31T01:05:00.000Z', seconds: 180 }]);
  });

  it('should only accept download links signed for that file and not expired', () => {
    const token = RecordingsService.createDownloadToken('clip_a.mp4', 'admin');
    expect(RecordingsService.verifyDownloadToken('clip_a.mp4', token)).toBe('admin');
    expect(RecordingsService.verifyDownloadToken('clip_b.mp4', token)).toBeNull();
    expect(RecordingsService.verifyDownloadToken('clip_a.mp4', token.replace(/.$/, (c) => (c === 'x' ? 'y' : 'x')))).toBeNull();
    expect(RecordingsService.verifyDownloadToken('clip_a.mp4', RecordingsService.createDownloadToken('clip_a.mp4', 'admin', -1))).toBeNull();
  });
});
