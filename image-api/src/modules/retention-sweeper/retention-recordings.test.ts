import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweepExpiredRecordings } from './retention-sweeper.service.js';
import { getPrisma } from '../../lib/prisma.js';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

describe('Recording Retention Sweeper & Legal Hold [AUDIT-CRIT-04]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not contain unmanaged recordDeleteAfter in mediamtx.yml', () => {
    const configPath = path.resolve(__dirname, '../../../../mediamtx/mediamtx.yml');
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(content);
    // Unmanaged recordDeleteAfter deletes files regardless of legalHold flag in DB
    expect(parsed.recordDeleteAfter).toBeUndefined();
  });

  it('should delete expired recordings without legal hold and preserve recordings with legal hold', async () => {
    const expiredRecordings = [
      {
        id: 'rec-1',
        legalHold: false,
        filePath: '/tmp/test-rec-1.mp4',
        createdAt: new Date(Date.now() - 10 * 86400000),
      },
    ];

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockCount = vi.fn().mockResolvedValue(1); // 1 preserved under legal hold

    vi.mocked(getPrisma).mockReturnValue({
      cameraRecording: {
        findMany: vi.fn().mockResolvedValue(expiredRecordings),
        update: mockUpdate,
        count: mockCount,
      },
    } as any);

    const result = await sweepExpiredRecordings({ defaultRetentionDays: 7 });

    expect(result.deleted).toBe(1);
    expect(result.skippedLegalHold).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { isArchived: true },
    });
  });
});
