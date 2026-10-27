import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingsService } from './recordings.service.js';
import { getPrisma } from '../../lib/prisma.js';
import fs from 'node:fs';
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

  it('should export clip with real SHA-256 hash, physical file, and chain of custody', async () => {
    // Mock prisma client for test
    const mockCameraId = '00000000-0000-0000-0000-000000000001';
    const testStartTime = new Date(Date.now() - 120000).toISOString();
    const testEndTime = new Date().toISOString();

    const result = await RecordingsService.exportClip({
      cameraId: mockCameraId,
      title: 'Audit Test Event Clip',
      startTime: testStartTime,
      endTime: testEndTime,
      preBufferSeconds: 15,
      postBufferSeconds: 15,
      exportedBy: 'auditor',
    });

    expect(result).toBeDefined();
    expect(result.sha256Hash).toBeDefined();
    expect(result.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.chainOfCustody).toBeDefined();
    expect(Array.isArray(result.chainOfCustody)).toBe(true);
    expect((result.chainOfCustody as any[])[0].action).toBe('export');
    expect((result.chainOfCustody as any[])[0].performedBy).toBe('auditor');
    expect((result.chainOfCustody as any[])[0].sha256).toBe(result.sha256Hash);

    // Verify physical file was written to disk
    const clipFilename = path.basename(result.downloadUrl!);
    const clipInfo = RecordingsService.getClipFilePath(clipFilename);
    expect(clipInfo.exists).toBe(true);

    // Verify hash matches actual file content
    const fileBytes = fs.readFileSync(clipInfo.fullPath);
    const expectedHash = (await import('node:crypto')).createHash('sha256').update(fileBytes).digest('hex');
    expect(result.sha256Hash).toBe(expectedHash);
  });
});
