import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordingFileOnDisk, removeRecordingFiles } from './camera-deletion.js';

describe('recordingFileOnDisk', () => {
  const dir = path.resolve('/data/recordings');

  it('finds clips and segments as they are stored', () => {
    expect(recordingFileOnDisk('/recordings/clips/a.mp4', dir)).toBe(path.join(dir, 'clips', 'a.mp4'));
    expect(recordingFileOnDisk('./recordings/cam/x/1.mp4', dir)).toBe(path.join(dir, 'cam', 'x', '1.mp4'));
    expect(recordingFileOnDisk(path.join(dir, 'cam', '2.mp4'), dir)).toBe(path.join(dir, 'cam', '2.mp4'));
  });

  it('refuses anything outside the recordings folder', () => {
    expect(recordingFileOnDisk('/recordings/../../etc/passwd', dir)).toBeNull();
    expect(recordingFileOnDisk('/etc/passwd', dir)).toBeNull();
    expect(recordingFileOnDisk('/recordings/', dir)).toBeNull();
    expect(recordingFileOnDisk(null, dir)).toBeNull();
  });
});

describe('removeRecordingFiles', () => {
  it('removes files, and a file already gone is not a failure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const file = path.join(dir, 'a.mp4');
    fs.writeFileSync(file, 'x');
    expect(await removeRecordingFiles([file, path.join(dir, 'gone.mp4')])).toEqual({ removed: 1, failed: [] });
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  it('reports a file that cannot be removed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    // A folder in its place: unlink refuses it on every platform.
    const blocked = path.join(dir, 'blocked.mp4');
    fs.mkdirSync(blocked);
    expect(await removeRecordingFiles([blocked])).toEqual({ removed: 0, failed: ['blocked.mp4'] });
    fs.rmSync(dir, { recursive: true });
  });
});
