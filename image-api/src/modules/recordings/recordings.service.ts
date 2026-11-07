import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { ValidationError } from '../../lib/errors.js';
import { defaultExportQueue, findGaps, ClipCancelledError } from './export-queue.js';
import { restoreRecordingFromQuarantine } from '../retention-sweeper/retention-sweeper.service.js';

export interface RecordingCoverage {
  windowSeconds: number;
  recordedSeconds: number;
  estimatedBytes: number;
  segmentsCount: number;
  gaps: Array<{ start: string; end: string; seconds: number }>;
}

const DOWNLOAD_LINK_TTL_SECONDS = 300;

export interface TimelineContinuousBlock {
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

export interface TimelineGap {
  startTime: string;
  endTime: string;
  durationSeconds: number;
  reason: string;
}

export interface TimelineIncidentMarker {
  id: string;
  incidentNumber: string;
  startTime: string;
  endTime: string;
  reason: string;
  severity: string;
  description: string;
}

export interface TimelineAvailabilityResult {
  cameraId: string;
  cameraName: string;
  date: string;
  timezone: string;
  totalRecordedSeconds: number;
  totalRecordedBytes: number;
  segmentsCount: number;
  segments: Array<{
    id: string;
    startTime: string;
    endTime: string;
    durationSeconds: number;
    hasIncident: boolean;
    legalHold: boolean;
    format: string;
    fileSizeBytes: string;
  }>;
  continuousBlocks: TimelineContinuousBlock[];
  gaps: TimelineGap[];
  incidents: TimelineIncidentMarker[];
}

export interface ExportClipDto {
  cameraId: string;
  incidentId?: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
  legalHold?: boolean;
  exportedBy?: string;
}

export class RecordingsService {
  /**
   * Retrieves 24-hour timeline availability, continuous blocks, data gaps, and incident markers.
   */
  static async getTimelineAvailability(cameraId: string, dateStr?: string): Promise<TimelineAvailabilityResult> {
    const prisma = getPrisma();

    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, name: true, timezone: true, streamPath: true },
    });

    if (!camera) {
      throw new Error(`Camera ${cameraId} not found`);
    }

    // The date is a Bangkok calendar day (what the Playback page shows), not a UTC day.
    const targetDateStr = dateStr ?? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const dayStart = new Date(`${targetDateStr}T00:00:00.000+07:00`);
    const dayEnd = new Date(`${targetDateStr}T23:59:59.999+07:00`);

    // Fetch recordings for this camera within the day range
    let recordings = await prisma.cameraRecording.findMany({
      where: {
        cameraId,
        startTime: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { startTime: 'asc' },
    });

    // Do not inject fake timeline recordings implicitly (AUDIT-MED-04).
    // Only auto-seed if explicitly enabled in developer environment via SEED_SYNTHETIC_RECORDINGS=true.
    if (recordings.length === 0 && process.env.SEED_SYNTHETIC_RECORDINGS === 'true' && process.env.NODE_ENV !== 'production') {
      await this.seedDevRecordings(cameraId, targetDateStr);
      recordings = await prisma.cameraRecording.findMany({
        where: {
          cameraId,
          startTime: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { startTime: 'asc' },
      });
    }

    // Fetch incidents occurring on this day
    const incidents = await prisma.cameraIncident.findMany({
      where: {
        cameraId,
        openedAt: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { openedAt: 'asc' },
    });

    let totalRecordedSeconds = 0;
    let totalRecordedBytes = 0;

    const formattedSegments = recordings.map((rec) => {
      totalRecordedSeconds += rec.durationSeconds;
      totalRecordedBytes += Number(rec.fileSizeBytes);
      return {
        id: rec.id,
        startTime: rec.startTime.toISOString(),
        endTime: rec.endTime.toISOString(),
        durationSeconds: rec.durationSeconds,
        hasIncident: rec.hasIncident,
        legalHold: rec.legalHold,
        format: rec.format,
        fileSizeBytes: rec.fileSizeBytes.toString(),
      };
    });

    // Compute continuous recording blocks and data gaps
    const continuousBlocks: TimelineContinuousBlock[] = [];
    const gaps: TimelineGap[] = [];

    if (recordings.length > 0) {
      let currentBlockStart = recordings[0].startTime;
      let currentBlockEnd = recordings[0].endTime;

      for (let i = 1; i < recordings.length; i++) {
        const seg = recordings[i];
        const gapSeconds = (seg.startTime.getTime() - currentBlockEnd.getTime()) / 1000;

        // Tolerance of 10s for segment switching
        if (gapSeconds <= 10) {
          if (seg.endTime > currentBlockEnd) {
            currentBlockEnd = seg.endTime;
          }
        } else {
          // Commit finished continuous block
          continuousBlocks.push({
            startTime: currentBlockStart.toISOString(),
            endTime: currentBlockEnd.toISOString(),
            durationSeconds: Math.round((currentBlockEnd.getTime() - currentBlockStart.getTime()) / 1000),
          });

          // Register gap
          gaps.push({
            startTime: currentBlockEnd.toISOString(),
            endTime: seg.startTime.toISOString(),
            durationSeconds: Math.round(gapSeconds),
            reason: gapSeconds > 300 ? 'Network/Power Outage' : 'Stream Reconnect / Frame Drop',
          });

          currentBlockStart = seg.startTime;
          currentBlockEnd = seg.endTime;
        }
      }

      // Add the final block
      continuousBlocks.push({
        startTime: currentBlockStart.toISOString(),
        endTime: currentBlockEnd.toISOString(),
        durationSeconds: Math.round((currentBlockEnd.getTime() - currentBlockStart.getTime()) / 1000),
      });
    }

    const incidentMarkers: TimelineIncidentMarker[] = incidents.map((inc) => ({
      id: inc.id,
      incidentNumber: inc.incidentNumber,
      startTime: inc.openedAt.toISOString(),
      endTime: (inc.closedAt ?? new Date(inc.openedAt.getTime() + 10 * 60 * 1000)).toISOString(),
      reason: inc.reason,
      severity: inc.priority === 'critical' ? 'critical' : inc.priority === 'high' ? 'warning' : 'info',
      description: inc.description ?? inc.reason,
    }));

    return {
      cameraId: camera.id,
      cameraName: camera.name,
      date: targetDateStr,
      timezone: camera.timezone ?? 'Asia/Bangkok',
      totalRecordedSeconds: Math.round(totalRecordedSeconds),
      totalRecordedBytes,
      segmentsCount: recordings.length,
      segments: formattedSegments,
      continuousBlocks,
      gaps,
      incidents: incidentMarkers,
    };
  }

  /**
   * Retrieves raw recording segments for a given camera and time range.
   */
  static async getSegments(cameraId: string, from?: string, to?: string, limit = 100) {
    const prisma = getPrisma();
    const where: any = { cameraId };

    if (from || to) {
      where.startTime = {};
      if (from) where.startTime.gte = new Date(from);
      if (to) where.startTime.lte = new Date(to);
    }

    const segments = await prisma.cameraRecording.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: Math.min(limit, 500),
    });

    return segments.map((s) => ({
      ...s,
      fileSizeBytes: s.fileSizeBytes.toString(),
    }));
  }

  /**
   * How much of [start, end] is recorded on disk for a camera, and roughly how large a clip would be.
   */
  static async getCoverage(cameraId: string, start: Date, end: Date): Promise<RecordingCoverage> {
    const prisma = getPrisma();
    const segments = await prisma.cameraRecording.findMany({
      where: { cameraId, isArchived: false, startTime: { lt: end }, endTime: { gt: start } },
      orderBy: { startTime: 'asc' },
      select: { startTime: true, endTime: true, durationSeconds: true, fileSizeBytes: true },
    });
    const from = start.getTime();
    const to = end.getTime();
    let recordedSeconds = 0;
    let estimatedBytes = 0;
    for (const seg of segments) {
      const overlap = Math.max(0, Math.min(to, seg.endTime.getTime()) - Math.max(from, seg.startTime.getTime())) / 1000;
      recordedSeconds += overlap;
      if (seg.durationSeconds > 0) estimatedBytes += Number(seg.fileSizeBytes) * Math.min(1, overlap / seg.durationSeconds);
    }
    const gaps = segments.length ? findGaps(segments, from, to) : [];
    // Uncovered time at either end of the window is also missing video.
    if (segments.length && segments[0].startTime.getTime() - from > 10_000) {
      gaps.unshift({ start: start.toISOString(), end: segments[0].startTime.toISOString(), seconds: Math.round((segments[0].startTime.getTime() - from) / 1000) });
    }
    const lastEnd = segments.length ? segments[segments.length - 1].endTime.getTime() : from;
    if (segments.length && to - lastEnd > 10_000) {
      gaps.push({ start: new Date(lastEnd).toISOString(), end: end.toISOString(), seconds: Math.round((to - lastEnd) / 1000) });
    }
    return {
      windowSeconds: Math.round((to - from) / 1000),
      recordedSeconds: Math.round(recordedSeconds),
      estimatedBytes: Math.round(estimatedBytes),
      segmentsCount: segments.length,
      gaps,
    };
  }

  /** Short-lived signed link so a browser can stream a large clip straight to disk. */
  static createDownloadToken(filename: string, username: string, ttlSeconds = DOWNLOAD_LINK_TTL_SECONDS): string {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const user = Buffer.from(username).toString('base64url');
    const sig = crypto.createHmac('sha256', config.jwt.secret).update(`clip-download:${filename}:${user}:${expiresAt}`).digest('base64url');
    return `${expiresAt}.${user}.${sig}`;
  }

  /** Returns the user the link was issued to, or null when the token is invalid or expired. */
  static verifyDownloadToken(filename: string, token: string): string | null {
    const [exp, user, sig] = (token || '').split('.');
    if (!exp || !user || !sig || Number(exp) < Math.floor(Date.now() / 1000)) return null;
    const expected = crypto.createHmac('sha256', config.jwt.secret).update(`clip-download:${filename}:${user}:${exp}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return Buffer.from(user, 'base64url').toString();
  }

  /** Adds a download entry to the clip's chain of custody when a link is issued. */
  static async recordDownloadIssued(clipId: string, username: string) {
    const prisma = getPrisma();
    const clip = await prisma.recordingClip.findUnique({ where: { id: clipId } });
    if (!clip) return null;
    const chain = Array.isArray(clip.chainOfCustody) ? (clip.chainOfCustody as any[]) : [];
    await prisma.recordingClip.update({
      where: { id: clipId },
      data: { chainOfCustody: [...chain, { timestamp: new Date().toISOString(), action: 'download_link_issued', performedBy: username }] },
    });
    return clip;
  }

  /**
   * Exports an incident or operator-requested clip with pre/post buffer via ExportConcurrencyQueue [ENH-02].
   * Job advances QUEUED -> PROCESSING -> COMPLETED (or FAILED).
   */
  static async exportClip(dto: ExportClipDto, options?: { asyncProcess?: boolean }) {
    const prisma = getPrisma();
    const preBufferSec = dto.preBufferSeconds ?? 30;
    const postBufferSec = dto.postBufferSeconds ?? 60;

    const requestedStart = new Date(dto.startTime);
    const requestedEnd = new Date(dto.endTime);
    if (Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime())) {
      throw new ValidationError('startTime and endTime must be valid ISO times');
    }
    if (preBufferSec < 0 || postBufferSec < 0) {
      throw new ValidationError('Buffers cannot be negative');
    }

    // Calculate buffer window
    const bufferedStart = new Date(requestedStart.getTime() - preBufferSec * 1000);
    const bufferedEnd = new Date(requestedEnd.getTime() + postBufferSec * 1000);
    const windowHours = (bufferedEnd.getTime() - bufferedStart.getTime()) / 3_600_000;
    if (windowHours <= 0) {
      throw new ValidationError('The end of the clip must be after its start');
    }
    if (windowHours > config.cctv.maxExportHours) {
      throw new ValidationError(`A clip can cover at most ${config.cctv.maxExportHours} hours`);
    }

    // Refuse up front when the clip cannot fit on the clips disk (stream copy ≈ source size).
    const coverage = await this.getCoverage(dto.cameraId, bufferedStart, bufferedEnd);
    if (coverage.recordedSeconds === 0) {
      throw new ValidationError('No recorded video exists in the requested window');
    }
    const freeBytes = this.getFreeBytes(this.getClipsDir());
    if (freeBytes !== null && coverage.estimatedBytes * 1.1 > freeBytes) {
      throw new ValidationError(
        `Not enough disk space for this clip (needs about ${Math.ceil(coverage.estimatedBytes / 1e6)} MB, ${Math.floor(freeBytes / 1e6)} MB free)`,
      );
    }

    // Check if recorded data exists prior to requestedStart to satisfy pre-buffer requirement
    const preBufferRecording = await prisma.cameraRecording.findFirst({
      where: {
        cameraId: dto.cameraId,
        startTime: { lte: requestedStart },
        endTime: { gte: bufferedStart },
      },
    });

    const hasPreBuffer = !!preBufferRecording;
    const actualStartTime = hasPreBuffer ? bufferedStart : requestedStart;
    const durationSeconds = Math.round((bufferedEnd.getTime() - actualStartTime.getTime()) / 1000);

    const timestampSlug = actualStartTime.toISOString().replace(/[:.]/g, '-');
    const clipFilename = `clip_${dto.cameraId.slice(0, 8)}_${timestampSlug}.mp4`;
    const clipsDir = this.getClipsDir();
    const fullDiskPath = path.join(clipsDir, clipFilename);
    const filePath = `/recordings/clips/${clipFilename}`;

    // 1. Create recording clip record initially in QUEUED status
    const initialClip = await prisma.recordingClip.create({
      data: {
        cameraId: dto.cameraId,
        incidentId: dto.incidentId,
        title: dto.title || `Event Clip - ${clipFilename}`,
        description: dto.description ?? (hasPreBuffer ? `Pre-buffer: ${preBufferSec}s, Post-buffer: ${postBufferSec}s` : 'Pre-buffer NOT available in rolling storage'),
        startTime: actualStartTime,
        endTime: bufferedEnd,
        durationSeconds,
        filePath,
        fileSizeBytes: null,
        format: 'mp4',
        status: 'QUEUED',
        hasPreBuffer,
        preBufferSeconds: hasPreBuffer ? preBufferSec : 0,
        postBufferSeconds: postBufferSec,
        legalHold: dto.legalHold ?? false,
        sha256Hash: null,
        chainOfCustody: [],
        downloadUrl: `/api/v1/recordings/clips/download/${clipFilename}`,
        exportedBy: dto.exportedBy ?? 'operator',
      },
    });

    const exportJob = {
      clipId: initialClip.id,
      cameraId: dto.cameraId,
      actualStartTime,
      bufferedEnd,
      durationSeconds,
      hasPreBuffer,
      preBufferSec,
      postBufferSec,
      fullDiskPath,
      filePath,
      clipFilename,
      exportedBy: dto.exportedBy ?? 'operator',
    };

    if (options?.asyncProcess) {
      defaultExportQueue.enqueue(exportJob).catch((err) => {
        if (err instanceof ClipCancelledError) return;
        logger.error({ err, clipId: initialClip.id }, 'Background export queue job failed');
      });
      return {
        ...initialClip,
        fileSizeBytes: null,
      };
    }

    // Default synchronous execution through concurrency queue
    const completed = await defaultExportQueue.enqueue(exportJob);
    logger.info({ clipId: initialClip.id, cameraId: dto.cameraId, hasPreBuffer, status: completed.status }, 'Processed recording event clip');

    return completed;
  }

  static async getClipById(clipId: string) {
    const prisma = getPrisma();
    const clip = await prisma.recordingClip.findUnique({
      where: { id: clipId },
      include: {
        camera: { select: { id: true, name: true, streamPath: true } },
        incident: { select: { id: true, incidentNumber: true, reason: true, priority: true } },
      },
    });
    if (!clip) return null;
    return {
      ...clip,
      fileSizeBytes: clip.fileSizeBytes ? clip.fileSizeBytes.toString() : null,
    };
  }


  static getFreeBytes(dir: string): number | null {
    try {
      const st = fs.statfsSync(dir);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      return null;
    }
  }

  static getClipsDir(): string {
    const baseDir = process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');
    const clipsDir = path.join(baseDir, 'clips');
    if (!fs.existsSync(clipsDir)) {
      fs.mkdirSync(clipsDir, { recursive: true });
    }
    return clipsDir;
  }

  static getClipFilePath(filename: string): { filename: string; fullPath: string; exists: boolean } {
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error('Invalid filename');
    }
    const cleanName = path.basename(filename);
    if (!/^[a-zA-Z0-9_\-\.]+\.(mp4|mkv)$/.test(cleanName)) {
      throw new Error('Invalid clip format');
    }

    const clipsDir = this.getClipsDir();
    const fullPath = path.join(clipsDir, cleanName);
    return {
      filename: cleanName,
      fullPath,
      exists: fs.existsSync(fullPath),
    };
  }

  /**
   * Retrieves list of exported event clips.
   */
  static async getClips(cameraId?: string, incidentId?: string) {
    const prisma = getPrisma();
    const where: any = {};
    if (cameraId) where.cameraId = cameraId;
    if (incidentId) where.incidentId = incidentId;

    const clips = await prisma.recordingClip.findMany({
      where,
      include: {
        camera: { select: { id: true, name: true, streamPath: true } },
        incident: { select: { id: true, incidentNumber: true, reason: true, priority: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return clips.map((c) => ({
      ...c,
      fileSizeBytes: c.fileSizeBytes ? c.fileSizeBytes.toString() : null,
    }));
  }

  /**
   * Toggles legal hold on a recording segment to prevent automated retention pruning.
   */
  static async toggleSegmentLegalHold(recordingId: string, legalHold: boolean) {
    const prisma = getPrisma();
    // The hold is written first, so a cleanup run in between can no longer claim the segment.
    const updated = await prisma.cameraRecording.update({
      where: { id: recordingId },
      data: { legalHold },
    });
    // A segment cleanup already moved to quarantine goes back to its place when it is put on hold.
    const restore = legalHold && updated.isArchived ? await restoreRecordingFromQuarantine(updated) : undefined;
    return {
      id: updated.id,
      legalHold: updated.legalHold,
      ...(restore ? { restoredFromQuarantine: restore === 'restored', restoreOutcome: restore } : {}),
    };
  }

  /**
   * Toggles legal hold on an exported clip.
   */
  static async toggleClipLegalHold(clipId: string, legalHold: boolean) {
    const prisma = getPrisma();
    const updated = await prisma.recordingClip.update({
      where: { id: clipId },
      data: { legalHold },
    });
    return {
      id: updated.id,
      legalHold: updated.legalHold,
    };
  }

  /**
   * Seeds realistic Dev continuous recordings, gaps, and incident tags for timeline validation.
   */
  static async seedDevRecordings(cameraId: string, targetDateStr: string) {
    const prisma = getPrisma();
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, streamPath: true },
    });

    if (!camera) return 0;
    const streamPath = camera.streamPath ?? `cam/${cameraId.slice(0, 8)}`;

    const dateBase = targetDateStr;
    const segmentsToCreate: any[] = [];

    // Helper to generate a batch of 60s segments
    const makeSegments = (startHour: number, startMin: number, countMinutes: number, withIncident = false) => {
      const baseMs = new Date(`${dateBase}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00.000Z`).getTime();
      for (let m = 0; m < countMinutes; m++) {
        const segStart = new Date(baseMs + m * 60 * 1000);
        const segEnd = new Date(segStart.getTime() + 60 * 1000);
        const hasInc = withIncident && m >= Math.floor(countMinutes / 2) && m <= Math.floor(countMinutes / 2) + 2;

        segmentsToCreate.push({
          cameraId,
          streamPath,
          startTime: segStart,
          endTime: segEnd,
          durationSeconds: 60,
          filePath: `/recordings/${streamPath}/${segStart.toISOString().replace(/[:.]/g, '-')}.fmp4`,
          fileSizeBytes: BigInt(15 * 1024 * 1024), // ~15MB per minute (2 Mbps)
          format: 'fmp4',
          hasIncident: hasInc,
          incidentCount: hasInc ? 1 : 0,
          legalHold: false,
          isArchived: false,
          retentionUntil: new Date(segStart.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days retention
          storageType: 'local',
          storageNode: 'mediamtx-primary',
        });
      }
    };

    // Block 1: 08:00 - 11:30 (Morning shift, 210 min)
    makeSegments(8, 0, 180, false);

    // Gap: 11:00 - 11:15 (Simulated outage, 15 min gap omitted)

    // Block 2: 11:15 - 14:00 (Lunch & Afternoon, 165 min with incident at 12:30)
    makeSegments(11, 15, 120, true);

    // Block 3: 13:30 - 18:00 (Evening continuous shift)
    makeSegments(14, 0, 180, false);

    // Insert seeded records
    await prisma.cameraRecording.createMany({
      data: segmentsToCreate,
      skipDuplicates: true,
    });

    logger.info({ cameraId, targetDateStr, count: segmentsToCreate.length }, 'Seeded dev recording timeline data');
    return segmentsToCreate.length;
  }
}
