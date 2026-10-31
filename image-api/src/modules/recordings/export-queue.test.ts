import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportConcurrencyQueue, ExportJob } from './export-queue.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Mock dependencies
const mockPrisma = {
  cameraRecording: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  recordingClip: {
    update: vi.fn().mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data })
    ),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrisma: () => mockPrisma,
}));

describe('FFmpeg Clip Export Concurrency Queue & Stream Copy Guard [ENH-02]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limits concurrency to MAX_CONCURRENT_EXPORTS = 2 and keeps remainder in QUEUED status', async () => {
    const queue = new ExportConcurrencyQueue(2);

    // Controlled promises to simulate async ffmpeg processing duration
    const controllers: Array<{ resolve: () => void }> = [];
    const executionOrder: string[] = [];

    // Mock executeJob to inspect in-flight concurrency
    vi.spyOn(queue, 'executeJob').mockImplementation(async (job: ExportJob) => {
      executionOrder.push(job.clipId);
      await new Promise<void>((res) => {
        controllers.push({ resolve: res });
      });
      return { id: job.clipId, status: 'COMPLETED' };
    });

    const createDummyJob = (id: string): ExportJob => ({
      clipId: id,
      cameraId: 'cam-01',
      actualStartTime: new Date(),
      bufferedEnd: new Date(),
      durationSeconds: 60,
      hasPreBuffer: false,
      preBufferSec: 0,
      postBufferSec: 0,
      fullDiskPath: path.resolve(process.cwd(), `test_${id}.mp4`),
      filePath: `/recordings/clips/test_${id}.mp4`,
      clipFilename: `test_${id}.mp4`,
      exportedBy: 'tester',
    });

    // Enqueue 5 jobs simultaneously
    const p1 = queue.enqueue(createDummyJob('job-1'));
    const p2 = queue.enqueue(createDummyJob('job-2'));
    const p3 = queue.enqueue(createDummyJob('job-3'));
    const p4 = queue.enqueue(createDummyJob('job-4'));
    const p5 = queue.enqueue(createDummyJob('job-5'));

    // Allow synchronous microtasks to process
    await new Promise((r) => setTimeout(r, 10));

    // PROOF: Only 2 are active, 3 remain in QUEUED status
    expect(queue.activeCount).toBe(2);
    expect(queue.queuedCount).toBe(3);
    expect(queue.getJobStatus('job-3')).toBe('QUEUED');
    expect(queue.getJobStatus('job-4')).toBe('QUEUED');
    expect(queue.getJobStatus('job-5')).toBe('QUEUED');
    expect(executionOrder).toEqual(['job-1', 'job-2']);

    // Complete the first job
    controllers[0].resolve();
    await new Promise((r) => setTimeout(r, 10));

    // Next job (job-3) should now be running
    expect(queue.activeCount).toBe(2);
    expect(queue.queuedCount).toBe(2);
    expect(executionOrder).toEqual(['job-1', 'job-2', 'job-3']);

    // Complete job-2
    controllers[1].resolve();
    await new Promise((r) => setTimeout(r, 10));

    // job-4 starts
    expect(executionOrder).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);

    // Complete job-3, job-4, job-5
    controllers[2].resolve();
    await new Promise((r) => setTimeout(r, 10));
    controllers[3].resolve();
    await new Promise((r) => setTimeout(r, 10));
    controllers[4].resolve();

    const results = await Promise.all([p1, p2, p3, p4, p5]);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === 'COMPLETED')).toBe(true);
    expect(queue.activeCount).toBe(0);
    expect(queue.queuedCount).toBe(0);
  });

  // One 60s segment from T0; the job asks for T0+10s .. T0+40s.
  const T0 = new Date('2026-10-31T01:00:00.000Z');
  const segmentRow = (filePath: string) => ({
    id: 'seg-1',
    filePath,
    startTime: T0,
    endTime: new Date(T0.getTime() + 60_000),
  });

  function makeJob(id: string, fullDiskPath: string): ExportJob {
    return {
      clipId: id,
      cameraId: 'cam-test',
      actualStartTime: new Date(T0.getTime() + 10_000),
      bufferedEnd: new Date(T0.getTime() + 40_000),
      durationSeconds: 30,
      hasPreBuffer: true,
      preBufferSec: 10,
      postBufferSec: 20,
      fullDiskPath,
      filePath: `/recordings/clips/${path.basename(fullDiskPath)}`,
      clipFilename: path.basename(fullDiskPath),
      exportedBy: 'operator-1',
    };
  }

  it('updates clip status from PROCESSING to COMPLETED with the hash of the file ffmpeg produced from a real segment', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-export-'));
    const segment = path.join(dir, 'seg-1.mp4');
    fs.writeFileSync(segment, 'recorded-video-bytes');
    const output = path.join(dir, 'clip.mp4');
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([segmentRow(segment)]);

    const queue = new ExportConcurrencyQueue(1);
    const ffmpeg = vi.spyOn(queue as any, 'runFfmpeg').mockImplementation(async (args: any) => {
      fs.copyFileSync(args[args.indexOf('-i') + 1], args[args.length - 1]);
    });

    try {
      const result = await queue.enqueue(makeJob('clip-verify-101', output));

      const ffmpegArgs = ffmpeg.mock.calls[0][0] as string[];
      expect(ffmpegArgs).toEqual(expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']));
      expect(ffmpegArgs[ffmpegArgs.length - 1]).toBe(`${output}.partial`);
      // Cut to the requested 30s starting 10s into the segment, not the whole 60s file.
      expect(ffmpegArgs.slice(ffmpegArgs.indexOf('-ss'), ffmpegArgs.indexOf('-ss') + 4)).toEqual(['-ss', '10.000', '-t', '30.000']);

      const expectedHash = crypto.createHash('sha256').update('recorded-video-bytes').digest('hex');
      expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith({ where: { id: 'clip-verify-101' }, data: { status: 'PROCESSING' } });
      expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'clip-verify-101' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            sha256Hash: expectedHash,
            chainOfCustody: expect.arrayContaining([expect.objectContaining({ streamCopy: true, action: 'export' })]),
          }),
        })
      );
      expect(result.status).toBe('COMPLETED');
      expect(fs.existsSync(`${output}.partial`)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks clip FAILED (and writes no file) when no recorded video exists for the window', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-export-'));
    const output = path.join(dir, 'clip.mp4');
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([segmentRow(path.join(dir, 'missing.mp4'))]);

    try {
      await expect(new ExportConcurrencyQueue(1).enqueue(makeJob('clip-empty', output))).rejects.toThrow('No recorded video found');

      expect(fs.existsSync(output)).toBe(false);
      expect(mockPrisma.recordingClip.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
      );
      expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clip-empty' }, data: expect.objectContaining({ status: 'FAILED' }) })
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks clip FAILED and leaves no partial file when ffmpeg fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-export-'));
    const segment = path.join(dir, 'seg-1.mp4');
    fs.writeFileSync(segment, 'x');
    const output = path.join(dir, 'clip.mp4');
    mockPrisma.cameraRecording.findMany.mockResolvedValueOnce([segmentRow(segment)]);

    const queue = new ExportConcurrencyQueue(1);
    vi.spyOn(queue as any, 'runFfmpeg').mockImplementation(async (args: any) => {
      fs.writeFileSync(args[args.length - 1], 'half-written');
      throw new Error('ffmpeg is not installed in the image-api runtime; cannot export clips');
    });

    try {
      await expect(queue.enqueue(makeJob('clip-noffmpeg', output))).rejects.toThrow('ffmpeg is not installed');
      expect(fs.existsSync(output)).toBe(false);
      expect(fs.existsSync(`${output}.partial`)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks clip as FAILED when export execution errors', async () => {
    const queue = new ExportConcurrencyQueue(1);
    const failJob: ExportJob = {
      clipId: 'clip-fail-001',
      cameraId: 'cam-err',
      actualStartTime: new Date(),
      bufferedEnd: new Date(),
      durationSeconds: 10,
      hasPreBuffer: false,
      preBufferSec: 0,
      postBufferSec: 0,
      fullDiskPath: '/invalid/nonexistent/path/cannot_write.mp4',
      filePath: '/recordings/clips/cannot_write.mp4',
      clipFilename: 'cannot_write.mp4',
      exportedBy: 'tester',
    };

    // If writing to invalid root path throws
    await expect(queue.enqueue(failJob)).rejects.toThrow();

    expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'clip-fail-001' },
        data: expect.objectContaining({
          status: 'FAILED',
          description: expect.stringContaining('Export failed'),
        }),
      })
    );
  });
});
