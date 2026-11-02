import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { createAlert } from '../alerts/alerts.service.js';

const execFileAsync = promisify(execFile);

// MediaMTX recordPath is ./recordings/%path/%Y-%m-%d_%H-%M-%S (optionally -%f), written in UTC.
const SEGMENT_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,6}))?\.mp4$/;
// A segment whose file changed this recently is still being written.
const STILL_WRITING_MS = 15_000;
const SKIP_DIRS = new Set(['clips', '.quarantine']);

export interface IndexResult {
  indexed: boolean;
  reason?: 'already-indexed' | 'no-camera' | 'still-writing';
  recordingId?: string;
}

export function getRecordingsDir(): string {
  return path.resolve(process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings'));
}

/** Start time encoded in a MediaMTX segment file name, or null if the name does not match. */
export function parseSegmentStart(fileName: string): Date | null {
  const m = SEGMENT_NAME.exec(fileName);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac] = m;
  const ms = frac ? Math.floor(Number(frac.padEnd(6, '0')) / 1000) : 0;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Maps a path reported by MediaMTX (relative to its working directory "/", e.g.
 * ./recordings/cam1/2026-10-31_01-53-51.mp4) to this container's recordings directory.
 * Anything outside that directory, or inside clips/quarantine, is rejected.
 */
export function resolveSegmentPath(reported: string, recordingsDir = getRecordingsDir()): string {
  const withoutPrefix = reported.replace(/^\.?\/?recordings\//, '');
  const resolved = path.resolve(recordingsDir, withoutPrefix);
  const rel = path.relative(recordingsDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Segment path is outside the recordings directory');
  }
  if (SKIP_DIRS.has(rel.split(path.sep)[0])) {
    throw new Error('Segment path points into clips or quarantine');
  }
  if (!parseSegmentStart(path.basename(resolved))) {
    throw new Error('Segment file name does not match the recording pattern');
  }
  return resolved;
}

/** Duration measured from the file itself; never guessed. */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { timeout: 30_000 },
  );
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned no duration for ${path.basename(filePath)}`);
  }
  return seconds;
}

/** `complete` is true when MediaMTX itself reported the segment finished (runOnRecordSegmentComplete). */
export async function indexSegment(streamPath: string, filePath: string, complete = false): Promise<IndexResult> {
  const prisma = getPrisma();
  const cleanPath = streamPath.replace(/^\/+/, '');

  const existing = await prisma.cameraRecording.findFirst({ where: { filePath }, select: { id: true } });
  if (existing) return { indexed: false, reason: 'already-indexed', recordingId: existing.id };

  const camera = await prisma.camera.findFirst({
    where: { streamPath: cleanPath, deletedAt: null },
    select: { id: true },
  });
  if (!camera) return { indexed: false, reason: 'no-camera' };

  const stat = fs.statSync(filePath);
  if (!complete && Date.now() - stat.mtimeMs < STILL_WRITING_MS) return { indexed: false, reason: 'still-writing' };

  const startTime = parseSegmentStart(path.basename(filePath));
  if (!startTime) throw new Error('Segment file name does not match the recording pattern');
  const durationSeconds = await probeDurationSeconds(filePath);

  const created = await prisma.cameraRecording.create({
    data: {
      cameraId: camera.id,
      streamPath: cleanPath,
      startTime,
      endTime: new Date(startTime.getTime() + Math.round(durationSeconds * 1000)),
      durationSeconds,
      filePath,
      fileSizeBytes: BigInt(stat.size),
      format: 'fmp4',
      storageType: 'local',
    },
  });
  logger.info({ recordingId: created.id, streamPath: cleanPath, filePath, durationSeconds }, 'Indexed recording segment');
  return { indexed: true, recordingId: created.id };
}

/** Indexes every finished segment on disk that belongs to a camera and is not in the index yet. */
export async function reconcileRecordings(recordingsDir = getRecordingsDir()) {
  const prisma = getPrisma();
  const cameras = await prisma.camera.findMany({
    where: { deletedAt: null, streamPath: { not: null } },
    select: { streamPath: true },
  });

  const summary = { scanned: 0, indexed: 0, failed: 0 };
  for (const { streamPath } of cameras) {
    if (!streamPath) continue;
    const dir = path.resolve(recordingsDir, streamPath.replace(/^\/+/, ''));
    if (path.relative(recordingsDir, dir).startsWith('..') || !fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir)) {
      if (!parseSegmentStart(name)) continue;
      summary.scanned++;
      try {
        const result = await indexSegment(streamPath, path.join(dir, name));
        if (result.indexed) summary.indexed++;
      } catch (err) {
        summary.failed++;
        logger.warn({ err, streamPath, file: name }, 'Failed to index recording segment');
      }
    }
  }
  logger.info(summary, 'Recording index reconcile finished');
  return summary;
}

/**
 * Finds indexed, non-archived segments whose file is no longer on disk. Only retention (quarantine)
 * may remove recordings, so any such file was deleted outside the system — e.g. by a MediaMTX
 * recordDeleteAfter setting or by hand — and is raised as a critical alert, never ignored.
 */
export async function findMissingRecordingFiles() {
  const prisma = getPrisma();
  const rows = await prisma.cameraRecording.findMany({
    where: { isArchived: false },
    select: { id: true, cameraId: true, filePath: true, legalHold: true, startTime: true },
  });
  const missing = rows.filter((r) => !r.filePath || !fs.existsSync(r.filePath));
  if (missing.length > 0) {
    const onHold = missing.filter((r) => r.legalHold).length;
    logger.error({ missing: missing.length, onHold }, 'Indexed recording files are missing from disk');
    await createAlert({
      alertType: 'retention_violation',
      severity: 'critical',
      source: 'recording_index_audit',
      title: 'Recording files missing from disk',
      message: `${missing.length} indexed recording segment(s) are no longer on disk (${onHold} under Legal Hold). They were removed outside the retention process.`,
      details: {
        missing: missing.length,
        onHold,
        sample: missing.slice(0, 20).map((r) => ({ id: r.id, cameraId: r.cameraId, filePath: r.filePath, startTime: r.startTime })),
      },
      skipDedup: false,
    });
  }
  return { checked: rows.length, missing: missing.length };
}

let reconcileTimer: NodeJS.Timeout | null = null;
const MISSING_FILE_CHECK_EVERY = 12; // with the 5-minute reconcile: about hourly

export function startRecordingReconciler(intervalMs = Number(process.env.RECORDING_RECONCILE_INTERVAL_MS || 300_000)) {
  let runs = 0;
  const run = async () => {
    try {
      await reconcileRecordings();
      if (runs++ % MISSING_FILE_CHECK_EVERY === 0) await findMissingRecordingFiles();
    } catch (err) {
      logger.error({ err }, 'Recording index reconcile failed');
    }
  };
  run();
  if (intervalMs > 0) reconcileTimer = setInterval(run, intervalMs);
}

export function stopRecordingReconciler() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
}
