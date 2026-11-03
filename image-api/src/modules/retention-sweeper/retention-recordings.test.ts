import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sweepExpiredRecordings, purgeQuarantinedRecordings } from './retention-sweeper.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));

const DAY = 86_400_000;
const NOW = new Date('2026-11-03T00:00:00Z');

describe('Recording retention (30-day policy, quarantine purge, Legal Hold)', () => {
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

  it('MediaMTX never deletes recordings itself (recordDeleteAfter disabled)', () => {
    const parsed = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../../../../mediamtx/mediamtx.yml'), 'utf8'));
    expect(parsed.recordDeleteAfter).toBeUndefined();
    expect(parsed.pathDefaults.recordDeleteAfter).toBe('0s');
  });

  it('does nothing while cleanup is disabled', async () => {
    const findMany = vi.fn();
    vi.mocked(getPrisma).mockReturnValue({ cameraRecording: { findMany }, camera: { findMany } } as any);

    expect((await sweepExpiredRecordings({ enabled: false })).enabled).toBe(false);
    expect((await purgeQuarantinedRecordings({ enabled: false })).enabled).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses each camera\'s policy days (else the default policy) and quarantines what ended before the cutoff', async () => {
    const filePath = path.join(recordingsDir, 'cam1', 'seg-1.mp4');
    fs.writeFileSync(filePath, 'video');
    const recFind = vi.fn().mockResolvedValue([]);
    recFind.mockResolvedValueOnce([{ id: 'rec-1', filePath }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(getPrisma).mockReturnValue({
      retentionPolicy: { findFirst: vi.fn().mockResolvedValue({ recordingRetentionDays: 30 }) },
      camera: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cam-a', retentionPolicy: null },                                  // default policy: 30
          { id: 'cam-b', retentionPolicy: { recordingRetentionDays: 90 } },
        ]),
      },
      cameraRecording: {
        findMany: recFind,
        updateMany,
        findUnique: vi.fn().mockResolvedValue({ legalHold: false }),
        count: vi.fn().mockResolvedValue(1), // one expired recording kept under Legal Hold
      },
    } as any);

    const result = await sweepExpiredRecordings({ enabled: true, dirs: { recordingsDir, quarantineDir }, now: NOW });

    expect(recFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { legalHold: false, isArchived: false, cameraId: { in: ['cam-a'] }, endTime: { lte: new Date(NOW.getTime() - 30 * DAY) } },
    }));
    expect(recFind).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { legalHold: false, isArchived: false, cameraId: { in: ['cam-b'] }, endTime: { lte: new Date(NOW.getTime() - 90 * DAY) } },
    }));
    expect(result.quarantined).toBe(1);
    expect(result.skippedLegalHold).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', legalHold: false, isArchived: false },
      data: { isArchived: true, archivedAt: expect.any(Date) },
    });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readFileSync(path.join(quarantineDir, 'cam1', 'seg-1.mp4'), 'utf8')).toBe('video');
  });

  it('purges quarantine after the purge period, keeps held rows, and audits the deletion', async () => {
    const filePath = path.join(recordingsDir, 'cam1', 'old.mp4');
    const q = path.join(quarantineDir, 'cam1', 'old.mp4');
    fs.mkdirSync(path.dirname(q), { recursive: true });
    fs.writeFileSync(q, 'video');
    const findMany = vi.fn().mockResolvedValue([
      { id: 'rec-old', filePath, isArchived: true },
      { id: 'rec-held', filePath: path.join(recordingsDir, 'cam1', 'held.mp4'), isArchived: true },
    ]);
    const findFirst = vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id === 'rec-held' ? null : { id: where.id }));
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(getPrisma).mockReturnValue({ cameraRecording: { findMany, findFirst, deleteMany } } as any);

    const result = await purgeQuarantinedRecordings({ enabled: true, dirs: { recordingsDir, quarantineDir }, purgeDays: 7, now: NOW });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isArchived: true, legalHold: false, archivedAt: { lte: new Date(NOW.getTime() - 7 * DAY) } },
    }));
    expect(result).toMatchObject({ deleted: 1, skippedLegalHold: 1, errors: 0 });
    expect(fs.existsSync(q)).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'rec-old', legalHold: false } });
    expect(deleteMany).not.toHaveBeenCalledWith({ where: { id: 'rec-held', legalHold: false } });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'recording_purge',
      metadata: expect.objectContaining({ reason: 'quarantine_expired', count: 1, recordingIds: ['rec-old'] }),
    }));
  });
});
