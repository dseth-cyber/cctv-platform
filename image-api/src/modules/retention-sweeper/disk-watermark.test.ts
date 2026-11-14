import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDiskHighWatermarkAndEvict, type StatfsInfo } from './retention-sweeper.service.js';
import { createAlert } from '../alerts/alerts.service.js';
import { createAuditLog } from '../audit/audit.service.js';

const mockPrisma = {
  cameraRecording: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  recordingClip: { aggregate: vi.fn() },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: () => mockPrisma,
}));

vi.mock('../alerts/alerts.service.js', () => ({
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-disk-1' }),
}));

vi.mock('../audit/audit.service.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

const GB = 1024 * 1024 * 1024;
const TOTAL_BYTES = 1000 * GB;

function fixedStatfs(usedPercent: number) {
  return (): StatfsInfo => ({ totalBytes: TOTAL_BYTES, freeBytes: TOTAL_BYTES * (1 - usedPercent / 100), usedPercent });
}

describe('Disk High-Watermark: delete oldest recordings when critical (policy 2026-11-03)', () => {
  let root: string;
  let recordingsDir: string;
  let quarantineDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-watermark-'));
    recordingsDir = path.join(root, 'recordings');
    quarantineDir = path.join(root, 'quarantine');
    fs.mkdirSync(recordingsDir, { recursive: true });
    mockPrisma.cameraRecording.findFirst.mockResolvedValue({ id: 'x' }); // not on hold
    mockPrisma.cameraRecording.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.cameraRecording.count.mockResolvedValue(0);
    mockPrisma.recordingClip.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: 0 } });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeLive(n: number, prefix = 'seg') {
    return Array.from({ length: n }, (_, i) => {
      const filePath = path.join(recordingsDir, 'cam1', `${prefix}-${i}.mp4`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `segment ${i}`);
      return { id: `${prefix}-${i}`, filePath, isArchived: false };
    });
  }

  function makeQuarantined(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const filePath = path.join(recordingsDir, 'cam1', `old-${i}.mp4`);
      const q = path.join(quarantineDir, 'cam1', `old-${i}.mp4`);
      fs.mkdirSync(path.dirname(q), { recursive: true });
      fs.writeFileSync(q, `quarantined ${i}`);
      return { id: `old-${i}`, filePath, isArchived: true, quarantinePath: q };
    });
  }

  /** findMany is called for quarantined candidates first, then live ones. */
  function candidates(quarantined: any[], live: any[]) {
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce(quarantined).mockResolvedValueOnce(live);
  }

  it('level 70% (Normal): takes no action and generates no alerts', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(70), enabled: true });

    expect(result.status).toBe('normal');
    expect(createAlert).not.toHaveBeenCalled();
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 86% (Warning): records warning alert and deletes nothing', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(86), enabled: true });

    expect(result.status).toBe('warning');
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', title: expect.stringContaining('High-Watermark Warning') }));
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 95% with cleanup disabled: alerts critical and touches nothing', async () => {
    const segments = makeLive(2);
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(95), enabled: false });

    expect(result.status).toBe('critical_cleanup_disabled');
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', title: expect.stringContaining('Cleanup Disabled') }));
    for (const s of segments) expect(fs.existsSync(s.filePath)).toBe(true);
  });

  it('level 95% with cleanup enabled: deletes quarantined then oldest live recordings until < 85%, and audits it', async () => {
    const quarantined = makeQuarantined(2);
    const live = makeLive(6);
    candidates(quarantined, live);

    // Each deletion frees 2.5% as measured by the filesystem: 95 → 92.5 → 90 → 87.5 → 85 → 82.5
    let used = 95;
    const statfs = (): StatfsInfo => ({ totalBytes: TOTAL_BYTES, freeBytes: TOTAL_BYTES * (1 - used / 100), usedPercent: used });
    const realUnlink = fs.unlinkSync;
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      realUnlink(p);
      used -= 2.5;
    });

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: statfs, enabled: true });
    unlinkSpy.mockRestore();

    expect(result.status).toBe('emergency_eviction_completed');
    expect(result.evictedCount).toBe(5);
    expect(result.usedPercent).toBeLessThan(85);
    // Quarantined (already expired) first, then the oldest live ones
    for (const q of quarantined) expect(fs.existsSync(q.quarantinePath)).toBe(false);
    for (const s of live.slice(0, 3)) expect(fs.existsSync(s.filePath)).toBe(false);
    for (const s of live.slice(3)) expect(fs.existsSync(s.filePath)).toBe(true);
    expect(mockPrisma.cameraRecording.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { legalHold: false, isArchived: true } }));
    expect(mockPrisma.cameraRecording.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { legalHold: false, isArchived: false } }));
    // Row deletion is conditional on legalHold = false
    expect(mockPrisma.cameraRecording.deleteMany).toHaveBeenCalledWith({ where: { id: 'old-0', legalHold: false } });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'recording_purge',
      metadata: expect.objectContaining({ reason: 'disk_critical', count: 5 }),
    }));
  });

  it('never deletes a recording whose legal hold was set after the candidate query', async () => {
    const [seg] = makeLive(1);
    candidates([], [seg]);
    mockPrisma.cameraRecording.findFirst.mockResolvedValueOnce(null); // now on hold

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.evictedCount).toBe(0);
    expect(result.skippedLegalHold).toBe(1);
    expect(fs.existsSync(seg.filePath)).toBe(true);
    expect(mockPrisma.cameraRecording.deleteMany).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('stops and alerts when deletions free no space', async () => {
    candidates([], makeLive(15));

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.status).toBe('emergency_eviction_ineffective');
    expect(result.evictedCount).toBe(10);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('Did Not Free Space') }));
  });

  it('alerts with the space evidence clips take when nothing it may delete brings the disk down (clips are never deleted for space)', async () => {
    candidates([], []);
    mockPrisma.recordingClip.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: BigInt(120 * GB) } });

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.status).toBe('emergency_eviction_ineffective');
    expect(result.evictedCount).toBe(0);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Did Not Free Space'),
      message: expect.stringContaining('Evidence clips hold 120.0 GB'),
    }));
  });

  it('refuses to delete files outside the recordings directory', async () => {
    const outside = path.join(root, 'elsewhere.mp4');
    fs.writeFileSync(outside, 'x');
    candidates([], [{ id: 'rec-x', filePath: outside, isArchived: false }]);

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
    expect(mockPrisma.cameraRecording.deleteMany).not.toHaveBeenCalled();
  });

  it('reports monitor_error (not normal) when the recordings directory is missing', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: path.join(root, 'not-mounted'), enabled: true });

    expect(result.status).toBe('monitor_error');
    expect(fs.existsSync(path.join(root, 'not-mounted'))).toBe(false);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recording Storage Monitor Error' }));
  });
});
