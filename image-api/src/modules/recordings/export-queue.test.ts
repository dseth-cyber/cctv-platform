import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportConcurrencyQueue, ExportJob } from './export-queue.js';
import fs from 'node:fs';
import path from 'node:path';

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

  it('updates clip status from PROCESSING to COMPLETED and sets real hash and stream-copy metadata', async () => {
    const queue = new ExportConcurrencyQueue(1);
    const testClipId = 'clip-verify-101';
    const tempFile = path.resolve(process.cwd(), `temp_${Date.now()}.mp4`);

    try {
      const job: ExportJob = {
        clipId: testClipId,
        cameraId: 'cam-test',
        actualStartTime: new Date(),
        bufferedEnd: new Date(),
        durationSeconds: 30,
        hasPreBuffer: true,
        preBufferSec: 10,
        postBufferSec: 20,
        fullDiskPath: tempFile,
        filePath: `/recordings/clips/${path.basename(tempFile)}`,
        clipFilename: path.basename(tempFile),
        exportedBy: 'operator-1',
      };

      const result = await queue.enqueue(job);

      // Verify DB updates
      expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: testClipId },
          data: { status: 'PROCESSING' },
        })
      );

      expect(mockPrisma.recordingClip.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: testClipId },
          data: expect.objectContaining({
            status: 'COMPLETED',
            sha256Hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            chainOfCustody: expect.arrayContaining([
              expect.objectContaining({ streamCopy: true, action: 'export' }),
            ]),
          }),
        })
      );

      expect(result.status).toBe('COMPLETED');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
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
