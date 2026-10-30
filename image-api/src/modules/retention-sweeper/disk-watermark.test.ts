import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDiskHighWatermarkAndEvict, type StatfsInfo } from './retention-sweeper.service.js';
import { createAlert } from '../alerts/alerts.service.js';

const mockPrisma = {
  cameraRecording: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: () => mockPrisma,
}));

vi.mock('../alerts/alerts.service.js', () => ({
  createAlert: vi.fn().mockResolvedValue({ id: 'alert-disk-1' }),
}));

const GB = 1024 * 1024 * 1024;
const TOTAL_BYTES = 1000 * GB;

function fixedStatfs(usedPercent: number) {
  return (): StatfsInfo => ({ totalBytes: TOTAL_BYTES, freeBytes: TOTAL_BYTES * (1 - usedPercent / 100), usedPercent });
}

describe('Disk High-Watermark Monitor & Quarantine Eviction [ENH-03 / R1.6]', () => {
  let root: string;
  let recordingsDir: string;
  let quarantineDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-watermark-'));
    recordingsDir = path.join(root, 'recordings');
    quarantineDir = path.join(root, 'quarantine');
    fs.mkdirSync(recordingsDir, { recursive: true });
    mockPrisma.cameraRecording.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.cameraRecording.findUnique.mockResolvedValue({ legalHold: false });
    mockPrisma.cameraRecording.count.mockResolvedValue(0);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeSegments(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const filePath = path.join(recordingsDir, 'cam1', `seg-${i}.mp4`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `segment ${i}`);
      return { id: `rec-${i}`, filePath };
    });
  }

  it('level 70% (Normal): takes no action and generates no alerts', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(70), enabled: true });

    expect(result.status).toBe('normal');
    expect(result.evictedCount).toBe(0);
    expect(createAlert).not.toHaveBeenCalled();
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 86% (Warning): records warning alert and does not evict recordings', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(86), enabled: true });

    expect(result.status).toBe('warning');
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', title: expect.stringContaining('High-Watermark Warning') }));
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
  });

  it('level 95% with cleanup disabled: alerts critical and touches nothing', async () => {
    const segments = makeSegments(2);
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, statfsProvider: fixedStatfs(95), enabled: false });

    expect(result.status).toBe('critical_cleanup_disabled');
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', title: expect.stringContaining('Cleanup Disabled') }));
    expect(mockPrisma.cameraRecording.findMany).not.toHaveBeenCalled();
    for (const s of segments) expect(fs.existsSync(s.filePath)).toBe(true);
  });

  it('level 95% with cleanup enabled: moves oldest segments to quarantine (never deletes) until usage < 85%', async () => {
    const segments = makeSegments(6);
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce(segments);

    // Each move frees 25 GB as measured by the filesystem: 95% → 92.5 → 90 → 87.5 → 85 → 82.5
    let used = 95;
    const statfs = (): StatfsInfo => ({ totalBytes: TOTAL_BYTES, freeBytes: TOTAL_BYTES * (1 - used / 100), usedPercent: used });
    const realRename = fs.renameSync;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((src, dest) => {
      realRename(src, dest);
      used -= 2.5;
    });

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: statfs, enabled: true });
    renameSpy.mockRestore();

    expect(result.status).toBe('emergency_eviction_completed');
    expect(result.evictedCount).toBe(5);
    expect(result.usedPercent).toBeLessThan(85);
    expect(mockPrisma.cameraRecording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { legalHold: false, isArchived: false }, orderBy: { startTime: 'asc' } }),
    );
    // Claims are atomic on legalHold = false
    expect(mockPrisma.cameraRecording.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-0', legalHold: false, isArchived: false },
      data: { isArchived: true },
    });
    for (const s of segments.slice(0, 5)) {
      expect(fs.existsSync(s.filePath)).toBe(false);
      expect(fs.existsSync(path.join(quarantineDir, path.relative(recordingsDir, s.filePath)))).toBe(true);
    }
    expect(fs.existsSync(segments[5].filePath)).toBe(true);
  });

  it('skips a segment whose legal hold was set after the candidate query', async () => {
    const [seg] = makeSegments(1);
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([seg]);
    mockPrisma.cameraRecording.updateMany.mockResolvedValueOnce({ count: 0 }); // claim lost: hold already set

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.evictedCount).toBe(0);
    expect(result.skippedLegalHold).toBe(1);
    expect(fs.existsSync(seg.filePath)).toBe(true);
  });

  it('restores a segment when legal hold is set while it is being moved', async () => {
    const [seg] = makeSegments(1);
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([seg]);
    mockPrisma.cameraRecording.findUnique.mockResolvedValueOnce({ legalHold: true });

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(seg.filePath)).toBe(true);
    expect(mockPrisma.cameraRecording.updateMany).toHaveBeenLastCalledWith({ where: { id: seg.id }, data: { isArchived: false } });
  });

  it('stops and alerts when moves free no space (quarantine on the same filesystem)', async () => {
    const segments = makeSegments(15);
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce(segments);

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.status).toBe('emergency_eviction_ineffective');
    expect(result.evictedCount).toBe(10);
    expect(result.bytesFreed).toBe(0);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('Did Not Free Space') }));
  });

  it('refuses to move files outside the recordings directory', async () => {
    const outside = path.join(root, 'elsewhere.mp4');
    fs.writeFileSync(outside, 'x');
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([{ id: 'rec-x', filePath: outside }]);

    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: recordingsDir, quarantineDir, statfsProvider: fixedStatfs(95), enabled: true });

    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
    expect(mockPrisma.cameraRecording.updateMany).toHaveBeenLastCalledWith({ where: { id: 'rec-x' }, data: { isArchived: false } });
  });

  it('reports monitor_error (not normal) when the recordings directory is missing', async () => {
    const result = await checkDiskHighWatermarkAndEvict({ directoryPath: path.join(root, 'not-mounted'), enabled: true });

    expect(result.status).toBe('monitor_error');
    expect(fs.existsSync(path.join(root, 'not-mounted'))).toBe(false);
    expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recording Storage Monitor Error' }));
  });
});
