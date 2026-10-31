import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, out: { stdout: string }) => void) =>
    cb(null, { stdout: '59.98\n' })),
}));

import { getPrisma } from '../../lib/prisma.js';
import { indexSegment, parseSegmentStart, reconcileRecordings, resolveSegmentPath } from './segment-indexer.js';

describe('Recording segment indexer [R3.1]', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-rec-'));
  });

  const writeSegment = (streamPath: string, name: string, ageMs = 60_000) => {
    const file = path.join(dir, streamPath, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fmp4');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(file, t, t);
    return file;
  };

  const mockPrisma = (opts: { existing?: boolean; camera?: boolean; cameras?: string[] } = {}) => {
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rec-1', ...data }));
    vi.mocked(getPrisma).mockReturnValue({
      cameraRecording: {
        findFirst: vi.fn().mockResolvedValue(opts.existing ? { id: 'rec-old' } : null),
        create,
      },
      camera: {
        findFirst: vi.fn().mockResolvedValue(opts.camera === false ? null : { id: 'cam-1' }),
        findMany: vi.fn().mockResolvedValue((opts.cameras ?? []).map((streamPath) => ({ streamPath }))),
      },
    } as any);
    return create;
  };

  it('parses the UTC start time from MediaMTX segment names', () => {
    expect(parseSegmentStart('2026-10-31_01-53-51.mp4')?.toISOString()).toBe('2026-10-31T01:53:51.000Z');
    expect(parseSegmentStart('2026-10-31_01-53-51-250000.mp4')?.toISOString()).toBe('2026-10-31T01:53:51.250Z');
    expect(parseSegmentStart('clip_abc.mp4')).toBeNull();
  });

  it('maps MediaMTX paths into the recordings dir and rejects anything else', () => {
    expect(resolveSegmentPath('./recordings/cam1/2026-10-31_01-53-51.mp4', dir)).toBe(path.join(dir, 'cam1', '2026-10-31_01-53-51.mp4'));
    expect(() => resolveSegmentPath('./recordings/../../etc/2026-10-31_01-53-51.mp4', dir)).toThrow('outside');
    expect(() => resolveSegmentPath('./recordings/clips/2026-10-31_01-53-51.mp4', dir)).toThrow('clips');
    expect(() => resolveSegmentPath('./recordings/cam1/notes.txt', dir)).toThrow('pattern');
  });

  it('indexes a finished segment with the duration measured by ffprobe', async () => {
    const create = mockPrisma();
    const file = writeSegment('cam1', '2026-10-31_01-00-00.mp4');

    const result = await indexSegment('cam1', file);

    expect(result.indexed).toBe(true);
    const data = create.mock.calls[0][0].data;
    expect(data.cameraId).toBe('cam-1');
    expect(data.durationSeconds).toBe(59.98);
    expect(data.startTime.toISOString()).toBe('2026-10-31T01:00:00.000Z');
    expect(data.endTime.toISOString()).toBe('2026-10-31T01:00:59.980Z');
    expect(data.filePath).toBe(file);
  });

  it('does not index twice, for unknown paths, or while a file is still being written', async () => {
    mockPrisma();
    const file = writeSegment('cam1', '2026-10-31_01-00-00.mp4');
    expect((await indexSegment('cam1', file)).indexed).toBe(true);

    mockPrisma({ existing: true });
    expect(await indexSegment('cam1', file)).toMatchObject({ indexed: false, reason: 'already-indexed' });

    mockPrisma({ camera: false });
    expect(await indexSegment('unknown', file)).toMatchObject({ indexed: false, reason: 'no-camera' });

    const create = mockPrisma();
    const fresh = writeSegment('cam1', '2026-10-31_01-01-00.mp4', 0);
    expect(await indexSegment('cam1', fresh)).toMatchObject({ indexed: false, reason: 'still-writing' });
    // MediaMTX's own "segment complete" hook is trusted even right after the write.
    expect((await indexSegment('cam1', fresh, true)).indexed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reconciles finished segments of known cameras only', async () => {
    const create = mockPrisma({ cameras: ['cam1'] });
    writeSegment('cam1', '2026-10-31_01-00-00.mp4');
    writeSegment('cam1', 'not-a-segment.mp4');
    writeSegment('other', '2026-10-31_01-00-00.mp4');

    const summary = await reconcileRecordings(dir);

    expect(summary).toEqual({ scanned: 1, indexed: 1, failed: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
