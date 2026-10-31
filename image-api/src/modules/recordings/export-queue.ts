import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

const execFileAsync = promisify(execFile);

export interface ExportJob {
  clipId: string;
  cameraId: string;
  actualStartTime: Date;
  bufferedEnd: Date;
  durationSeconds: number;
  hasPreBuffer: boolean;
  preBufferSec: number;
  postBufferSec: number;
  fullDiskPath: string;
  filePath: string;
  clipFilename: string;
  exportedBy: string;
}

/**
 * In-process concurrency queue for FFmpeg clip exports [ENH-02].
 * Limits concurrent ffmpeg tasks to MAX_CONCURRENT_EXPORTS (default 2)
 * and enforces stream-copy (-c copy -movflags +faststart) with a 120s timeout.
 */
export class ExportConcurrencyQueue {
  private maxConcurrent: number;
  private running = 0;
  private queue: Array<{
    job: ExportJob;
    resolve: (res: any) => void;
    reject: (err: any) => void;
  }> = [];

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
  }

  get activeCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  getJobStatus(clipId: string): 'PROCESSING' | 'QUEUED' | 'UNKNOWN' {
    if (this.queue.some((item) => item.job.clipId === clipId)) {
      return 'QUEUED';
    }
    return 'UNKNOWN';
  }

  async enqueue(job: ExportJob): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.running++;
    try {
      const result = await this.executeJob(item.job);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.running--;
      this.processNext();
    }
  }

  async executeJob(job: ExportJob): Promise<any> {
    const prisma = getPrisma();
    logger.info({ clipId: job.clipId, active: this.running, queued: this.queue.length }, 'Processing clip export job');

    // 1. Mark status PROCESSING in database
    await prisma.recordingClip.update({
      where: { id: job.clipId },
      data: { status: 'PROCESSING' },
    });

    try {
      // 2. Find segments
      const segments = await prisma.cameraRecording.findMany({
        where: {
          cameraId: job.cameraId,
          startTime: { lte: job.bufferedEnd },
          endTime: { gte: job.actualStartTime },
        },
        orderBy: { startTime: 'asc' },
      });

      const presentSegments = segments.filter((s) => Boolean(s.filePath && fs.existsSync(s.filePath)));
      const validFiles = presentSegments.map((s) => s.filePath);

      // Never fabricate evidence: no recorded video on disk means the export failed.
      if (validFiles.length === 0) {
        throw new Error(`No recorded video found on disk for the requested window (${segments.length} indexed segments, 0 files present)`);
      }

      // Cut the joined segments down to the requested window. The concat timeline has no gaps, so
      // the length to keep is the recorded time inside the window, not the wall-clock span.
      // Stream copy can only start on a keyframe, so the clip may begin up to one GOP early.
      const windowStart = job.actualStartTime.getTime();
      const windowEnd = job.bufferedEnd.getTime();
      const coveredStart = Math.max(windowStart, presentSegments[0].startTime.getTime());
      const coveredEnd = Math.min(windowEnd, presentSegments[presentSegments.length - 1].endTime.getTime());
      const trimOffsetSeconds = Math.max(0, (coveredStart - presentSegments[0].startTime.getTime()) / 1000);
      const trimDurationSeconds = presentSegments.reduce(
        (sum, seg) => sum + Math.max(0, Math.min(windowEnd, seg.endTime.getTime()) - Math.max(windowStart, seg.startTime.getTime())) / 1000,
        0,
      );
      if (trimDurationSeconds <= 0) {
        throw new Error('Recorded segments do not overlap the requested window');
      }
      const gaps = findGaps(presentSegments, coveredStart, coveredEnd);
      const trimArgs = ['-ss', trimOffsetSeconds.toFixed(3), '-t', trimDurationSeconds.toFixed(3)];
      // Stream copy runs far faster than real time; allow at least 10x real time plus a margin.
      const ffmpegTimeoutMs = 120_000 + Math.ceil(trimDurationSeconds * 100);

      // Write to a temp name and rename only on success, so a half-written file is never downloadable.
      const partialPath = `${job.fullDiskPath}.partial`;
      try {
        if (validFiles.length === 1) {
          await this.runFfmpeg(['-y', ...trimArgs, '-i', validFiles[0], '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', partialPath], ffmpegTimeoutMs);
        } else {
          const concatListPath = `${job.fullDiskPath}.concat.txt`;
          const concatContent = validFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
          fs.writeFileSync(concatListPath, concatContent);

          try {
            await this.runFfmpeg(['-y', '-f', 'concat', '-safe', '0', ...trimArgs, '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', partialPath], ffmpegTimeoutMs);
          } finally {
            if (fs.existsSync(concatListPath)) {
              fs.unlinkSync(concatListPath);
            }
          }
        }

        if (!fs.existsSync(partialPath) || fs.statSync(partialPath).size === 0) {
          throw new Error('ffmpeg finished without producing an output file');
        }
        fs.renameSync(partialPath, job.fullDiskPath);
      } finally {
        if (fs.existsSync(partialPath)) {
          fs.unlinkSync(partialPath);
        }
      }

      // 3. Compute SHA-256 and chain of custody
      // Hash as a stream: multi-hour clips are gigabytes and must not be read into memory.
      const hash = crypto.createHash('sha256');
      await pipeline(fs.createReadStream(job.fullDiskPath), hash);
      const sha256Hash = hash.digest('hex');
      const fileStat = fs.statSync(job.fullDiskPath);
      const fileSizeBytes = BigInt(fileStat.size);

      const chainOfCustody = [
        {
          timestamp: new Date().toISOString(),
          action: 'export',
          performedBy: job.exportedBy,
          sha256: sha256Hash,
          fileSizeBytes: fileStat.size,
          hasPreBuffer: job.hasPreBuffer,
          preBufferSeconds: job.hasPreBuffer ? job.preBufferSec : 0,
          postBufferSeconds: job.postBufferSec,
          streamCopy: true,
          sourceSegments: presentSegments.map((seg) => seg.id),
          coveredStart: new Date(coveredStart).toISOString(),
          coveredEnd: new Date(coveredEnd).toISOString(),
          recordedSeconds: Math.round(trimDurationSeconds * 1000) / 1000,
          gaps,
          keyframeAligned: true,
        },
      ];

      // 4. Mark status COMPLETED in database
      const updated = await prisma.recordingClip.update({
        where: { id: job.clipId },
        data: {
          status: 'COMPLETED',
          startTime: new Date(coveredStart),
          endTime: new Date(coveredEnd),
          durationSeconds: Math.round(trimDurationSeconds),
          filePath: job.filePath,
          fileSizeBytes,
          sha256Hash,
          chainOfCustody,
          downloadUrl: `/api/v1/recordings/clips/download/${job.clipFilename}`,
        },
      });

      return {
        ...updated,
        fileSizeBytes: updated.fileSizeBytes ? updated.fileSizeBytes.toString() : null,
      };
    } catch (err: any) {
      logger.error({ err, clipId: job.clipId }, 'Export job execution failed');
      await prisma.recordingClip.update({
        where: { id: job.clipId },
        data: {
          status: 'FAILED',
          description: `Export failed: ${err.message}`,
        },
      });
      throw err;
    }
  }

  private async runFfmpeg(args: string[], timeoutMs = 120000): Promise<void> {
    try {
      await execFileAsync('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    } catch (err: any) {
      // No copy fallback: copying the raw input (or the concat list) would yield a file that is not a valid clip.
      if (err.code === 'ENOENT') {
        throw new Error('ffmpeg is not installed in the image-api runtime; cannot export clips');
      }
      throw new Error(`ffmpeg failed: ${String(err.stderr || err.message).slice(-500)}`);
    }
  }

}

/** Gaps (> 10 s) between consecutive recorded segments inside [from, to]; they are left out of the clip. */
export function findGaps(
  segments: Array<{ startTime: Date; endTime: Date }>,
  from: number,
  to: number,
): Array<{ start: string; end: string; seconds: number }> {
  const gaps: Array<{ start: string; end: string; seconds: number }> = [];
  for (let i = 1; i < segments.length; i++) {
    const start = Math.max(from, segments[i - 1].endTime.getTime());
    const end = Math.min(to, segments[i].startTime.getTime());
    if (end - start > 10_000) {
      gaps.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), seconds: Math.round((end - start) / 1000) });
    }
  }
  return gaps;
}

const envMaxExports = process.env.MAX_CONCURRENT_EXPORTS ? parseInt(process.env.MAX_CONCURRENT_EXPORTS, 10) : 2;
export const defaultExportQueue = new ExportConcurrencyQueue(Number.isFinite(envMaxExports) && envMaxExports > 0 ? envMaxExports : 2);
