import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { restoreRecordingFromQuarantine } from './retention-sweeper.service.js';

describe('Legal Hold restores a quarantined segment', () => {
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-hold-'));
    const dirs = { recordingsDir: path.join(root, 'recordings'), quarantineDir: path.join(root, 'recordings', '.quarantine') };
    const original = path.join(dirs.recordingsDir, 'cam1', '2026-10-31_01-00-00-000000.mp4');
    const quarantined = path.join(dirs.quarantineDir, 'cam1', '2026-10-31_01-00-00-000000.mp4');
    fs.mkdirSync(path.dirname(quarantined), { recursive: true });
    fs.writeFileSync(quarantined, 'evidence');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(getPrisma).mockReturnValue({ cameraRecording: { updateMany } } as any);
    return { root, dirs, original, quarantined, updateMany };
  };

  it('moves the file back and un-archives the row', async () => {
    const { root, dirs, original, quarantined, updateMany } = setup();
    try {
      const outcome = await restoreRecordingFromQuarantine({ id: 'r1', filePath: original, isArchived: true }, dirs);
      expect(outcome).toBe('restored');
      expect(fs.readFileSync(original, 'utf8')).toBe('evidence');
      expect(fs.existsSync(quarantined)).toBe(false);
      expect(updateMany).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { isArchived: false, archivedAt: null } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports instead of pretending when there is nothing to restore', async () => {
    const { root, dirs, original, updateMany } = setup();
    try {
      expect(await restoreRecordingFromQuarantine({ id: 'r1', filePath: original, isArchived: false }, dirs)).toBe('not_archived');
      const other = path.join(dirs.recordingsDir, 'cam1', 'gone.mp4');
      expect(await restoreRecordingFromQuarantine({ id: 'r2', filePath: other, isArchived: true }, dirs)).toBe('not_in_quarantine');
      expect(await restoreRecordingFromQuarantine({ id: 'r3', filePath: '/etc/passwd', isArchived: true }, dirs)).toBe('outside_root');
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
