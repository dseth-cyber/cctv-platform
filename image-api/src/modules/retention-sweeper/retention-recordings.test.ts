import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sweepExpiredRecordings } from './retention-sweeper.service.js';
import { getPrisma } from '../../lib/prisma.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

describe('Recording Retention Sweeper & Legal Hold [AUDIT-CRIT-04 / R1.6]', () => {
  let root: string;
  let recordingsDir: string;
  let quarantineDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-retention-'));
    recordingsDir = path.join(root, 'recordings');
    quarantineDir = path.join(root, 'quarantine');
    fs.mkdirSync(path.join(recordingsDir, 'cam1'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should not contain unmanaged recordDeleteAfter in mediamtx.yml', () => {
    const configPath = path.resolve(__dirname, '../../../../mediamtx/mediamtx.yml');
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(content);
    // Unmanaged recordDeleteAfter deletes files regardless of legalHold flag in DB
    expect(parsed.recordDeleteAfter).toBeUndefined();
  });

  it('does nothing while cleanup is disabled', async () => {
    const findMany = vi.fn();
    vi.mocked(getPrisma).mockReturnValue({ cameraRecording: { findMany } } as any);

    const result = await sweepExpiredRecordings({ enabled: false });

    expect(result.enabled).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('moves expired recordings to quarantine and preserves legal-hold recordings', async () => {
    const filePath = path.join(recordingsDir, 'cam1', 'seg-1.mp4');
    fs.writeFileSync(filePath, 'video');

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(getPrisma).mockReturnValue({
      cameraRecording: {
        findMany: vi.fn().mockResolvedValue([{ id: 'rec-1', filePath }]),
        updateMany,
        findUnique: vi.fn().mockResolvedValue({ legalHold: false }),
        count: vi.fn().mockResolvedValue(1), // 1 expired recording preserved under legal hold
      },
    } as any);

    const result = await sweepExpiredRecordings({ enabled: true, defaultRetentionDays: 7, dirs: { recordingsDir, quarantineDir } });

    expect(result.quarantined).toBe(1);
    expect(result.skippedLegalHold).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', legalHold: false, isArchived: false },
      data: { isArchived: true },
    });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readFileSync(path.join(quarantineDir, 'cam1', 'seg-1.mp4'), 'utf8')).toBe('video');
  });
});
